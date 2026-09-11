# Surprise-Rule Data Contract (F-02) Implementation Plan

## Overview

Ship GIN's first database contract: the `events` / `items` / `claims` schema, with the organizer-blindness rule and the single-claim guarantee enforced **in Postgres**. That means explicit grants, RLS, one reveal-gate helper, and SECURITY DEFINER bodies in an unexposed `private` schema. The work also includes:

- a test runner (Vitest), plus a pgTAP suite that locks both guarantees
- a thin `server-only` data-access layer (DAL) that downstream slices (S-01 to S-05) consume instead of writing their own queries
- the PRD, roadmap and doc corrections that the research decisions imply
- a manual push of the migrations to the hosted project

## Current State Analysis

- **Nothing to migrate from.** There is no schema, no `supabase/migrations/`, no `seed.sql`, no generated types and no test runner (`research.md` §2, §5).
- **Postgres is the only security boundary.** Every Supabase client uses the anon key under RLS, and no service-role key exists, by decision (`context/changes/deployment/deployment-plan.md:141`). Middleware is only a UX layer (`src/utils/supabase/proxy.ts:84-86`).
- **Grants are explicit or absent.** `supabase/config.toml:19-24` leaves `auto_expose_new_tables` unset, so new tables get no Data API grants locally. The hosted default is unverified. Enforcement on all projects begins 2026-10-30.
- **The shared list already has a public route prefix.** `/lists/` is allowlisted (`src/lib/auth/routes.ts:54-61`). Server Actions posted from there pass middleware unauthenticated, so every claim rule has to hold in the database.
- **The status vocabulary exists.** `BadgeStatus = "available" | "taken" | "mine" | "given"` (`src/components/status-badge/status-badge.tsx:3`). There is deliberately no "hidden" variant.
- **Unit-test targets are queued** from F-01 (`context/archive/2026-09-07-email-password-auth/plan.md:446-450`, `reviews/impl-review.md:99`).
- **The local stack needs colima.** colima is not running right now. Supabase CLI 2.109.0 is installed. The local auth rate limit is `sign_in_sign_ups = 30` per 5 minutes (`supabase/config.toml:230`), and email confirmations are off (`:249`).

## Desired End State

**Access, by role:**

- **Anonymous visitors**
  - With a valid share token they get the event and its items, with `status = null` on every item.
  - With a wrong token they get zero rows.
  - They have no direct table access at all (`42501`).
- **A signed-in guest** sees `available` / `taken` / `mine` for each item (and `given` after the reveal). The guest can claim an unclaimed item exactly once per item, while the list is unrevealed.
- **The organizer**
  - Sees `status = null` on every item until the reveal, whether or not claims exist, under refresh, direct URL access and concurrency.
  - After the reveal sees `available` / `taken` / `given`.
  - **Never sees claimer identity, before or after the reveal.**
  - Cannot claim on their own list.
  - Can unlock manually from 00:00 on `event_date + 1` in the event's timezone. The automatic reveal is at 00:00 on `event_date + 2` in that timezone.
  - Cannot change `event_date` or `timezone` after creation.

**Claiming and "given":**

- Under a true race, exactly one claim per item succeeds. Every loser gets `23505`, which the DAL maps to `already_taken`.
- Claims close at the reveal.
- "Given" is one irreversible mark. Either the claimer or the organizer can set it, only after the reveal. A repeat mark does nothing.

**Tooling and docs:**

- Test commands: `pnpm test` (unit), `pnpm test:db` (pgTAP) and `pnpm test:integration` (a local-stack race test) all pass.
- Both migrations are live on the hosted project.
- Security Advisor shows no RLS-disabled, definer-in-exposed-schema or function-search-path-mutable findings. The Auth "Leaked password protection" warning is accepted while the project is on the Free plan (that feature is Pro-only).
- The PRD and roadmap describe the rule as built.

### Key Discoveries:

- **RLS filters rows, not columns.** So the claims table gets **zero** grants for the API roles, and every claim read or write goes through an RPC (`research.md` External §A).
- **`UNIQUE(item_id)` is the only race-safe single-claim.** A trigger that checks `IF EXISTS` first is not race-safe (`research.md` External §D).
- **An UPDATE with a WHERE clause needs the SELECT privilege and the SELECT policies.** That is why "mark given" and "unlock" are RPCs, not direct column updates. The claims table then never needs a SELECT grant.
- **Supabase calls return errors; they don't throw.** Destructure `data` and `error` everywhere (`context/foundation/lessons.md:19-24`).
- **No viewer-agnostic caching.**
  - Never use `unstable_cache`, `force-cache` or `revalidate` on list reads (`research.md` §3).
  - There is no server cache store (`open-next.config.ts:6`).
  - Make routes dynamic explicitly with `await connection()`.
- **The Edge-purity rule.** `src/lib/auth/{routes,redirect}.ts` stay free of Node built-ins, Supabase and zod. The new `src/lib/lists/` code must never be imported from middleware.

## What We're NOT Doing

- Any UI or route: no `/lists/[token]` page, no organizer pages and no Server Actions. Those belong to S-01 to S-05.
- A profiles table or display names. The organizer never sees claimer identity.
- Unclaiming (FR-012), un-marking "given", item deletion, or event archive and delete.
- Share-link revocation or rotation. The column exists, so rotation stays possible later.
- Key hygiene: server-only env vars, `sb_publishable_…` keys, and removing `client.ts` (research Q14, a separate change).
- Abuse controls: CAPTCHA, email confirmation and rate limits (Q15).
- CI gating of tests (Q11, local only), and the preview-URL guard (Q10, still an open, tracked trigger).
- Component, ARIA and jsdom tests (queued F-03 targets stay queued).
- Realtime publication of any table.

## Implementation Approach

**Deny by default, then open the minimum.**

