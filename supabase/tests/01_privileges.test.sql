-- Locks the least-privilege model so no future migration can quietly widen
-- it: RLS everywhere, anon has zero table access, authenticated has exactly
-- the grants the Phase 2 migration lists, nothing gets DELETE, claims is
-- sealed, no SECURITY DEFINER function lives in an exposed schema, every
-- function has search_path pinned, and EXECUTE matches the grants exactly.
begin;

create extension if not exists pgtap with schema extensions;

select plan(37);

-- Row-level security is on for every base table -----------------------------
select ok(relrowsecurity, 'events has RLS enabled') from pg_class where oid = 'public.events'::regclass;
select ok(relrowsecurity, 'items has RLS enabled') from pg_class where oid = 'public.items'::regclass;
select ok(relrowsecurity, 'claims has RLS enabled') from pg_class where oid = 'public.claims'::regclass;

-- No SECURITY DEFINER function lives in the exposed `public` schema ---------
select * from is_empty(
  $$ select proname from pg_proc where pronamespace = 'public'::regnamespace and prosecdef $$,
  'no SECURITY DEFINER function exists in public'
);

-- search_path is pinned on every function: wrappers, definer bodies,
-- helpers and trigger functions alike.
select * from is_empty(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and not ('search_path=""' = any(coalesce(p.proconfig, array[]::text[])))
  $$,
  'every function in public and private has search_path pinned'
);

-- EXECUTE matches the grants exactly, for both anon and authenticated -------
select * from is_empty(
  $$
    with expected(fn, role, should) as (
      values
        ('private.is_event_owner(uuid)', 'authenticated', true),
        ('private.is_event_owner(uuid)', 'anon', false),
        ('private.reveal_open(uuid)', 'authenticated', true),
        ('private.reveal_open(uuid)', 'anon', false),
        ('private.claim_item(uuid)', 'authenticated', true),
        ('private.claim_item(uuid)', 'anon', false),
        ('private.mark_given(uuid)', 'authenticated', true),
        ('private.mark_given(uuid)', 'anon', false),
        ('private.unlock_event(uuid)', 'authenticated', true),
        ('private.unlock_event(uuid)', 'anon', false),
        ('private.events_guard()', 'authenticated', false),
        ('private.events_guard()', 'anon', false),
        ('private.items_touch()', 'authenticated', false),
        ('private.items_touch()', 'anon', false),
        ('public.claim_item(uuid)', 'authenticated', true),
        ('public.claim_item(uuid)', 'anon', false),
        ('public.mark_given(uuid)', 'authenticated', true),
        ('public.mark_given(uuid)', 'anon', false),
        ('public.unlock_event(uuid)', 'authenticated', true),
        ('public.unlock_event(uuid)', 'anon', false)
    )
    select fn || ' / ' || role || ' expected ' || should
    from expected
    where has_function_privilege(role, fn, 'EXECUTE') is distinct from should
  $$,
  'EXECUTE grants match the contract exactly for anon and authenticated'
);

-- Table-level privileges ------------------------------------------------
-- authenticated only ever gets table-level SELECT; INSERT/UPDATE are
-- column-scoped, so they never show up at the table-privilege level.
select * from table_privs_are('public', 'events', 'authenticated', array['SELECT']);
select * from table_privs_are('public', 'items', 'authenticated', array['SELECT']);
select * from table_privs_are('public', 'claims', 'authenticated', array[]::name[]);

select * from table_privs_are('public', 'events', 'anon', array[]::name[]);
select * from table_privs_are('public', 'items', 'anon', array[]::name[]);
select * from table_privs_are('public', 'claims', 'anon', array[]::name[]);

-- Column-exact grants for authenticated ----------------------------------
select * from column_privs_are('public', 'events', 'id', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'owner_id', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'name', 'authenticated', array['SELECT', 'INSERT', 'UPDATE']);
select * from column_privs_are('public', 'events', 'event_date', 'authenticated', array['SELECT', 'INSERT']);
select * from column_privs_are('public', 'events', 'timezone', 'authenticated', array['SELECT', 'INSERT']);
select * from column_privs_are('public', 'events', 'share_token', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'unlockable_at', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'auto_reveal_at', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'revealed_at', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'created_at', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'events', 'updated_at', 'authenticated', array['SELECT']);

select * from column_privs_are('public', 'items', 'id', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'items', 'event_id', 'authenticated', array['SELECT', 'INSERT']);
select * from column_privs_are('public', 'items', 'title', 'authenticated', array['SELECT', 'INSERT', 'UPDATE']);
select * from column_privs_are('public', 'items', 'notes', 'authenticated', array['SELECT', 'INSERT', 'UPDATE']);
select * from column_privs_are('public', 'items', 'link', 'authenticated', array['SELECT', 'INSERT', 'UPDATE']);
select * from column_privs_are('public', 'items', 'price_range', 'authenticated', array['SELECT', 'INSERT', 'UPDATE']);
select * from column_privs_are('public', 'items', 'created_at', 'authenticated', array['SELECT']);
select * from column_privs_are('public', 'items', 'updated_at', 'authenticated', array['SELECT']);

-- No role has DELETE on any public table -------------------------------
select ok(not has_table_privilege('authenticated', 'public.events', 'DELETE'), 'authenticated has no DELETE on events');
select ok(not has_table_privilege('authenticated', 'public.items', 'DELETE'), 'authenticated has no DELETE on items');
select ok(not has_table_privilege('authenticated', 'public.claims', 'DELETE'), 'authenticated has no DELETE on claims');

-- As anon, a direct select on any table is denied ------------------------
set local role anon;
select * from throws_ok($$ select * from public.events $$, '42501');
select * from throws_ok($$ select * from public.items $$, '42501');
select * from throws_ok($$ select * from public.claims $$, '42501');

select * from finish();

rollback;
