-- Proves the organizer-blindness guarantee for every viewer type, before and
-- after the reveal, and proves that nothing can be enumerated or leaked
-- through the shared-list RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d1'); -- owner
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d2'); -- guest A
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000d3'); -- guest B / stranger

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);

insert into public.events (name, event_date, timezone) values ('Shared List Event', current_date + 10, 'UTC');
select id as ev1, share_token as tok1 from public.events where name = 'Shared List Event' \gset

insert into public.items (event_id, title) values (:'ev1', 'Avail'), (:'ev1', 'ItemA'), (:'ev1', 'ItemB');
select id as item_a from public.items where event_id = :'ev1' and title = 'ItemA' \gset
select id as item_b from public.items where event_id = :'ev1' and title = 'ItemB' \gset

-- Guest A claims ItemA, guest B claims ItemB.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.claim_item(:'item_a');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select public.claim_item(:'item_b');

-- === Before the reveal =======================================================

-- anon -> every status null, and all item fields present.
-- `set local role` alone doesn't clear request.jwt.claims, so the sub from
-- the last authenticated impersonation would otherwise leak into auth.uid()
-- here. A real anonymous PostgREST request carries no sub.
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by title $$, :'tok1'),
  $$ values (null::text), (null::text), (null::text) $$,
  'anon sees null status for every item before the reveal'
);
select is_empty(
  format($$ select 1 from public.get_shared_items(%L) where title is null $$, :'tok1'),
  'anon sees every item''s title (fields are present, only status is hidden)'
);

-- Guest A -> available / mine / taken.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by title $$, :'tok1'),
  $$ values ('available'::text), ('mine'::text), ('taken'::text) $$,
  'guest A sees available/mine/taken before the reveal'
);

-- The owner -> every status null, claimed and unclaimed items indistinguishable.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by title $$, :'tok1'),
  $$ values (null::text), (null::text), (null::text) $$,
  'the owner sees null status for every item before the reveal, claimed or not'
);

-- === Reveal (time-travelled) ==================================================
reset role;
alter table public.events disable trigger events_guard;
update public.events set revealed_at = now() where id = :'ev1';
alter table public.events enable trigger events_guard;

-- Guest A marks ItemA given.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select public.mark_given(:'item_a');

-- === After the reveal =========================================================

-- The owner -> available / given / taken, and never mine.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d1","role":"authenticated"}', true);
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by title $$, :'tok1'),
  $$ values ('available'::text), ('given'::text), ('taken'::text) $$,
  'the owner sees available/given/taken after the reveal, never mine'
);

-- Guest A -> available / given / taken (their own given item is never "mine").
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d2","role":"authenticated"}', true);
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by title $$, :'tok1'),
  $$ values ('available'::text), ('given'::text), ('taken'::text) $$,
  'guest A sees available/given/taken after the reveal'
);

-- === No enumeration ===========================================================

-- A wrong token and a malformed token -> is_empty for both functions, both roles.
select is_empty(
  $$ select 1 from public.get_shared_event('00000000000000000000zz') $$,
  'a wrong token returns no event (authenticated)'
);
select is_empty(
  $$ select 1 from public.get_shared_items('00000000000000000000zz') $$,
  'a wrong token returns no items (authenticated)'
);
select is_empty(
  $$ select 1 from public.get_shared_event('not a valid token!!') $$,
  'a malformed token returns no event (authenticated)'
);
select is_empty(
  $$ select 1 from public.get_shared_items('not a valid token!!') $$,
  'a malformed token returns no items (authenticated)'
);

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is_empty(
  $$ select 1 from public.get_shared_event('00000000000000000000zz') $$,
  'a wrong token returns no event (anon)'
);
select is_empty(
  $$ select 1 from public.get_shared_items('00000000000000000000zz') $$,
  'a wrong token returns no items (anon)'
);
select is_empty(
  $$ select 1 from public.get_shared_event('not a valid token!!') $$,
  'a malformed token returns no event (anon)'
);
select is_empty(
  $$ select 1 from public.get_shared_items('not a valid token!!') $$,
  'a malformed token returns no items (anon)'
);

-- As a stranger, direct table access is empty.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000d3","role":"authenticated"}', true);
select is_empty(
  format($$ select 1 from public.events where id = %L $$, :'ev1'),
  'a stranger cannot select the event directly'
);
select is_empty(
  format($$ select 1 from public.items where event_id = %L $$, :'ev1'),
  'a stranger cannot select the items directly'
);

-- === Contract: no identity columns ===========================================
-- proargnames covers both the IN parameter (p_token) and the OUT/table
-- columns, so this proves neither the public wrappers nor the private bodies
-- ever declare claimer_id, given_by, claimer or a count column.
select ok(
  not (
    (select proargnames from pg_proc where oid = 'public.get_shared_event(text)'::regprocedure)
    && array['claimer_id', 'given_by', 'claimer', 'count']
  ),
  'public.get_shared_event exposes none of claimer_id/given_by/claimer/count'
);
select ok(
  not (
    (select proargnames from pg_proc where oid = 'public.get_shared_items(text)'::regprocedure)
    && array['claimer_id', 'given_by', 'claimer', 'count']
  ),
  'public.get_shared_items exposes none of claimer_id/given_by/claimer/count'
);
select ok(
  not (
    (select proargnames from pg_proc where oid = 'private.get_shared_event(text)'::regprocedure)
    && array['claimer_id', 'given_by', 'claimer', 'count']
  ),
  'private.get_shared_event exposes none of claimer_id/given_by/claimer/count'
);
select ok(
  not (
    (select proargnames from pg_proc where oid = 'private.get_shared_items(text)'::regprocedure)
    && array['claimer_id', 'given_by', 'claimer', 'count']
  ),
  'private.get_shared_items exposes none of claimer_id/given_by/claimer/count'
);

select * from finish();
rollback;
