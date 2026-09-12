-- Shared-list read RPCs: the only read path for the shared list. Both are
-- `private` SECURITY DEFINER bodies (STABLE, search_path pinned) with `public`
-- SECURITY INVOKER wrappers, granted to `anon` and `authenticated`. This is
-- the single place where claim state becomes a per-viewer status, and it
-- never returns claimer_id, given_by, claim timestamps or any count. See
-- context/changes/surprise-rule-data-contract/plan.md Phase 3 for the
-- contract this migration implements.

-- ============================================================================
-- get_shared_event
-- ============================================================================
create or replace function private.get_shared_event(p_token text)
returns table (
  id uuid,
  name text,
  event_date date,
  timezone text,
  reveal_open boolean,
  is_owner boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    e.id,
    e.name,
    e.event_date,
    e.timezone,
    (now() >= e.auto_reveal_at or e.revealed_at is not null) as reveal_open,
    (auth.uid() is not null and e.owner_id = auth.uid()) as is_owner
  from public.events e
  where e.share_token = p_token;
$$;

revoke execute on function private.get_shared_event(text) from public, anon, authenticated;
grant execute on function private.get_shared_event(text) to anon, authenticated;

create or replace function public.get_shared_event(p_token text)
returns table (
  id uuid,
  name text,
  event_date date,
  timezone text,
  reveal_open boolean,
  is_owner boolean
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_shared_event(p_token);
$$;

revoke execute on function public.get_shared_event(text) from public, anon, authenticated;
grant execute on function public.get_shared_event(text) to anon, authenticated;

-- ============================================================================
-- get_shared_items
-- ============================================================================
-- Derives a per-viewer status without ever exposing claimer_id, given_by,
-- claim timestamps or a count. The organizer-blindness rule lives entirely in
-- this CASE: an owner before the reveal gets null on every item, whether or
-- not a claim exists, so a claimed and an unclaimed item are indistinguishable
-- from the organizer's side.
create or replace function private.get_shared_items(p_token text)
returns table (
  id uuid,
  title text,
  notes text,
  link text,
  price_range text,
  status text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    i.id,
    i.title,
    i.notes,
    i.link,
    i.price_range,
    case
      when auth.uid() is null then null
      when e.owner_id = auth.uid() and not (now() >= e.auto_reveal_at or e.revealed_at is not null) then null
      when c.item_id is null then 'available'
      when c.given_at is not null then 'given'
      when c.claimer_id = auth.uid() then 'mine'
      else 'taken'
    end as status
  from public.items i
  join public.events e on e.id = i.event_id
  left join public.claims c on c.item_id = i.id
  where e.share_token = p_token
  order by i.created_at, i.id;
$$;

revoke execute on function private.get_shared_items(text) from public, anon, authenticated;
grant execute on function private.get_shared_items(text) to anon, authenticated;

create or replace function public.get_shared_items(p_token text)
returns table (
  id uuid,
  title text,
  notes text,
  link text,
  price_range text,
  status text
)
language sql
security invoker
set search_path = ''
as $$
  select * from private.get_shared_items(p_token);
$$;

revoke execute on function public.get_shared_items(text) from public, anon, authenticated;
grant execute on function public.get_shared_items(text) to anon, authenticated;
