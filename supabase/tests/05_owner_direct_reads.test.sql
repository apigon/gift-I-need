-- Organizer-blindness across EVERY path the owner holds a grant on, not just
-- the shared-list RPCs.
--
-- 04_shared_list.test.sql proves `get_shared_items` is blind, and asserts that
-- a *stranger* cannot read the tables directly. Neither covered the owner's
-- own direct table reads, which is where the `xmax` side channel lived: a
-- table-level SELECT also grants the system columns, and the FK lock taken by
-- `insert into public.claims` stamps `xmax` on the parent `items` row (and
-- `private.claim_item`'s `for share` stamps it on the `events` row).
--
-- The rule is stronger than "the RPC is blind": a claimed and an unclaimed
-- item must be INDISTINGUISHABLE to the owner before the reveal, through
-- every privilege the owner holds.
begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e1'); -- owner
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000e2'); -- guest

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

insert into public.events (name, event_date, timezone) values ('Direct Read Event', current_date + 30, 'UTC');
select id as ev, share_token as tok from public.events where name = 'Direct Read Event' \gset

insert into public.items (event_id, title) values (:'ev', 'Claimed'), (:'ev', 'Unclaimed');
select id as claimed_id from public.items where event_id = :'ev' and title = 'Claimed' \gset

-- The guest claims exactly one of the two items.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e2","role":"authenticated"}', true);
select public.claim_item(:'claimed_id');

-- Back to the owner, well before the reveal.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select is(private.reveal_open(:'ev'), false, 'precondition: the reveal is still closed');

-- The system columns are unreachable ---------------------------------------
-- These are the actual leak. Without the column-scoped grant each returns a
-- row per item, with xmax <> 0 on exactly the claimed one.
select throws_ok(
  format($$ select xmax from public.items where event_id = %L $$, :'ev'),
  '42501',
  'permission denied for table items',
  'owner cannot read items.xmax (per-item claim status)'
);
select throws_ok(
  format($$ select xmax from public.events where id = %L $$, :'ev'),
  '42501',
  'permission denied for table events',
  'owner cannot read events.xmax (claims-exist signal)'
);
select throws_ok(
  format($$ select ctid from public.items where event_id = %L $$, :'ev'),
  '42501',
  'permission denied for table items',
  'owner cannot read items.ctid'
);

-- ... and cannot be used as a filter or a count ------------------------------
select throws_ok(
  format($$ select count(*) from public.items where event_id = %L and xmax::text <> '0' $$, :'ev'),
  '42501',
  'permission denied for table items',
  'owner cannot count claimed items via an xmax predicate'
);

-- The business columns still work ------------------------------------------
-- The fix must not cost the owner their own list, or item editing: an
-- `update ... where` needs SELECT on the predicate columns.
select results_eq(
  format($$ select title from public.items where event_id = %L order by title $$, :'ev'),
  $$ values ('Claimed'::text), ('Unclaimed'::text) $$,
  'owner still reads their own item titles'
);
select lives_ok(
  format($$ update public.items set title = title where event_id = %L $$, :'ev'),
  'owner can still run update ... where (needs SELECT on the predicate columns)'
);

-- Claimed and unclaimed stay indistinguishable ------------------------------
select results_eq(
  format($$ select status from public.get_shared_items(%L) order by 1 nulls first $$, :'tok'),
  $$ values (null::text), (null::text) $$,
  'owner sees null status for the claimed and the unclaimed item alike'
);
select throws_ok(
  $$ select * from public.claims $$,
  '42501',
  'permission denied for table claims',
  'owner cannot read the claims table at all'
);

-- The reveal gate agrees across every path that exposes it ------------------
-- 20260911233636 collapsed three independent copies of the predicate into
-- one (`private.reveal_open`). This pins the agreement so a future change
-- cannot update one site and leave the organizer-blindness gate behind.
select is(
  (select reveal_open from public.get_shared_event(:'tok')),
  private.reveal_open(:'ev'),
  'get_shared_event.reveal_open agrees with private.reveal_open (closed)'
);

-- ... and still agrees once the event is revealed.
reset role;
update public.events set revealed_at = now() where id = :'ev';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000e1","role":"authenticated"}', true);

select is(
  (select reveal_open from public.get_shared_event(:'tok')),
  private.reveal_open(:'ev'),
  'get_shared_event.reveal_open agrees with private.reveal_open (open)'
);
select is(
  (select reveal_open from public.get_shared_event(:'tok')),
  true,
  'the gate actually flipped, so the agreement above is not vacuous'
);

select * from finish();
rollback;
