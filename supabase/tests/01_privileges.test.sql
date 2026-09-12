-- Locks the least-privilege model so no future migration can quietly widen
-- it: RLS everywhere, anon has zero table access, authenticated has exactly
-- the grants the Phase 2 migration lists, nothing gets DELETE, claims is
-- sealed, no SECURITY DEFINER function lives in an exposed schema, every
-- function has search_path pinned, and EXECUTE matches the grants exactly.
begin;

create extension if not exists pgtap with schema extensions;

select plan(40);

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
        ('public.unlock_event(uuid)', 'anon', false),
        -- Read RPCs (20260911221653): EXECUTE to anon AND authenticated, on
        -- both the public wrappers and the private definer bodies.
        ('public.get_shared_event(text)', 'authenticated', true),
        ('public.get_shared_event(text)', 'anon', true),
        ('public.get_shared_items(text)', 'authenticated', true),
        ('public.get_shared_items(text)', 'anon', true),
        ('private.get_shared_event(text)', 'authenticated', true),
        ('private.get_shared_event(text)', 'anon', true),
        ('private.get_shared_items(text)', 'authenticated', true),
        ('private.get_shared_items(text)', 'anon', true)
    )
    select fn || ' / ' || role || ' expected ' || should
    from expected
    where has_function_privilege(role, fn, 'EXECUTE') is distinct from should
  $$,
  'EXECUTE grants match the contract exactly for anon and authenticated'
);

-- ... and no function grants EXECUTE to PUBLIC -----------------------------
-- The allowlist above is an enumeration: it says nothing about a function a
-- FUTURE migration adds. PUBLIC holds EXECUTE on every new function by
-- default, so without the global default-privilege revoke in
-- 20260911232448 a forgotten `revoke` would silently expose it to anon.
-- `proacl is null` means the default ACL (PUBLIC has EXECUTE); `=X/` is an
-- explicit grant to PUBLIC.
select * from is_empty(
  $$
    select n.nspname || '.' || p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/')
  $$,
  'no function in public or private grants EXECUTE to PUBLIC'
);

-- Table-level privileges ------------------------------------------------
-- authenticated holds NO table-level privilege at all: SELECT, INSERT and
-- UPDATE are every one of them column-scoped. Table-level SELECT would also
-- grant the system columns (`xmax`, `ctid`, ...), and `xmax` leaks claim
-- state to the organizer before the reveal -- see the
-- 20260911231857_column_scoped_select migration.
select * from table_privs_are('public', 'events', 'authenticated', array[]::name[]);
select * from table_privs_are('public', 'items', 'authenticated', array[]::name[]);
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

-- System columns are not reachable ---------------------------------------
-- A table-level SELECT would grant these; a column-scoped one does not.
-- `xmax` is the organizer-blindness leak (see 20260911231857), so it is
-- pinned here as a privilege invariant rather than only as a behaviour test.
select ok(not has_table_privilege('authenticated', 'public.events', 'SELECT'), 'authenticated has no table-level SELECT on events (blocks xmax)');
select ok(not has_table_privilege('authenticated', 'public.items', 'SELECT'), 'authenticated has no table-level SELECT on items (blocks xmax)');

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
