-- Surprise-rule schema: events, items, claims. Deny-by-default privileges,
-- RLS on every table, and every claim/cross-owner write behind a `private`
-- SECURITY DEFINER body with a `public` SECURITY INVOKER wrapper. See
-- context/changes/surprise-rule-data-contract/plan.md Phase 2 for the
-- contract this migration implements.

-- ============================================================================
-- 1. Default-privilege lockdown
-- ============================================================================
-- Removes Supabase's per-schema default grants for objects created after this
-- point. This does NOT revoke PUBLIC's built-in EXECUTE on functions (a
-- per-schema default can't revoke a global one) — function privileges are
-- therefore set explicitly, per function, below.
alter default privileges for role postgres in schema public
  revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public
  revoke all on functions from anon, authenticated, service_role;

create extension if not exists pgcrypto with schema extensions;

-- ============================================================================
-- 2. Schema `private`
-- ============================================================================
create schema if not exists private;

revoke all on schema private from public;
-- Needed because RLS policies and the `public` wrappers call into `private`.
-- `private` is never listed in [api] schemas, so it stays unexposed.
grant usage on schema private to anon, authenticated;

-- ============================================================================
-- 3. public.events
-- ============================================================================
create table public.events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null,
  event_date date not null,
  timezone text not null,
  share_token text not null unique,
  unlockable_at timestamptz not null,
  auto_reveal_at timestamptz not null,
  revealed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint events_name_length check (char_length(btrim(name)) between 1 and 120)
);

create index events_owner_id_idx on public.events (owner_id);

alter table public.events enable row level security;

-- ============================================================================
-- 4. public.items
-- ============================================================================
create table public.items (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  title text not null,
  notes text,
  link text,
  price_range text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint items_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint items_notes_length check (notes is null or char_length(notes) <= 2000),
  -- Blocks stored `javascript:` URLs.
  constraint items_link_format check (link is null or link ~* '^https?://'),
  constraint items_link_length check (link is null or char_length(link) <= 2048),
  constraint items_price_range_length check (price_range is null or char_length(price_range) <= 50)
);

create index items_event_id_idx on public.items (event_id);

alter table public.items enable row level security;

-- ============================================================================
-- 5. public.claims
-- ============================================================================
create table public.claims (
  id uuid primary key default gen_random_uuid(),
  -- The single-claim guarantee: a unique index is arbitrated atomically at
  -- insert time, so a race loser always gets 23505 (no check-then-insert
  -- window).
  item_id uuid not null unique references public.items (id) on delete cascade,
  claimer_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  given_at timestamptz,
  given_by uuid references auth.users (id),
  constraint claims_given_pair check ((given_at is null) = (given_by is null))
);

create index claims_claimer_id_idx on public.claims (claimer_id);

alter table public.claims enable row level security;
-- No grants and no policies for any API role: claims is reachable only
-- through the private/public RPCs below (claim_item, mark_given). RLS filters
-- rows, not columns, so a granted SELECT here would leak claimer_id.
-- Expect Security Advisor to flag "RLS Enabled No Policy" here — that's
-- correct, not an oversight: with zero grants too, anon/authenticated get
-- 42501 before RLS ever runs, and the only writers are SECURITY DEFINER
-- functions owned by postgres, which bypass RLS via table ownership, not via
-- a policy. A policy here would be unreachable dead code.

-- ============================================================================
-- 6. Trigger `events_guard`
-- ============================================================================
create or replace function private.events_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not exists (
      select 1 from pg_catalog.pg_timezone_names where name = new.timezone
    ) then
      raise exception 'invalid_timezone' using errcode = 'P0001';
    end if;

    if new.event_date < (now() at time zone new.timezone)::date then
      raise exception 'event_date_in_past' using errcode = 'P0001';
    end if;

    new.unlockable_at := ((new.event_date + 1)::timestamp at time zone new.timezone);
    new.auto_reveal_at := ((new.event_date + 2)::timestamp at time zone new.timezone);
    new.share_token := translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_');
    new.revealed_at := null;
  elsif tg_op = 'UPDATE' then
    if new.event_date is distinct from old.event_date
      or new.timezone is distinct from old.timezone
      or new.owner_id is distinct from old.owner_id
      or new.share_token is distinct from old.share_token
      or new.unlockable_at is distinct from old.unlockable_at
      or new.auto_reveal_at is distinct from old.auto_reveal_at
    then
      raise exception 'event_date_immutable' using errcode = 'P0001';
    end if;
    new.updated_at := now();
  end if;

  return new;
end;
$$;

revoke execute on function private.events_guard() from public, anon, authenticated;
-- Triggers don't need EXECUTE grants to fire.

create trigger events_guard
  before insert or update on public.events
  for each row execute function private.events_guard();

-- ============================================================================
-- 7. Trigger `items_touch`
-- ============================================================================
create or replace function private.items_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function private.items_touch() from public, anon, authenticated;

create trigger items_touch
  before update on public.items
  for each row execute function private.items_touch();

-- ============================================================================
-- 8. Helpers
-- ============================================================================
create or replace function private.is_event_owner(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.events
    where id = p_event_id and owner_id = auth.uid()
  );
$$;

revoke execute on function private.is_event_owner(uuid) from public, anon, authenticated;
grant execute on function private.is_event_owner(uuid) to authenticated;

-- Returns false when the event isn't found.
create or replace function private.reveal_open(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select now() >= e.auto_reveal_at or e.revealed_at is not null
      from public.events e
      where e.id = p_event_id
    ),
    false
  );
$$;

revoke execute on function private.reveal_open(uuid) from public, anon, authenticated;
grant execute on function private.reveal_open(uuid) to authenticated;

-- ============================================================================
-- 9. Grants and RLS (authenticated only; anon gets none; nothing gets DELETE)
-- ============================================================================