1. The first migration revokes default privileges in `public`.
2. Each table is created with RLS enabled and **column-scoped** grants per role. Nothing gets `DELETE`, and `anon` gets nothing.
3. Owners use RLS-scoped direct table access for their own `events` and `items`.
4. Everything that touches claims, or crosses the owner boundary, is an RPC:
   - `get_shared_event`, `get_shared_items`, `claim_item`, `mark_given`, `unlock_event`
   - each built as a thin `security invoker` SQL wrapper in `public` over a `security definer` body in `private` (with `set search_path = ''`)
5. **One gate definition.** `private.reveal_open(event_id)` is `now() >= auto_reveal_at OR revealed_at IS NOT NULL`, evaluated on the database clock. The reveal instants are precomputed as `timestamptz` by a trigger, from the immutable `event_date` and IANA `timezone`.
6. **Error contract.** Business-rule rejections raise `SQLSTATE P0001` with a stable key in `MESSAGE`. The DAL maps each key, plus `23505` and `42501`, to a typed `ListErrorCode`.

**Testing layers:**

- pgTAP is the primary lock.
- Vitest covers the pure TypeScript: the error mapping, the token format, and the queued F-01 functions.
- One Vitest integration test fires N real signed-in clients at `claim_item` at the same moment.

## Critical Implementation Details

- **Time travel in pgTAP.** `event_date` must be today or later and is immutable, so a revealed event can't be created through the API. Inside the test transaction, as `postgres` (the table owner), run `alter table public.events disable trigger events_guard`. Then write `unlockable_at` / `auto_reveal_at` / `revealed_at` directly and re-enable the trigger. The transaction rolls back at the end. `now()` is frozen at the start of the transaction, so all assertions in one file see the same clock.
- **Order the claim checks so failures can't be used as an oracle.**
  - In `private.claim_item`, check authentication, then that the item exists, then ownership, then the reveal gate, and only then insert. An owner therefore always gets `owner_cannot_claim`, whether or not the item is taken.
  - In `private.mark_given`, check the reveal gate **before** looking at whether a claim exists. An owner before the reveal therefore always gets `not_revealed`.
  - pgTAP asserts both properties.
- **Serialize manual unlock against claims.** `private.claim_item` takes `SELECT … FOR SHARE` on the event row before inserting, and `private.unlock_event` updates that row. A claim therefore either commits before the unlock or sees the reveal. The automatic time-based reveal can't be serialized: a claim that starts a millisecond before `auto_reveal_at` may commit just after it. This is accepted (research Q4).
- **Trigger functions don't need `EXECUTE` grants** at fire time, but column `DEFAULT` expressions do. So generate `share_token` in the `BEFORE INSERT` trigger, not as a column default that calls a `private` function. `gen_random_bytes` lives in the `extensions` schema (pgcrypto) and must be schema-qualified under `search_path = ''`.
- **`server-only` throws under Vitest** (no `react-server` condition). Alias it to an empty stub in `vitest.config.mts`. Put everything worth unit-testing in modules that don't import `server-only`.

## Phase 1: Test Harness and Housekeeping

### Overview

Install Vitest with separate `unit` and `integration` projects, add the test scripts, cover the queued F-01 pure functions, and correct the "no test runner / not yet wired" statements.

### Changes Required:

#### 1. Dependencies and scripts

**File**: `package.json`

**Intent**: Add the test runner and the `server-only` guard package (pnpm only), rename the package, and expose one script per test layer.

**Contract**:
- `name`: `bootstrap-scaffold` becomes `gin`.
- New devDependency: `vitest`, pinned to `~4.1` (Vitest 5 changes how projects inherit config). New dependency: `server-only`.
- Scripts:
  - `"test": "vitest run --project unit"`
  - `"test:watch": "vitest --project unit"`
  - `"test:integration": "dotenv -e .env.localdb -- vitest run --project integration"` (the same env mechanism as `dev:local`)
  - `"test:db": "supabase test db"`

#### 2. Vitest config

**File**: `vitest.config.mts` (new, repo root)

**Intent**: Configure two node-environment projects and resolve the repo's import conventions.

**Contract**:
- `resolve.alias`:
  - `@` points to `new URL('./src/', import.meta.url).pathname`
  - `server-only` points to an empty stub module (for example `vitest.server-only-stub.ts` at the root)
- `projects`:
  - `unit` includes `src/**/*.test.ts` and excludes `src/**/*.integration.test.ts`
  - `integration` includes `src/**/*.integration.test.ts`, with a `testTimeout` of about 30s
- Both use `environment: 'node'` and set `extends: true`. In Vitest 4, inline projects inherit **nothing** from the root config by default, so without it the `@` and `server-only` aliases don't resolve.

#### 3. Queued unit tests (colocated)

**Files**:
- `src/lib/auth/redirect.test.ts`
- `src/lib/auth/routes.test.ts`
- `src/lib/auth/schemas.test.ts`

**Intent**: Lock the F-01 security-relevant pure functions now that a runner exists.

**Contract**:
- `safeReturnTo`
  - Rejects `https://evil.example`, `//evil.example`, `/\evil.example`, `/.//evil`, `/%2e%2e//evil`, C0 control characters, `""` and `null`, returning `/` for each.
  - Accepts `/`, `/lists/abc` and `/events/1?tab=x#h` unchanged.
- `isPublicRoute`
  - Returns true for `/`, `/login`, `/signup`, `/auth/confirm`, `/api/health` and `/lists/abc`.
  - Returns false for `/events`, `/events/new`, `/auth/other`, `/listsx` and `/anything`.
  - Note that `/design-system` is public under `NODE_ENV=test`.
- `SignUpSchema` / `SignInSchema`
  - A padded email is trimmed and accepted.
  - A malformed email is rejected.
  - Sign-up rejects a 7-character password.
  - Sign-in accepts a 1-character password.

#### 4. Housekeeping statements

**Files**: `CLAUDE.md`, `README.md`

**Intent**: Remove the statements this change makes false.

