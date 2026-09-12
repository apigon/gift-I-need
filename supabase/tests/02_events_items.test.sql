-- Proves the ownership rules, the creation rules, date/timezone immutability,
-- and the reveal-instant arithmetic for events and items.
begin;

create extension if not exists pgtap with schema extensions;

select plan(19);

-- Fixtures ---------------------------------------------------------------
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'); -- owner
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a2'); -- stranger

-- An owner can insert, select and update `name`. --------------------------
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

insert into public.events (name, event_date, timezone)
values ('Owner Event', current_date + 30, 'Europe/Warsaw');

select isnt_empty(
  $$ select 1 from public.events where name = 'Owner Event' and owner_id = '00000000-0000-0000-0000-0000000000a1' $$,
  'owner can insert and select their own event'
);

update public.events set name = 'Owner Event Renamed' where name = 'Owner Event';
select isnt_empty(
  $$ select 1 from public.events where name = 'Owner Event Renamed' $$,
  'owner can update the name'
);

select matches(
  (select share_token from public.events where name = 'Owner Event Renamed'),
  '^[A-Za-z0-9_-]{22}$',
  'share_token is 22 URL-safe characters'
);

select id as fx_event_id from public.events where name = 'Owner Event Renamed' \gset

-- A stranger's select returns empty; their update affects 0 rows. --------
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a2","role":"authenticated"}', true);
select is_empty(
  $$ select 1 from public.events where name = 'Owner Event Renamed' $$,
  'a stranger cannot see another owner''s event'
);
update public.events set name = 'Hijacked' where name = 'Owner Event Renamed';

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select isnt_empty(
  $$ select 1 from public.events where name = 'Owner Event Renamed' $$,
  'a stranger''s update did not change the row'
);

-- update event_date as authenticated -> 42501 (column privilege). --------
select throws_ok(
  $$ update public.events set event_date = current_date + 31 where name = 'Owner Event Renamed' $$,
  '42501'
);

-- The same update as postgres -> event_date_immutable. -------------------
reset role;
select throws_ok(
  $$ update public.events set event_date = current_date + 31 where name = 'Owner Event Renamed' $$,
  'P0001',
  'event_date_immutable'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

-- A past date -> event_date_in_past. Today in the event's timezone is
-- accepted.
select throws_ok(
  $$ insert into public.events (name, event_date, timezone) values ('Too Late', current_date - 1, 'UTC') $$,
  'P0001',
  'event_date_in_past'
);

insert into public.events (name, event_date, timezone) values ('Today Event', (now() at time zone 'UTC')::date, 'UTC');
select isnt_empty(
  $$ select 1 from public.events where name = 'Today Event' $$,
  'today in the event''s timezone is accepted'
);

-- Mars/Olympus -> invalid_timezone. ---------------------------------------
select throws_ok(
  $$ insert into public.events (name, event_date, timezone) values ('Bad TZ', current_date + 1, 'Mars/Olympus') $$,
  'P0001',
  'invalid_timezone'
);

-- 2026-12-24 with Europe/Warsaw gives the documented reveal instants. ----
insert into public.events (name, event_date, timezone) values ('Xmas', '2026-12-24', 'Europe/Warsaw');
select results_eq(
  $$ select unlockable_at, auto_reveal_at from public.events where name = 'Xmas' $$,
  $$ values ('2026-12-24 23:00:00+00'::timestamptz, '2026-12-25 23:00:00+00'::timestamptz) $$,
  'unlockable_at / auto_reveal_at match the worked example'
);

-- link = 'javascript:alert(1)' is rejected. -------------------------------
-- The SQLSTATE is pinned deliberately: a bare throws_ok() asserts only that
-- *something* was raised, so it would stay green on a format-string typo, a
-- privilege error, or a bad cast -- i.e. while the constraint itself was gone.
select throws_ok(
  format($$ insert into public.items (event_id, title, link) values (%L, 'Bad Link', 'javascript:alert(1)') $$, :'fx_event_id'),
  '23514',
  'new row for relation "items" violates check constraint "items_link_format"',
  'a javascript: link is rejected by items_link_format'
);

insert into public.items (event_id, title) values (:'fx_event_id', 'Item One');

-- items.updated_at advances on update. ------------------------------------
select ok(
  (select updated_at = created_at from public.items where title = 'Item One'),
  'updated_at starts equal to created_at'
);

-- now() is frozen for the whole test transaction, so prove the trigger
-- overwrites the column (rather than comparing wall-clock timestamps): force
-- a stale value directly, then show a legitimate update resets it.
reset role;
alter table public.items disable trigger items_touch;
update public.items set updated_at = '2000-01-01'::timestamptz where title = 'Item One';
alter table public.items enable trigger items_touch;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

update public.items set title = 'Item One Renamed' where title = 'Item One';
select ok(
  (select updated_at > '2000-01-01'::timestamptz from public.items where title = 'Item One Renamed'),
  'updated_at advances on update'
);

-- Item insert and update after the reveal (time-travelled) -> 42501. -----
-- Isolated in its own savepoint: revealed_at, once set, permanently closes
-- item writes for the rest of the transaction, which would break the
-- field-length cases below if they ran afterward in the same state.
savepoint pre_reveal;
reset role;
alter table public.events disable trigger events_guard;
update public.events set revealed_at = now() where name = 'Owner Event Renamed';
alter table public.events enable trigger events_guard;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select throws_ok(
  format($$ insert into public.items (event_id, title) values (%L, 'Too Late Item') $$, :'fx_event_id'),
  '42501'
);

select throws_ok(
  $$ update public.items set title = 'Renamed After Reveal' where title = 'Item One Renamed' $$,
  '42501'
);

rollback to savepoint pre_reveal;

-- Item field-length constraints (items_title_length, items_notes_length,
-- items_price_range_length) -- previously untested. Pinned SQLSTATE and
-- constraint name, matching the items_link_format case above.
select throws_ok(
  format($$ insert into public.items (event_id, title) values (%L, '') $$, :'fx_event_id'),
  '23514',
  'new row for relation "items" violates check constraint "items_title_length"',
  'an empty title is rejected by items_title_length'
);

select throws_ok(
  format($$ insert into public.items (event_id, title, notes) values (%L, 'Item Two', %L) $$, :'fx_event_id', repeat('x', 2001)),
  '23514',
  'new row for relation "items" violates check constraint "items_notes_length"',
  'notes over 2000 characters is rejected by items_notes_length'
);

select throws_ok(
  format($$ insert into public.items (event_id, title, price_range) values (%L, 'Item Three', %L) $$, :'fx_event_id', repeat('x', 51)),
  '23514',
  'new row for relation "items" violates check constraint "items_price_range_length"',
  'a price_range over 50 characters is rejected by items_price_range_length'
);

select * from finish();

rollback;