-- events
grant select on public.events to authenticated;
grant insert (name, event_date, timezone), update (name) on public.events to authenticated;

create policy events_select_own on public.events
  for select
  to authenticated
  using (owner_id = (select auth.uid()));

create policy events_insert_own on public.events
  for insert
  to authenticated
  with check (owner_id = (select auth.uid()));

create policy events_update_own on public.events
  for update
  to authenticated
  using (owner_id = (select auth.uid()));

-- items
grant select on public.items to authenticated;
grant insert (event_id, title, notes, link, price_range),
  update (title, notes, link, price_range) on public.items to authenticated;

create policy items_select_owner on public.items
  for select
  to authenticated
  using (private.is_event_owner(event_id));

create policy items_insert_owner on public.items
  for insert
  to authenticated
  with check (private.is_event_owner(event_id) and not private.reveal_open(event_id));

-- The USING clause is required: an UPDATE policy with no USING targets no
-- rows (Postgres applies an always-false clause). Together with the WITH
-- CHECK, this makes the list read-only after the reveal.
create policy items_update_owner on public.items
  for update
  to authenticated
  using (private.is_event_owner(event_id))
  with check (private.is_event_owner(event_id) and not private.reveal_open(event_id));

-- claims: RLS enabled above, intentionally no grants and no policies to any
-- API role.

-- ============================================================================
-- 10. Write RPCs
-- ============================================================================
-- GRANT EXECUTE is role-level only — Postgres has no way to grant "only the
-- claimer of this item" or "only this event's owner". So every wrapper below
-- is granted broadly to `authenticated`, and the per-row question ("is this
-- caller the claimer or the owner of this specific event?") is enforced
-- procedurally inside each `private` body (owner_cannot_claim, not_permitted,
-- event_not_found). The grant is the coarse "may call this function at all"
-- gate; the function body is the fine-grained authorization.

-- claim_item -----------------------------------------------------------------
create or replace function private.claim_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select event_id into v_event_id from public.items where id = p_item_id;
  if v_event_id is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;

  -- Serializes against private.unlock_event: a claim either commits before
  -- the manual unlock or sees the reveal.
  perform 1 from public.events where id = v_event_id for share;

  if private.is_event_owner(v_event_id) then
    raise exception 'owner_cannot_claim' using errcode = 'P0001';
  end if;

  if private.reveal_open(v_event_id) then
    raise exception 'claims_closed' using errcode = 'P0001';
  end if;

  -- The unique index on claims.item_id raises 23505 for a race loser.
  insert into public.claims (item_id, claimer_id)
  values (p_item_id, v_uid);
end;
$$;

revoke execute on function private.claim_item(uuid) from public, anon, authenticated;
grant execute on function private.claim_item(uuid) to authenticated;

create or replace function public.claim_item(p_item_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.claim_item(p_item_id);
$$;

revoke execute on function public.claim_item(uuid) from public, anon, authenticated;
grant execute on function public.claim_item(uuid) to authenticated;

-- mark_given -------------------------------------------------------------
create or replace function private.mark_given(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_event_id uuid;
  v_claimer_id uuid;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = 'P0001';
  end if;

  select event_id into v_event_id from public.items where id = p_item_id;
  if v_event_id is null then
    raise exception 'item_not_found' using errcode = 'P0001';
  end if;

  if not private.reveal_open(v_event_id) then
    raise exception 'not_revealed' using errcode = 'P0001';
  end if;

  select claimer_id into v_claimer_id from public.claims where item_id = p_item_id;
  if v_claimer_id is null then
    raise exception 'not_claimed' using errcode = 'P0001';
  end if;

  if v_uid is distinct from v_claimer_id and not private.is_event_owner(v_event_id) then
    raise exception 'not_permitted' using errcode = 'P0001';
  end if;

  -- A repeat mark (given_at already set) matches zero rows and does nothing.
  update public.claims
  set given_at = now(), given_by = v_uid
  where item_id = p_item_id and given_at is null;
end;
$$;

revoke execute on function private.mark_given(uuid) from public, anon, authenticated;
grant execute on function private.mark_given(uuid) to authenticated;

create or replace function public.mark_given(p_item_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.mark_given(p_item_id);
$$;

revoke execute on function public.mark_given(uuid) from public, anon, authenticated;
grant execute on function public.mark_given(uuid) to authenticated;

-- unlock_event -------------------------------------------------------------
create or replace function private.unlock_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_owner_id uuid;
  v_unlockable_at timestamptz;
  v_auto_reveal_at timestamptz;
  v_revealed_at timestamptz;
begin
  select owner_id, unlockable_at, auto_reveal_at, revealed_at
    into v_owner_id, v_unlockable_at, v_auto_reveal_at, v_revealed_at
    from public.events
    where id = p_event_id;

  -- Same key whether the event doesn't exist or the caller isn't the owner,
  -- so the error can't be used to enumerate events.
  if v_owner_id is null or v_owner_id is distinct from v_uid then
    raise exception 'event_not_found' using errcode = 'P0001';
  end if;

  if now() < v_unlockable_at then
    raise exception 'unlock_too_early' using errcode = 'P0001';
  end if;

  if v_revealed_at is not null or now() >= v_auto_reveal_at then
    return;
  end if;

  update public.events set revealed_at = now() where id = p_event_id;
end;
$$;

revoke execute on function private.unlock_event(uuid) from public, anon, authenticated;
grant execute on function private.unlock_event(uuid) to authenticated;

create or replace function public.unlock_event(p_event_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  select private.unlock_event(p_event_id);
$$;

revoke execute on function public.unlock_event(uuid) from public, anon, authenticated;
grant execute on function public.unlock_event(uuid) to authenticated;