**Contract**:
- `CLAUDE.md` §Commands:
  - Add `pnpm test`, `pnpm test:db` and `pnpm test:integration`, with a one-line note that the last two need `colima start` and `supabase start`.
  - Delete "No test runner is configured yet — add one before writing tests."
  - In §Stack, change "Supabase … (not yet wired)" to state that it is wired: anon key plus RLS, with migrations in `supabase/migrations/`.
- `README.md` §Checks (line 140): replace the "No test runner" line with the three test commands and their prerequisites.

### Success Criteria:

#### Automated Verification:

- Unit tests pass: `pnpm test`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- Deliberately break `safeReturnTo` (for example, remove the `url.pathname.startsWith("//")` check) and confirm `pnpm test` fails, then revert.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Schema, Write Rules and Privileges (migration 1)

### Overview

Create the deny-by-default schema, including the tables, triggers, grants, RLS policies and write RPCs. Lock the privilege model, the gate, and single-claim with pgTAP.

### Changes Required:

#### 1. Migration: `surprise_rule_schema`

**File**: `supabase/migrations/<timestamp>_surprise_rule_schema.sql` (via `supabase migration new surprise_rule_schema`)

**Intent**: The whole write-side contract, in one reviewed file, ordered as described below.

**Contract** (in file order):

1. **Default-privilege lockdown.** `alter default privileges for role postgres in schema public revoke all on tables / sequences / functions from anon, authenticated, service_role`. This only removes Supabase's per-schema grants. It **cannot** remove PUBLIC's built-in `EXECUTE` on functions, because a per-schema default can't revoke a global one (Postgres docs, `ALTER DEFAULT PRIVILEGES`). So function privileges are set explicitly on each function (see **Function privileges** below). Make sure `pgcrypto` exists in `extensions` (`create extension if not exists pgcrypto with schema extensions`).
2. **Schema `private`.**
   - `revoke all … from public`
   - `grant usage … to anon, authenticated`: needed because RLS policies and the public wrappers call into it
   - it is never listed in `[api] schemas`
3. **`public.events`**
   - Columns:
     - `id uuid pk default gen_random_uuid()`
     - `owner_id uuid not null default auth.uid() references auth.users on delete cascade`
     - `name text not null`, 1–120 characters after trim
     - `event_date date not null`
     - `timezone text not null`
     - `share_token text not null unique`
     - `unlockable_at timestamptz not null`
     - `auto_reveal_at timestamptz not null`
     - `revealed_at timestamptz null`
     - `created_at` / `updated_at timestamptz not null default now()`
   - Index on `owner_id`.
4. **`public.items`**
   - Columns:
     - `id uuid pk`
     - `event_id uuid not null references events on delete cascade`
     - `title text not null`, 1–200 characters
     - `notes text null`, at most 2000 characters
     - `link text null`, at most 2048 characters, with `check (link ~* '^https?://')`: blocks stored `javascript:` URLs
     - `price_range text null`, at most 50 characters
     - `created_at` / `updated_at`
   - Index on `event_id`.
5. **`public.claims`**
   - Columns:
     - `id uuid pk`
     - `item_id uuid not null unique references items on delete cascade`: **the single-claim guarantee**
     - `claimer_id uuid not null references auth.users on delete cascade`
     - `created_at timestamptz not null default now()`
     - `given_at timestamptz null`
     - `given_by uuid null references auth.users`
   - `check ((given_at is null) = (given_by is null))`
   - Index on `claimer_id`.
6. **Trigger `events_guard`** (`BEFORE INSERT OR UPDATE`, function `private.events_guard()`):
   - On INSERT:
     - Validate `timezone` against `pg_catalog.pg_timezone_names`. If invalid, raise `invalid_timezone`.
     - Reject `event_date < (now() at time zone timezone)::date` with `event_date_in_past`.
     - Compute `unlockable_at = ((event_date + 1)::timestamp at time zone timezone)` and `auto_reveal_at = ((event_date + 2)::timestamp at time zone timezone)`.
     - Generate `share_token = translate(encode(extensions.gen_random_bytes(16), 'base64'), '+/=', '-_')`, 22 URL-safe characters.
     - Force `revealed_at = null`.
   - On UPDATE:
     - Raise `event_date_immutable` if `event_date`, `timezone`, `owner_id`, `share_token`, `unlockable_at` or `auto_reveal_at` changed.
     - Set `updated_at = now()`.
7. **Trigger `items_touch`** (`BEFORE UPDATE`): sets `updated_at = now()` (research Q9).
8. **Helpers** (`security definer`, `stable`, `set search_path = ''`, `EXECUTE` granted to `authenticated` only):
   - `private.is_event_owner(p_event_id uuid) returns boolean`
   - `private.reveal_open(p_event_id uuid) returns boolean`: returns `false` when the event isn't found
9. **Grants and RLS (`authenticated` only; `anon` gets none; nothing gets `DELETE`):**
   - `events`
     - Grants: `select`, `insert (name, event_date, timezone)`, `update (name)`.
     - Policies: select/update `using (owner_id = (select auth.uid()))`; insert `with check (owner_id = (select auth.uid()))`.
   - `items`
     - Grants: `select`, `insert (event_id, title, notes, link, price_range)`, `update (title, notes, link, price_range)`.
     - Policies:
       - select `using (private.is_event_owner(event_id))`
       - insert `with check (private.is_event_owner(event_id) and not private.reveal_open(event_id))`
       - update `using (private.is_event_owner(event_id)) with check (private.is_event_owner(event_id) and not private.reveal_open(event_id))`. The `USING` clause is required: an UPDATE policy with no `USING` targets no rows (Postgres applies an always-false clause).
       - Together these make the list read-only after the reveal.
   - `claims`: RLS enabled, **no grants and no policies**, to any API role.
