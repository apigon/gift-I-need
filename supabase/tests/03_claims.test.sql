-- Locks single-claim, owner exclusion (an oracle-proof error ordering),
-- claim closing (manual and automatic reveal), the "given" ordering and the
-- repeat-mark no-op, and the unlock window, all through the RPCs.
begin;
create extension if not exists pgtap with schema extensions;
select plan(31);

-- Fixtures -----------------------------------------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b1'); -- owner
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b2'); -- guest A
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b3'); -- guest B / stranger
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000b4'); -- organizer C, unrelated event owner

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

insert into public.events (name, event_date, timezone) values ('Ev1 Manual', current_date + 10, 'UTC');
select id as ev1 from public.events where name = 'Ev1 Manual' \gset
insert into public.items (event_id, title) values (:'ev1', 'I1'), (:'ev1', 'I2'), (:'ev1', 'I3');
select id as i1 from public.items where event_id = :'ev1' and title = 'I1' \gset
select id as i2 from public.items where event_id = :'ev1' and title = 'I2' \gset
select id as i3 from public.items where event_id = :'ev1' and title = 'I3' \gset

insert into public.events (name, event_date, timezone) values ('Ev2 Auto', current_date + 10, 'UTC');
select id as ev2 from public.events where name = 'Ev2 Auto' \gset
insert into public.items (event_id, title) values (:'ev2', 'J1');
select id as j1 from public.items where event_id = :'ev2' and title = 'J1' \gset

insert into public.events (name, event_date, timezone) values ('Ev3 Unlock', current_date + 10, 'UTC');
select id as ev3 from public.events where name = 'Ev3 Unlock' \gset

-- Ev4 belongs to a second, unrelated organizer (C) -- used by the
-- cross-owner section near the end of this file.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
insert into public.events (name, event_date, timezone) values ('Ev4 CrossOwner', current_date + 10, 'UTC');
select id as ev4 from public.events where name = 'Ev4 CrossOwner' \gset
insert into public.items (event_id, title) values (:'ev4', 'D1'), (:'ev4', 'D2');
select id as d1 from public.items where event_id = :'ev4' and title = 'D1' \gset
select id as d2 from public.items where event_id = :'ev4' and title = 'D2' \gset
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

-- === Claiming ===============================================================

-- 1. A guest's claim succeeds.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select lives_ok(format($$ select public.claim_item(%L) $$, :'i1'), 'guest A claims item I1');

-- 2. A second guest's claim -> 23505.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$ select public.claim_item(%L) $$, :'i1'), '23505');

-- 3. The same guest claiming two different items both succeed.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select lives_ok(format($$ select public.claim_item(%L) $$, :'i2'), 'guest A claims a second item I2');

-- 4/5. Owner claiming an unclaimed item and a claimed item both -> owner_cannot_claim.
-- The owner check runs before the reveal-gate check and before the insert, so
-- a failed claim can't be used as an oracle for whether the item is taken.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select throws_ok(format($$ select public.claim_item(%L) $$, :'i3'), 'P0001', 'owner_cannot_claim');
select throws_ok(format($$ select public.claim_item(%L) $$, :'i1'), 'P0001', 'owner_cannot_claim');

-- 6. claim_item as anon -> 42501.
set local role anon;
select throws_ok(format($$ select public.claim_item(%L) $$, :'i3'), '42501');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);

-- === Direct table access ====================================================
select throws_ok(format($$ insert into public.claims (item_id, claimer_id) values (%L, '00000000-0000-0000-0000-0000000000b1') $$, :'i3'), '42501');
select throws_ok($$ select * from public.claims $$, '42501');
select throws_ok(format($$ update public.claims set given_at = now() where item_id = %L $$, :'i1'), '42501');

-- === Marking given, before the reveal =======================================
select throws_ok(format($$ select public.mark_given(%L) $$, :'i1'), 'P0001', 'not_revealed');
select throws_ok(format($$ select public.mark_given(%L) $$, :'i3'), 'P0001', 'not_revealed');

-- === Reveal ev1 via manual unlock ============================================
-- Time-travel per the plan's "Critical Implementation Details": disable the
-- guard trigger as postgres (table owner) to backdate unlockable_at, since
-- the trigger otherwise enforces it as immutable/computed.
reset role;
alter table public.events disable trigger events_guard;
update public.events set unlockable_at = now() - interval '1 minute' where id = :'ev1';
alter table public.events enable trigger events_guard;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$ select public.unlock_event(%L) $$, :'ev1'), 'owner unlocks ev1 manually');

