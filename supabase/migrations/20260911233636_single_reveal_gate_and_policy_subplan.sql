-- Two independent cleanups to the read side.
--
-- 1. ONE reveal-gate definition (was three).
--
--    `private.reveal_open`, `private.get_shared_event` and
--    `private.get_shared_items` each spelled the predicate out for themselves:
--
--      now() >= e.auto_reveal_at or e.revealed_at is not null
--
--    The copy inside `get_shared_items` IS the organizer-blindness gate -- it
--    is what decides whether the owner sees `null` or a real status. Three
--    independent copies means a future change to reveal semantics that updates
--    two of them silently opens the leak in the third, and no test compares
--    them. The plan's stated approach was "one gate definition".
--
--    Both bodies are SECURITY DEFINER, so they execute as the function owner
--    and can call `private.reveal_open` regardless of it being granted only to
--    `authenticated` -- anon reads keep working.
--
-- 2. The owner's SELECT policy on items no longer calls a function per row.
--
--    `using (private.is_event_owner(event_id))` takes an argument that varies
--    per row, so the planner cannot hoist it into an InitPlan the way it does
--    for the `(select auth.uid())` form used by the events policies. Every
--    candidate row triggered its own `exists` scan of `public.events`. The
--    `in (select ...)` form below becomes a single hashed subplan.
--
--    The WRITE policies deliberately keep the function form: they act on one
--    row at a time, where the per-row cost is irrelevant and the named helper
--    reads better alongside the `not private.reveal_open(...)` clause.

-- 1. Single gate definition ---------------------------------------------------

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
    private.reveal_open(e.id) as reveal_open,
    (auth.uid() is not null and e.owner_id = auth.uid()) as is_owner
  from public.events e
  where e.share_token = p_token;
$$;

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
      when e.owner_id = auth.uid() and not private.reveal_open(e.id) then null
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

-- `create or replace` preserves the existing ACLs, but re-assert them so the
-- grant contract stays readable in one place and survives any future replace.
revoke execute on function private.get_shared_event(text) from public, anon, authenticated;
grant execute on function private.get_shared_event(text) to anon, authenticated;
revoke execute on function private.get_shared_items(text) from public, anon, authenticated;
grant execute on function private.get_shared_items(text) to anon, authenticated;

-- 2. Hashed subplan for the owner's item reads --------------------------------

drop policy items_select_owner on public.items;

create policy items_select_owner on public.items
  for select
  to authenticated
  using (
    event_id in (
      select id from public.events where owner_id = (select auth.uid())
    )
  );