10. **Write RPCs.** Each is a `private` definer body plus a `public` `security invoker` SQL wrapper with the same signature. The wrappers **and their private bodies** are granted `EXECUTE` to `authenticated` only. An invoker wrapper runs as the caller, so the caller needs `EXECUTE` on the body too (see **Function privileges** below).
    - `claim_item(p_item_id uuid) returns void`
      1. `auth.uid()` is null → `not_authenticated`
      2. The item isn't found → `item_not_found`
      3. Take `for share` on the event row.
      4. The caller owns the event → `owner_cannot_claim`
      5. The reveal is open → `claims_closed`
      6. Insert with `claimer_id = auth.uid()`. The unique index raises `23505` for a race loser.
    - `mark_given(p_item_id uuid) returns void`
      1. No user → `not_authenticated`
      2. The item isn't found → `item_not_found`
      3. The reveal isn't open → `not_revealed`
      4. There is no claim → `not_claimed`
      5. The caller is neither the claimer nor the owner → `not_permitted`
      6. Otherwise run `update … set given_at = now(), given_by = auth.uid() where item_id = p_item_id and given_at is null`. When zero rows match, the call does nothing.
    - `unlock_event(p_event_id uuid) returns void`
      1. The caller isn't the owner, or the event doesn't exist → `event_not_found` (the same key for both, so it can't be used to enumerate events)
      2. `now() < unlockable_at` → `unlock_too_early`
      3. The event is already revealed, or `now() >= auto_reveal_at` → nothing happens
      4. Otherwise set `revealed_at = now()`.

Every error is `raise exception '<key>' using errcode = 'P0001'`. The keys are: `not_authenticated`, `item_not_found`, `owner_cannot_claim`, `claims_closed`, `not_revealed`, `not_claimed`, `not_permitted`, `event_not_found`, `unlock_too_early`, `invalid_timezone`, `event_date_in_past` and `event_date_immutable`.

**Function privileges (explicit, per function).** Directly after each `create function`, run `revoke execute on function <fn>(<args>) from public, anon, authenticated`. Then grant exactly:

- `private.is_event_owner`, `private.reveal_open` → `authenticated`
- `private.claim_item`, `private.mark_given`, `private.unlock_event` and their `public` wrappers → `authenticated`
- `private.events_guard` and the `items_touch` trigger function → no grants (triggers don't need them)

Phase 3's read functions follow the same pattern, granted to `anon, authenticated`.

**Pinned `search_path` on every function.** This applies to the `public` invoker wrappers and both trigger functions as well as the definers. Every function is declared with `set search_path = ''` and schema-qualifies everything it calls. Supabase lint 0011 (function_search_path_mutable) flags any function without it, not just definers.

#### 2. pgTAP: privileges

**File**: `supabase/tests/01_privileges.test.sql`

**Intent**: Lock the least-privilege model so no future migration can quietly widen it.

**Contract**:
- Each file follows the pattern `begin; create extension if not exists pgtap with schema extensions; select plan(n); … select * from finish(); rollback;`.
- Assertions:
  - Every `public` base table has `relrowsecurity`.
  - `anon` has no table privileges in `public`.
  - `authenticated` has exactly the table and column privileges listed above.
  - No role has `DELETE` on any `public` table.
  - No API role has any privilege on `claims`.
  - No `prosecdef` function exists in `public`.
  - Every function in `public` and `private` has `search_path=''` in `proconfig`: wrappers, definer bodies, helpers and trigger functions.
  - `EXECUTE` on every function in `public` **and** `private` matches the grants exactly. Check with `has_function_privilege` for `anon` and `authenticated`, which counts PUBLIC. For example, `anon` can't execute `claim_item`, `private.claim_item`, `private.reveal_open` or `private.events_guard`, and `authenticated` can execute `private.claim_item`.
  - As `anon`, `select` from each table throws `42501`.

#### 3. pgTAP: events, items, gate

**File**: `supabase/tests/02_events_items.test.sql`

**Intent**: Prove the ownership rules, the creation rules, date immutability, and the reveal-instant arithmetic.

**Contract**:
- Fixture users are inserted into `auth.users` as `postgres`. Impersonate with `set local role authenticated` plus `set_config('request.jwt.claims', json_build_object('sub', <uuid>, 'role', 'authenticated')::text, true)`.
- Cases:
  - An owner can insert, select and update `name`.
  - A stranger's `select` returns empty for someone else's events and items, and their updates affect 0 rows.
  - `update event_date` as `authenticated` → `42501` (column privilege).
  - The same update as `postgres` → `event_date_immutable`.
  - A past date → `event_date_in_past`. Today in the event's timezone is accepted.
  - `Mars/Olympus` → `invalid_timezone`.
  - `2026-12-24` with `Europe/Warsaw` gives `unlockable_at = 2026-12-24 23:00Z` and `auto_reveal_at = 2026-12-25 23:00Z`.
  - `share_token` matches `^[A-Za-z0-9_-]{22}$`.
  - `link = 'javascript:alert(1)'` is rejected.
  - Item insert and update after the reveal (time-travelled) → `42501`.
  - `items.updated_at` advances on update.

#### 4. pgTAP: claims, given, unlock

**File**: `supabase/tests/03_claims.test.sql`

**Intent**: Lock single-claim, owner exclusion, claim closing, the "given" rules and the unlock rules, all through the RPCs.

**Contract**:
- Claiming:
  - A guest's `claim_item` succeeds.
  - A second guest's claim → `23505`.
  - The same guest claiming two different items both succeed.
  - The owner claiming an unclaimed item **and** a claimed item both give `owner_cannot_claim`.
  - `claim_item` as `anon` → `42501`.
  - `claim_item` after the reveal → `claims_closed`, both after a manual unlock and after a time-travelled `auto_reveal_at`.
- Direct table access: `insert into claims` / `select from claims` / `update claims` as `authenticated` → `42501`.
- Marking given:
  - Before the reveal, `mark_given` by the owner gives `not_revealed` on both a claimed and an unclaimed item.
  - After the reveal:
    - The claimer's mark sets `given_by`.
    - A second mark by the owner does nothing, and `given_by` is unchanged.
    - A stranger → `not_permitted`.
    - An unclaimed item → `not_claimed`.
- Unlocking:
  - Before `unlockable_at` → `unlock_too_early`.
  - A non-owner → `event_not_found`.
  - After `unlockable_at`, the reveal opens.
  - A repeat unlock does nothing.

### Success Criteria:

#### Automated Verification:

- Local stack is up: `colima start --cpu 4 --memory 6 && supabase start`
- Migration applies from scratch: `supabase db reset`
- pgTAP suites pass: `pnpm test:db`
- Existing checks still pass: `pnpm typecheck && pnpm lint && pnpm test`

#### Manual Verification:

- Studio (http://localhost:54323) → Advisors shows no "RLS disabled", no "security definer in exposed schema" and no "function search path mutable" findings.
- Read the migration top to bottom against the grants table in this phase. Every `grant` should be intentional, and `delete` should appear nowhere.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Shared-List Read RPCs (migration 2)

### Overview

Add the only read path for the shared list: two token-scoped RPCs that derive a per-viewer status, with no enumeration and no claimer identity. Lock the full viewer matrix with pgTAP.

### Changes Required:

#### 1. Migration: `shared_list_rpcs`

**File**: `supabase/migrations/<timestamp>_shared_list_rpcs.sql`

**Intent**: Token-scoped reads that are safe for `anon`. This is the single place where claim state becomes a status.

**Contract**:
- Both functions are `private` definer bodies (`stable`, `set search_path = ''`) with `public` invoker SQL wrappers. After `revoke execute … from public, anon, authenticated` on each, `EXECUTE` on both the wrappers and the bodies is granted to `anon, authenticated`.
- `get_shared_event(p_token text) returns table (id uuid, name text, event_date date, timezone text, reveal_open boolean, is_owner boolean)`
  - Returns 0 or 1 rows. An unknown token returns 0 rows.
  - `is_owner` is `false` for `anon`.
- `get_shared_items(p_token text) returns table (id uuid, title text, notes text, link text, price_range text, status text)`
  - Returns 0 rows for an unknown token.
  - Rows are ordered by `created_at, id`.
  - `status` is derived in this order:
    1. `auth.uid()` is null → `null`
    2. The caller is the owner and the reveal isn't open → `null`
    3. There is no claim → `'available'`
    4. `given_at` is not null → `'given'`
    5. `claimer_id = auth.uid()` → `'mine'`
    6. Otherwise → `'taken'`
  - **Neither function returns `claimer_id`, `given_by`, claim timestamps or any count.**

#### 2. pgTAP: read matrix

**File**: `supabase/tests/04_shared_list.test.sql`

**Intent**: Prove the organizer-blindness guarantee for every viewer type, before and after the reveal, and prove that nothing can be enumerated.

**Contract**:
- Fixture: one event with three items: one unclaimed, one claimed by guest A, and one claimed by guest B.
- Before the reveal:
  - `anon` → every status `null`, and all item fields present.
  - Guest A → `available` / `mine` / `taken`.
  - The owner → every status `null`. Use `results_eq` against a constant `null` set, which proves claimed and unclaimed items can't be told apart.
- After the reveal (time-travelled, with guest A's item marked given):
  - The owner → `available` / `given` / `taken`, and never `mine`.
  - Guest A → `available` / `given` / `taken`.
- Other cases:
  - A wrong token and a malformed token → `is_empty` for both functions, for both roles.
  - As a stranger, `select * from items` / `events` is empty.
  - The result column sets of both functions (from `pg_proc.proargnames`) contain none of `claimer_id`, `given_by`, `claimer` or `count`.

### Success Criteria:

#### Automated Verification:

- Migrations apply from scratch: `supabase db reset`
- All pgTAP suites pass: `pnpm test:db`

#### Manual Verification:

- Use `curl` against the local API (`http://127.0.0.1:54321`) with the local anon key. The app doesn't need to run:
  - `POST /rest/v1/rpc/get_shared_items` with a real token → items with `"status": null`
  - with a bogus token → `[]`
  - `GET /rest/v1/items` → permission denied

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: TypeScript Contract

### Overview

Give the slices one audited, typed path to the contract:
- generated DB types and a typed server client
- a `server-only` DAL in `src/lib/lists/` with a pure error mapper
- unit tests, plus a real concurrent-claim race test against the local stack
- lint guards that keep future code off the unsafe paths

### Changes Required:

#### 1. Generated types and typed server client

**Files**: `src/utils/supabase/database.types.ts` (generated), `package.json`, `src/utils/supabase/server.ts`, `eslint.config.mjs`

**Intent**: Type every RPC and table call, and regenerate the types with one command.

**Contract**:
- Script `"db:types": "supabase gen types typescript --local --schema public > src/utils/supabase/database.types.ts"`.
- `createServerClient<Database>(…)` in `server.ts`. `client.ts` and `proxy.ts` stay untouched (Q14).
- Add the generated file to eslint `globalIgnores`.

#### 2. Pure DAL modules (no `server-only`)

**Files**: `src/lib/lists/types.ts`, `src/lib/lists/errors.ts`, `src/lib/lists/token.ts`

**Intent**: The code that is worth unit-testing and safe to import anywhere.

**Contract**:
- `types.ts`:
  - `ItemStatus = "available" | "taken" | "mine" | "given"`. It must stay assignable to `BadgeStatus`; enforce this with a type-level assertion.
  - `SharedEvent { id; name; eventDate; timezone; revealOpen; isOwner }`.
  - `SharedItem { id; title; notes; link; priceRange; status: ItemStatus | null }`.
  - `ListResult = { ok: true } | { ok: false; code: ListErrorCode }`.
- `errors.ts`:
  - `ListErrorCode` is the union of the P0001 keys plus `already_taken` and `unknown`.
  - `mapRpcError(error: RpcError): ListErrorCode`, where `RpcError = { code: string; message: string }` is a local structural type. A `PostgrestError` satisfies it, and the module never imports `@supabase/*`.
    - `23505` → `already_taken`
    - `42501` → `not_authenticated`
    - `P0001` with a known message → that key
    - anything else → `unknown`
- `token.ts`: `isShareToken(value: string): boolean`, matching `^[A-Za-z0-9_-]{22}$`.

#### 3. Server-only DAL

**File**: `src/lib/lists/shared-list.ts`

**Intent**: The single entry point that S-02, S-03 and S-05 call. It never caches and never reads the claims table.

**Contract**:
- Begins with `import "server-only"`. Each function builds its client with `await createClient()` from `@/utils/supabase/server`, and read functions call `await connection()` from `next/server` first.
- Functions:
  - `getSharedList(token: string): Promise<{ event: SharedEvent; items: SharedItem[] } | null>`
    - Returns `null` without calling the database when the token fails `isShareToken`.
    - Otherwise calls both RPCs in `Promise.all`, destructures `data` and `error` for each, and returns `null` when the event is missing.
  - `claimItem(itemId: string): Promise<ListResult>`
  - `markGiven(itemId: string): Promise<ListResult>`
  - `unlockEvent(eventId: string): Promise<ListResult>`
- No barrel `index.ts`. Never imported from `middleware.ts`, `routes.ts` or `redirect.ts`.

#### 4. Unit tests

**Files**: `src/lib/lists/errors.test.ts`, `src/lib/lists/token.test.ts`

**Intent**: Lock the mapping that the S-03 race-loser UX depends on.

**Contract**:
- Every P0001 key round-trips.
- `23505` → `already_taken`.
- `42501` → `not_authenticated`.
- An unknown P0001 message and an unknown code → `unknown`.
- The token accepts a real 22-character value, and rejects 21 or 23 characters, `+`, `/`, `=` and an empty string.

#### 5. Concurrency integration test

**File**: `src/lib/lists/claim-race.integration.test.ts`

**Intent**: The one guarantee pgTAP can't express: a true multi-connection race on `claim_item`.

**Contract**:
- Uses `@supabase/supabase-js` `createClient(URL, ANON_KEY, { auth: { persistSession: false } })`, with URL and key from `.env.localdb`. It needs no service key.
- Setup:
  - Sign up one owner and **5** guests with unique `@example.com` emails. That is 6 auth calls, comfortably under the local limit of 30 per 5 minutes.
  - The owner inserts an event (`event_date` = today + 7 days, `UTC`) and one item through the tables.
- Fire `Promise.all` of 5 `rpc('claim_item')` calls.
- Assert:
  - exactly 1 has `error === null`
  - the other 4 map to `already_taken`
  - the owner's `get_shared_items(token)` returns `status: null` for the item
  - a guest's `get_shared_items(token)` returns `taken` or `mine` as appropriate
- Skip with a clear message when the env vars are absent.

#### 6. Lint guards

**Files**: `eslint.config.mjs`, `src/utils/supabase/errors.ts` (new), `src/app/api/health/route.ts`, `src/app/auth/confirm/route.ts`

**Intent**: Make the no-cache and single-DAL rules mechanical.

**Contract**: For `src/**`, extend `no-restricted-imports` with:
- `importNames: ["unstable_cache"]` from `next/cache`
- `@supabase/supabase-js` and `@supabase/ssr` with `allowTypeImports: true`. Value imports are allowed only in `src/utils/supabase/**` and `**/*.integration.test.ts`, through a later override block.

That override block must re-declare the `next/link` restriction, because flat config replaces the whole rule. The existing `src/components/link/**` override currently sets the rule to `"off"`. Narrow it so it re-declares only the Supabase and `unstable_cache` restrictions and drops just `next/link`.

Existing importers that must comply (otherwise `pnpm lint` fails):
- `src/app/auth/confirm/route.ts:1`: rewrite `import { type EmailOtpType }` as `import type { EmailOtpType }`.
- `src/app/api/health/route.ts:2`: the value import `isAuthRetryableFetchError` moves behind a re-export from `src/utils/supabase/errors.ts`, and the route imports it from there.

### Success Criteria:

#### Automated Verification:

- Types regenerate with no diff: `pnpm db:types && git diff --exit-code src/utils/supabase/database.types.ts`. Run this only after the generated file is committed. `git diff` ignores untracked files, so before the commit the check can't fail.
- Unit tests pass: `pnpm test`
- Race test passes against the local stack: `pnpm test:integration`
- Type checking passes: `pnpm typecheck`
- Linting passes, including the new guards: `pnpm lint`
- Production build passes: `pnpm build`

#### Manual Verification:

- Add a temporary `import { unstable_cache } from "next/cache"` and a temporary `import { createClient } from "@supabase/supabase-js"` in a `src/app` file. Confirm `pnpm lint` fails on both, then revert.
- Run `pnpm test:integration` three times in a row. It passes every time: it isn't flaky, and it doesn't trip the rate limit.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 5: Docs and Hosted Rollout

### Overview

Bring the PRD, roadmap and supporting docs in line with the rule as built, record the still-open preview-URL trigger, and push the migrations to the hosted project (a human step).

### Changes Required:

#### 1. PRD amendments

**File**: `context/foundation/prd.md`

**Intent**: Make the PRD describe the enforced rule (research Q1, Q2, Q4, Q5, plus this plan's decisions). Mark each amended spot "(amended 2026-09-11, F-02)".

**Contract**:
- **FR-003.** The event also has an IANA timezone, defaulting to the organizer's browser timezone. The date is today or later. Date and timezone can't change after creation.
- **FR-004.** The link must be `http(s)`.
- **FR-008.** Claims close at the reveal. The organizer can't claim on their own list.
- **FR-010, US-02 AC3.** "Given" is one irreversible mark, set by whichever party marks it first. This replaces "independently".
- **FR-011 and its Socrates note.**
  - Automatic reveal at 00:00 on `event_date + 2` in the event's timezone.
  - Manual unlock by the organizer from 00:00 on `event_date + 1`.
  - The organizer sees status, never claimer identity.
  - This replaces "no early unlock", with the second-account rationale recorded.
- **US-01 AC1 and the Access Control section.** Signed-out visitors see items but no status. Status requires sign-in.
- **Business Logic.** Replace "On and after the event date" with the precise reveal rule.

#### 2. Roadmap alignment

**File**: `context/foundation/roadmap.md`

**Intent**: Keep the downstream slices consistent with the contract. Status fields are untouched, since `/10x-implement` and `/10x-archive` own them.

**Contract**:
- F-02 **Unknowns**: resolve the RLS vs query-filter question as "RLS plus `private.reveal_open`; no parallel app-side filter".
- S-02 **Outcome and Risk**: signed-out visitors see items only; status requires sign-in; the list is read via `getSharedList`.
- S-03 **Unknowns**: the race loser receives `already_taken` from the DAL; the UX is still S-03's decision.
- S-05 **Outcome and Risk**: the reveal timing as above; a single irreversible "given" mark; no claimer identity for the organizer.
- Bump the frontmatter `updated:`.

#### 3. Stale docs and the open trigger

**Files**:
- `context/foundation/infrastructure.md`
- `context/changes/bootstrap-verification/verification.md`
- `context/changes/deployment/deployment-plan.md`
- `CLAUDE.md`

**Intent**: Remove the service-role instructions, mark the Vercel/GitHub Actions record as superseded, record the preview-URL trigger as still open, and give future agents the contract's three rules.

**Contract**:
- `infrastructure.md`:
  - Rewrite the :80 Secrets bullet: v1 has no runtime Supabase secret; anon key plus RLS only.
  - Drop `SUPABASE_SERVICE_ROLE_KEY` from Getting Started step 4 (:106).
  - Risk register :90: replace "(query-level filter on event date)" with "RLS plus `private.reveal_open` in Postgres, see F-02".
  - Risk register :97 ("No test runner configured yet"): mark it resolved by F-02 (Vitest plus pgTAP), without repeating the phrase "No test runner".
- `verification.md`: add a top note that it is superseded by the Cloudflare Workers / Workers Builds deployment (`context/changes/deployment/`).
- `deployment-plan.md`: under the preview-guardrail line (:201), add a dated note.
  - F-02 landed the claim schema and policies with no UI.
  - Previews still hit production.
  - The trigger remains open, deferred by the user to the staging-environment lesson, and must fire before S-02/S-03 ship UI.
- `CLAUDE.md` §Key business logic:
  - Rewrite the :11 sentence. "before the event date" becomes "before the reveal (automatic at 00:00 on event_date + 2 in the event's timezone; manual unlock from event_date + 1)". "(query-level filter on event date)" becomes "enforced in Postgres by RLS and the `private.reveal_open` RPC gate — never by a parallel app-side filter".
  - Add three bullets.
  - Claims are reachable only through the `get_shared_*` / `claim_item` / `mark_given` / `unlock_event` RPCs.
  - List reads go through `src/lib/lists/shared-list.ts`, never cached.
  - Every new table ships its grant, RLS and pgTAP coverage in the same migration.

#### 4. Hosted rollout (human)

**Intent**: Apply both migrations to production while no code reads the schema yet, and verify the privilege model on the real project.

**Contract**:
1. The human runs `supabase db push` from this branch, after confirming `supabase migration list` shows only the two new migrations pending.
2. Run a read-only verification.

### Success Criteria:

#### Automated Verification:

- All local suites pass one final time: `pnpm test && pnpm test:db && pnpm test:integration`
- Type checking, lint and build pass: `pnpm typecheck && pnpm lint && pnpm build`
- No stale statements remain: `grep -n "not yet wired\|No test runner\|SUPABASE_SERVICE_ROLE_KEY\|query-level filter" CLAUDE.md README.md context/foundation/infrastructure.md` returns nothing
- Committed types still match the final schema: `pnpm db:types && git diff --exit-code src/utils/supabase/database.types.ts`

#### Manual Verification:

- The human runs `supabase db push`, and `supabase migration list` shows both migrations applied remotely.
- The hosted Dashboard → Advisors → Security shows no RLS-disabled, definer-in-exposed-schema or function-search-path-mutable findings. On the Free plan, the Auth "Leaked password protection" warning is expected and accepted.
- Anon probes against the hosted URL with the anon key:
  - `GET /rest/v1/events?select=*` → permission denied
  - `POST /rest/v1/rpc/get_shared_items {"p_token":"x"}` → `[]`
  - `POST /rest/v1/rpc/claim_item` → permission denied
- Production `/api/health` still returns 200.
- The PRD, roadmap and CLAUDE.md edits read correctly to someone who wasn't in the planning session.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests:

- `safeReturnTo`, including the open-redirect and dot-segment cases. `isPublicRoute`, both allowlist and denylist. The auth schemas.
- `mapRpcError` for every error key, plus `23505`, `42501` and unknown codes. The `isShareToken` boundaries.

### pgTAP (primary lock, `supabase/tests/`):

- **Privileges:**
  - RLS is on everywhere.
  - `anon` has no table access.
  - Column-exact grants for `authenticated`.
  - No `DELETE`.
  - The claims table is sealed.
  - No definer function in `public`.
  - `search_path` is pinned.
- **Write rules:**
  - Owner-only CRUD.
  - Date and timezone are immutable.
  - Creation dates are today or later.
  - Timezone validation.
  - The reveal-instant arithmetic.
  - http(s)-only links.
  - Items are read-only after the reveal.
- **Claims:**
  - Single-claim (`23505`).
  - Owner exclusion that can't be used as an oracle.
  - Claims close at the manual and at the automatic reveal.
  - The claims table can't be touched directly.
  - The "given" ordering and the repeat-mark no-op.
  - The unlock window.
- **Reads:** the full viewer × reveal matrix, wrong tokens, no enumeration, and no identity columns.

### Integration Tests:

- A 5-client concurrent `claim_item` race on the local stack: exactly one winner, and the owner is still blind.

### Manual Testing Steps:

1. Advisors are clean on local (Phase 2) and on hosted (Phase 5).
2. The `curl` probes as `anon` return exactly the permitted surface (Phases 3 and 5).
3. The lint guards fire on deliberately bad imports (Phase 4).
4. The race test is repeatable three times in a row (Phase 4).

## Performance Considerations

- The claim path is one RPC round-trip: one indexed lookup, a `FOR SHARE` lock on the event row, and one insert. That is well within the 1-second NFR.
- `getSharedList` makes 2 RPCs in parallel. Both are indexed (`share_token` unique, `items.event_id`, `claims.item_id` unique).
- The RLS helpers are wrapped as `(select auth.uid())` or called per row on small owner-scoped sets. The 1000-row PostgREST cap (`config.toml:18`) is far above any realistic list.

## Migration Notes

- Both migrations are additive. There are no existing objects, and the default-privilege revoke affects only objects created afterwards.
- A hosted migration **does not roll back with the Worker**. Any fix after the Phase 5 push is a new forward migration. Dropping or altering production Postgres objects is a human-only action (`infrastructure.md:81-82`).
- **Previews still run against the production database** (`deployment-plan.md:274`). The preview-URL guard at `deployment-plan.md:201` stays open and tracked (research Q10). It must fire before any claim or reveal UI ships.
- Local test data from the integration test builds up across runs. `supabase db reset` clears it.

## References

- Research: `context/changes/surprise-rule-data-contract/research.md` (decisions Q1–Q15)
- Roadmap item: `context/foundation/roadmap.md:81-93` (F-02)
- Prior decisions: `context/changes/deployment/deployment-plan.md:141,201,258-260`
- Server Action and client patterns: `src/app/actions/auth.ts`, `src/utils/supabase/server.ts`
- Queued test targets: `context/archive/2026-09-07-email-password-auth/plan.md:446-450`
- Status vocabulary: `src/components/status-badge/status-badge.tsx:3`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Test Harness and Housekeeping

#### Automated

- [x] 1.1 Unit tests pass: `pnpm test` — 4aeb9df
- [x] 1.2 Type checking passes: `pnpm typecheck` — 4aeb9df
- [x] 1.3 Linting passes: `pnpm lint` — 4aeb9df
- [x] 1.4 Production build passes: `pnpm build` — 4aeb9df

#### Manual

- [x] 1.5 Deliberately broken `safeReturnTo` makes `pnpm test` fail, then reverted — 4aeb9df

### Phase 2: Schema, Write Rules and Privileges (migration 1)

#### Automated

- [x] 2.1 Local stack is up: `colima start --cpu 4 --memory 6 && supabase start` — 39671cc
- [x] 2.2 Migration applies from scratch: `supabase db reset` — 39671cc
- [x] 2.3 pgTAP suites pass: `pnpm test:db` — 39671cc
- [x] 2.4 Existing checks still pass: `pnpm typecheck && pnpm lint && pnpm test` — 39671cc

#### Manual

- [x] 2.5 Local Studio Advisors show no RLS-disabled / definer-in-exposed-schema findings — 39671cc
- [x] 2.6 Migration read top-to-bottom; every grant intentional, no `delete` — 39671cc

### Phase 3: Shared-List Read RPCs (migration 2)

#### Automated

- [x] 3.1 Migrations apply from scratch: `supabase db reset` — 68281c7
- [x] 3.2 All pgTAP suites pass: `pnpm test:db` — 68281c7

#### Manual

- [x] 3.3 Local `curl` probes: real token → null statuses; bogus token → `[]`; `GET /rest/v1/items` → permission denied — 68281c7

### Phase 4: TypeScript Contract

#### Automated

- [x] 4.1 Types regenerate with no diff: `pnpm db:types && git diff --exit-code src/utils/supabase/database.types.ts` — a4a0019
- [x] 4.2 Unit tests pass: `pnpm test` — a4a0019
- [x] 4.3 Race test passes against the local stack: `pnpm test:integration` — a4a0019
- [x] 4.4 Type checking passes: `pnpm typecheck` — a4a0019
- [x] 4.5 Linting passes including new guards: `pnpm lint` — a4a0019
- [x] 4.6 Production build passes: `pnpm build` — a4a0019

#### Manual

- [x] 4.7 Lint guards fire on temporary `unstable_cache` and supabase-js imports, then reverted — a4a0019
- [x] 4.8 `pnpm test:integration` passes three consecutive runs — a4a0019

### Phase 5: Docs and Hosted Rollout

#### Automated

- [x] 5.1 All local suites pass: `pnpm test && pnpm test:db && pnpm test:integration`
- [x] 5.2 Type checking, lint and build pass: `pnpm typecheck && pnpm lint && pnpm build`
- [x] 5.3 No stale statements remain (grep returns nothing)
- [x] 5.9 Committed types still match the final schema

#### Manual

> Note on 5.6: the anon probes pass identically before and after the push,
> because the `xmax` leak found in the implementation review was reachable by
> an **authenticated organizer**, not by anon. They confirm the anon surface
> and catch regressions; they are not evidence the leak fix landed. The
> discriminating check is the `pg_class.relacl` / `pg_attribute.attacl`
> query in `reviews/impl-review.md` (F1), still outstanding.

- [x] 5.4 Human ran `supabase db push`; `supabase migration list --linked` shows all five migrations Local == Remote (the two originals plus the three impl-review fixes)
- [ ] 5.5 Hosted Security Advisor clean
- [x] 5.6 Hosted anon probes return only the permitted surface — 9/9: direct select on events/items/claims and on `items.xmax` all `42501`; both `get_shared_*` return `[]` for a bogus token; `claim_item` and `unlock_event` denied to anon
- [x] 5.7 Production `/api/health` returns 200 (https://gin.andrzej-pigon.workers.dev, checked pre- and post-push)
- [ ] 5.8 PRD / roadmap / CLAUDE.md edits read correctly cold