-- 7. claim_item after the reveal (manual unlock) -> claims_closed.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$ select public.claim_item(%L) $$, :'i3'), 'P0001', 'claims_closed');

-- === Marking given, after the reveal =========================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select lives_ok(format($$ select public.mark_given(%L) $$, :'i1'), 'claimer marks I1 given');
reset role;
select is(
  (select given_by from public.claims where item_id = :'i1'),
  '00000000-0000-0000-0000-0000000000b2'::uuid,
  'given_by is the claimer'
);

-- A second mark by the owner does nothing, given_by unchanged.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$ select public.mark_given(%L) $$, :'i1'), 'owner re-marks I1 given (no-op)');
reset role;
select is(
  (select given_by from public.claims where item_id = :'i1'),
  '00000000-0000-0000-0000-0000000000b2'::uuid,
  'given_by is still the claimer after the owner''s repeat mark'
);

-- A stranger -> not_permitted. An unclaimed item -> not_claimed.
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$ select public.mark_given(%L) $$, :'i1'), 'P0001', 'not_permitted');
select throws_ok(format($$ select public.mark_given(%L) $$, :'i3'), 'P0001', 'not_claimed');

-- === claims_closed via a time-travelled auto_reveal_at (ev2) ================
-- Distinct code path from the manual-unlock case above: revealed_at stays
-- null, reveal_open() answers via now() >= auto_reveal_at instead.
reset role;
alter table public.events disable trigger events_guard;
update public.events set auto_reveal_at = now() - interval '1 minute' where id = :'ev2';
alter table public.events enable trigger events_guard;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$ select public.claim_item(%L) $$, :'j1'), 'P0001', 'claims_closed');

-- === Unlocking (ev3) ==========================================================
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select throws_ok(format($$ select public.unlock_event(%L) $$, :'ev3'), 'P0001', 'unlock_too_early');

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b3","role":"authenticated"}', true);
select throws_ok(format($$ select public.unlock_event(%L) $$, :'ev3'), 'P0001', 'event_not_found');

reset role;
alter table public.events disable trigger events_guard;
update public.events set unlockable_at = now() - interval '1 minute' where id = :'ev3';
alter table public.events enable trigger events_guard;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$ select public.unlock_event(%L) $$, :'ev3'), 'owner unlocks ev3 after unlockable_at');
reset role;
select ok((select revealed_at is not null from public.events where id = :'ev3'), 'ev3 revealed_at is set');
select revealed_at as ev3_revealed_at from public.events where id = :'ev3' \gset

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$ select public.unlock_event(%L) $$, :'ev3'), 'repeat unlock does nothing');
reset role;
select is(
  (select revealed_at from public.events where id = :'ev3'),
  :'ev3_revealed_at'::timestamptz,
  'revealed_at unchanged after a repeat unlock'
);

-- === Cross-owner (organizer A vs. organizer C's event D) ====================
-- claim_item's owner-exclusion check is scoped to the specific event being
-- claimed against, not "is this caller an owner of anything" -- organizer A
-- claiming on event D looks like any other guest to that check, exactly like
-- the stranger who owns nothing (see "guest A claims item I1" above).
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select lives_ok(format($$ select public.claim_item(%L) $$, :'d1'), 'organizer A claims item D1 on organizer C''s event (not the owner there)');

-- D2 claimed by an unrelated guest, then event D revealed, so mark_given's
-- not_permitted branch is reachable for the cross-owner assertion below.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select lives_ok(format($$ select public.claim_item(%L) $$, :'d2'), 'guest A claims item D2 on event D');

reset role;
alter table public.events disable trigger events_guard;
update public.events set unlockable_at = now() - interval '1 minute' where id = :'ev4';
alter table public.events enable trigger events_guard;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b4","role":"authenticated"}', true);
select lives_ok(format($$ select public.unlock_event(%L) $$, :'ev4'), 'organizer C unlocks event D manually');

-- Organizer A owns nothing on event D and isn't D2's claimer -> not_permitted,
-- the same code the existing stranger case above already asserts.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated"}', true);
select throws_ok(format($$ select public.mark_given(%L) $$, :'d2'), 'P0001', 'not_permitted');

-- unlock_event's owner check runs before any unlockable_at/reveal check, so a
-- cross-owner caller collapses to the same event_not_found the stranger case
-- ("unlock_too_early"/"event_not_found" pair above) already asserts --
-- non-existent and not-yours deliberately share one code.
select throws_ok(format($$ select public.unlock_event(%L) $$, :'ev4'), 'P0001', 'event_not_found');

select * from finish();

rollback;
