---
date: 2026-09-11T20:56:58+02:00
researcher: Claude (claude-opus-5)
git_commit: 4afc479c8170090b570b8af91dda790742b9fa24
branch: GIN-9-surprise-rule-data-contract
repository: apigon/gift-I-need
topic: "F-02 surprise-rule-data-contract — schema, organizer-blindness gate, atomic single-claim, test runner"
tags: [research, codebase, supabase, rls, postgres, organizer-blindness, claims, testing, pgtap, vitest, nextjs-caching]
status: complete
last_updated: 2026-09-11
last_updated_by: Claude (claude-opus-5)
last_updated_note: "Added follow-up research on public Supabase URL/anon key exposure and how to harden the Data API"
---

# Research: F-02 surprise-rule-data-contract

**Date**: 2026-09-11T20:56:58+02:00
**Researcher**: Claude (claude-opus-5)
**Git Commit**: 4afc479c8170090b570b8af91dda790742b9fa24
**Branch**: GIN-9-surprise-rule-data-contract (linked to issue #9)
**Repository**: apigon/gift-I-need

Permalink base for code refs: `https://github.com/apigon/gift-I-need/blob/4afc479c8170090b570b8af91dda790742b9fa24/<path>#L<n>`

## Research Question

What does the codebase already do, and what does current Supabase, Postgres and Next.js 16 guidance say, that constrains F-02? F-02 is the roadmap item that delivers:

1. the minimal schema for events, items and claims
2. data-layer enforcement of organizer-blindness: no claim status, claimer identity or claim counts before the event date, holding under concurrency, refresh and direct URL access
3. an atomic single-claim-per-item guarantee
4. a test runner, plus at least one test that locks both guarantees (roadmap `F-02`, `context/foundation/roadmap.md:81-93`)

Scope: F-02 plus the downstream consumers (S-01/S-02/S-03/S-05), covering both internal research (codebase and prior changes) and external research (Context7 and Exa). It covers the roadmap's open question on where the date gate is enforced, and ends with a recommendation.

## Summary

- **The ground is clean and deliberately prepared.**
  - There is no schema, no `supabase/migrations/`, no type generation, no ORM and no test runner.
  - Every Supabase client uses the **anon key and RLS only**. No service-role key exists anywhere, by recorded decision (`deployment-plan.md:141`).
  - The fail-closed route allowlist already reserves the public prefix `/lists/` for the shared list (`src/lib/auth/routes.ts:54-61`).
  - So F-02's policies are the only thing between the browser (which holds the anon key) and the claim data. The shape of UI queries protects nothing.
- **Postgres enforcement is the only layer that holds.** The anon key is public by design (and must be treated as public). *Correction (see Follow-up 2026-09-11): today it is not actually in the client bundle, because the browser client is unused.* So any table, view or function granted to `anon`/`authenticated` can be called directly through PostgREST. An app-side "query filter" can be bypassed. The CLAUDE.md rule ("query-level filter on event date") is satisfied by an RLS policy, which Postgres applies as a `WHERE` on every query. The deployment plan already read it that way (`deployment-plan.md:141`).
- **Two findings reshape the design:**
  1. **RLS filters rows, not columns.** Supabase docs say column-level security needs column privileges, a separate table, or a view or function. Any "taken" signal stored on a row the organizer can read (for example `items.is_taken`) leaks. Claim state must live where the organizer's reads are gated, and the guest read path must return "taken" without the claimer's id.
  2. **The organizer and guests share the `authenticated` role, and the shared link is public.** When signed in, the organizer can be excluded by identity. When signed out, or on a second account, the organizer looks exactly like a guest, and the PRD requires anonymous visitors to see taken/available status (`prd.md:59,166`). **The data layer cannot close this.** It is a product decision to record, not an implementation detail.
- **Single-claim: `UNIQUE(item_id)` on claims is atomic by construction.** Under concurrent requests the loser gets `23505`. A check-then-insert, or a trigger running `IF EXISTS`, still races under READ COMMITTED.
- **Explicit GRANTs are mandatory.** Local `config.toml` leaves `auto_expose_new_tables` unset, so new `public` tables get no Data API grants by default. Supabase enforces this on hosted projects from **2026-10-30**. Every table and RPC needs explicit `grant` statements alongside `enable row level security` and its policies. This also gives per-role column control for free.
- **Testing:**
  - pgTAP via `supabase test db` is the idiomatic way to test RLS, grants and constraints. Supabase ships documented patterns (`set local role`, `request.jwt.claim.sub`, `throws_ok '42501'`, `is_empty`).
  - Vitest is the idiomatic TypeScript runner. F-01 and F-03 have queued unit targets waiting for it. It is also the only practical way to run a true two-connection concurrency test.
  - Both are free/OSS.
- **Contradictions and unknowns the plan must settle:**
  - whether the gate lifts "after" or "on" the date, and in which timezone
  - whether the organizer may claim their own items
  - how "given" is stored
  - the format of the share token
  - whether the deployment plan's hard trigger for guarding preview URLs fires on this branch

## Detailed Findings

### 1. Existing Supabase and auth surface

**Clients.** All three read `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`:
- `src/utils/supabase/server.ts:9-33` is built per request, never as a module global (`:4-5`; a Workers constraint). The comment at `:6-7` names RLS with `auth.uid()` as the organizer-blindness enforcer.
- `src/utils/supabase/client.ts:3-12` is browser-side: "anon-key + RLS only, no service_role".
- `src/utils/supabase/proxy.ts:43-65` is the middleware client. It copies Supabase's no-store headers when cookies rotate (`:11-13`, `:51-62`).

**Service-role key.** It is absent from `src/`, `wrangler.jsonc`, `open-next.config.ts`, `cloudflare-env.d.ts` and `.env*`. The decision is at `context/changes/deployment/deployment-plan.md:141-142`: any future use must be deliberate, server-only and reviewed, with a test proving it can't touch claim-status reads before the date.
- **Stale doc:** `context/foundation/infrastructure.md:80,106` still prescribes `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`. It is superseded.
- **Temptation point:** `README.md:96` notes that `supabase status` prints the local service key. Test fixtures must not reach for it except for deliberate setup.

**Routing model.** The allowlist fails closed (`src/lib/auth/routes.ts:1-8`: "every edit is security-relevant"):
- Public exact paths (`:41-51`) and one public prefix, `/lists/` (`:54-61`), declared ahead of time for FR-007.
- Anything else redirects to `/login`: 307 for GET and HEAD, **303 for Server Action POSTs** (`proxy.ts:104-118`, matching lesson "`NextResponse.redirect` is 307").
- The redirect layer is UX. `proxy.ts:84-86` says "RLS remains the real guarantee".

**Server Action pattern.** `src/app/actions/auth.ts` has the signature `(prevState: FormState, formData: FormData) => Promise<FormState>`, consumed via `useActionState`:
- zod 4 `safeParse`, then `z.flattenError(...).fieldErrors` (`:67-77`).
- Supabase errors are read from the returned `error`, never caught with try/catch (`:85-87`).
- `FormState` (`src/lib/auth/schemas.ts:38-58`) has `errors` typed to auth fields only. `:43-45` asks for it to be generalised into `src/lib/forms/` once S-01/S-04 need it.
- **No action currently calls `getUser()`, and there is no "require user" helper.** A claim action will need one.

**Middleware gap for claims.** Server Actions POST to the page path (`proxy.ts:93-94`), and `/lists/*` is public. So a claim POST from the shared-list page **passes middleware unauthenticated**. The action must call `getUser()`, and RLS `WITH CHECK` must require `auth.uid()`.
- Keep organizer UI **out of** `/lists/`: the prefix match would make it public.
- Don't give data routes image-like URLs, which the middleware matcher skips (`src/middleware.ts:26`, `routes.ts:17-21`).

**Health route.** `src/app/api/health/route.ts:12-24` only calls `auth.getUser()`. It never touches PostgREST, so it will not detect missing grants or migrations.

### 2. `supabase/config.toml` and local tooling

| Setting | Line | What it means for F-02 |
|---|---|---|
| `[api] schemas = ["public","graphql_public"]`, `extra_search_path` | `:13-15` | Tables go in `public`. Keep SECURITY DEFINER helpers in an **unexposed** schema such as `private`. |
| `max_rows = 1000` | `:18` | PostgREST caps responses at 1000 rows. |
| `auto_expose_new_tables` commented out (unset) | `:19-24` | New tables, views, sequences and functions get **no** grants to `anon`/`authenticated`/`service_role`. Explicit GRANTs are required. |
| `[db] major_version = 17` | `:42` | The hosted project is 17.6.1.141 (`supabase/.temp/postgres-version`). `security_invoker` views are available (PG15+). |
| `[db.migrations] schema_paths = []` | `:59-64` | Classic `supabase/migrations/` layout. **The directory does not exist.** |
| `[db.seed] sql_paths = ["./seed.sql"]` | `:66-71` | **`supabase/seed.sql` does not exist.** |
| `[realtime] enabled = true` | `:87-88` | Tables aren't in the `supabase_realtime` publication. If they're added later, Postgres Changes apply the table's RLS (see External §E). |
| `enable_anonymous_sign_ins = false` | `:195` | Every claimer is a real account. |
| `[experimental.pgdelta] enabled = true` | `:436-441` | Diff engine for `db diff`/`pull`. |

**Tooling:**
- Supabase CLI 2.109.0 is installed via Homebrew. It is not a devDependency.
- Docker comes through **colima, which is not running** at research time. `colima start --cpu 4 --memory 6` then `supabase start` is required (`README.md:33`, `deployment-plan.md:59-66`).
- `[analytics]` is disabled because the vector container breaks on colima (`config.toml:411-416`).
- `pnpm dev:local` runs Next against the local stack using `.env.localdb` (`README.md:55-70`). The local DB URL is `postgresql://postgres:postgres@127.0.0.1:54322/postgres`.

**Migration workflow** (`deployment-plan.md:258-260`):
1. `supabase migration new`
2. `supabase db reset` locally
3. Build and test organizer-blindness locally
4. Promote with `supabase db push`. This is manual; **no CI runs the Supabase CLI** (`:50`).

**Production Postgres safety.** Migrations don't roll back with the Worker, and dropping or altering production Postgres is human-only (`infrastructure.md:81-82`).

### 3. Next.js 16 caching and data access

- **`cacheComponents` is off** (`next.config.ts:4-6`), so the pre-Cache-Components model applies (`node_modules/next/dist/docs/01-app/02-guides/caching-without-cache-components.md`).
- **supabase-js fetches aren't cached by default.** postgrest-js passes no `cache` option (`node_modules/.pnpm/@supabase+postgrest-js@2.110.0/.../dist/index.cjs:298-303`), so Next's "auto no cache" default applies (`03-api-reference/04-functions/fetch.md:52`).
- **Caveat:** fetches *before* any request-time API can be cached (`caching-without-cache-components.md:111`). The server client awaits `cookies()` first, which is safe. A cookie-less anon client for the public page would lose that protection.
- **Every route is dynamic today, but only incidentally.** The root layout renders `AuthStatus`, which calls `getUser()` and so `cookies()` (`src/app/layout.tsx:41-45`). Dynamic pages are sent `private, no-store` (`02-guides/cdn-caching.md:24`). If that component ever moves, surprise-rule routes could turn static. Make the requirement explicit with `await connection()` in the data layer, or `dynamic = 'force-dynamic'`.
- **There is no server-side cache store.** `open-next.config.ts:6` is `defineCloudflareConfig({})`, so the incremental, tag and queue caches are all `dummy`. The R2 bucket is commented out in `wrangler.jsonc:9-17`.
  - **Rule for the plan:** never wrap event, item or claim reads in `unstable_cache`, `force-cache`, `next.tags`, or a route-level `revalidate`. Any of these keys the result without the viewer and would carry a value past the gate. `React.cache` is fine: it is request-scoped (`01-getting-started/06-fetching-data.md:724`).
- **Making a claim show as "taken" immediately:**
  - Return the new state from the action for `useActionState`, and/or call `refresh()` or `revalidatePath('/lists/<token>')` from `next/cache` inside the action (`refresh.md:6-10`, `revalidatePath.md:16,26`).
  - `updateTag` isn't needed, since there are no tagged entries. Single-argument `revalidateTag` is deprecated.
  - Back/forward navigation can still show a stale status (`staleTimes.md:35-36`).
  - `notify` toasts are client-only (F-03 impl-review F7), so the action must return state.
- **Recommended data-layer shape** (Next docs `02-guides/data-security.md:55-65,391-431`): a `server-only` data-access layer that does the auth checks, with thin `"use server"` actions calling it. Fits the repo as `src/lib/<feature>/`, with no barrel, never imported from `middleware.ts`/`routes.ts`/`redirect.ts`, which are Edge-pure (`routes.ts:23-26`).

### 4. Status vocabulary (design system)

`src/components/status-badge/status-badge.tsx:3`:

```ts
export type BadgeStatus = "available" | "taken" | "mine" | "given"
```

- The type was deliberately named so it doesn't pre-empt F-02's domain type (`context/archive/2026-09-10-design-system-baseline/plan.md:288`).
- There is deliberately **no "hidden" variant**: "the organizer view has nothing to leak" (`plan.md:53`).

Consequences for the schema:
- **`mine` depends on the viewer, so it isn't stored.** Store claim existence and the given state, then derive the badge per viewer:
  - no claim → `available`
  - someone else's claim → `taken`
  - the viewer's claim → `mine`
  - given → `given`
- **Deriving `mine` needs `claimer = auth.uid()`** without handing the claimer's id to other viewers. Either compute it server-side in Postgres, or expose only the viewer's own claims.
- **The organizer's pre-gate read must return "no status", not an empty claim set.** A UI that maps "no claim rows" to `available` would still be fine to show, since it's indistinguishable from reality. But showing every item as "Available" to the organizer is misleading UI, and FR-011 says the organizer view shows *no claim information*. Have the data contract return status as **absent** (for example `null` or a separate type) for the owner before the gate, so the UI cannot draw a badge at all.

### 5. Prior decisions and constraints (history)

- **"No service_role in v1"**, reveal via RLS `USING (event_date < now())`, and signup-side rows via a SECURITY DEFINER trigger (`deployment-plan.md:141`).
- **Hard trigger for guarding preview URLs:** "before the first commit that adds claim/reveal/organizer-view code, gate preview URLs behind Cloudflare Access *or* point previews at a separate Supabase project" (`deployment-plan.md:201`).
  - Previews currently hit **production data** (`deployment-plan.md:274`).
  - F-02 adds claim *schema and policies*, not UI. Whether the trigger fires here or at S-02/S-03 is an open question.
- **Test runner:** F-02 owns the choice (`roadmap.md:64`, `README.md:140`, `CLAUDE.md` "No test runner is configured yet").
  - Tests go "next to the code under test" (`CLAUDE.md` code-structure, `context/archive/2026-09-07-email-password-auth/plan.md:444`).
  - Unit targets are queued for the runner:
    - `safeReturnTo`, `isPublicRoute` and the auth schemas (`email-password-auth/plan.md:446-450`)
    - the open-redirect cases `/.//evil` and `/%2e%2e//evil` (`email-password-auth/reviews/impl-review.md:99`)
    - ARIA and label behaviour of the StatusBadge, Input, Button and Alert primitives (`design-system-baseline/plan.md:503-508`)
- **Earlier plans were never automatically tested.** Both F-01 and F-03 verified by typecheck, lint, build and manual checks, with phases shaped as Overview → Changes → Success Criteria (Automated / Manual) → pause.
- **Lessons that apply:**
  - `context/foundation/lessons.md:19-24`: Supabase calls **return** errors, they don't throw. A race loser's `23505` arrives in `error`; destructure both `data` and `error`.
  - The 303-for-non-GET lesson applies to any new route.
- **CI:** Cloudflare Workers Builds only (`deployment-plan.md:188,196-197`), and it runs no lint, typecheck or tests. `.github/` holds only the PR template. A test gate would need either a prefixed build command or a GitHub Actions workflow.

### 6. PRD requirements that pin the schema

- **Event:** name plus a **required** date, the trigger for post-event mode (`prd.md:108-109`).
- **Item:** title; optional notes, link (free text) and price range (`prd.md:111`, `:174`). Edit-only, no deletion (`prd.md:115,178`). Only the creating organizer adds or edits (`prd.md:177`).
- **Claims:**
  - one per item (`prd.md:48`)
  - irreversible in v1 (`prd.md:125`)
  - sign-in required (`prd.md:124`)
  - a user may claim several items in one event; FR-013 is only a parked soft warning (`prd.md:142-143`). So there must be **no** per-user-per-event uniqueness.
- **Claimer identity** is never visible to other guests (`prd.md:127`, FR-009).
- **"Given":** either the claimer or the organizer can mark it, "independently", after the date (`prd.md:73,131`).
- **The claim must confirm within 1 second** (`prd.md:150`).
- **What must stay hidden:** claim status, claimer identity and claim counts, "under all conditions including concurrent updates, page refresh, and direct URL access" (`prd.md:151`).

## External Research (Context7 and Exa)

### A. RLS cannot hide columns (Supabase docs)

- "RLS … doesn't give you control over which columns they can access within rows" ([Column Level Security](https://supabase.com/docs/guides/database/postgres/column-level-security)).
- Supabase marks column privileges as an **advanced feature it does not recommend for most users**. It recommends RLS plus a dedicated table instead.
- Column privileges also break `select *` for restricted roles.
- Options for hiding the claimer's id:
  1. a column-scoped `grant select (…)`
  2. a separate table holding the claimer's identity
  3. a `security_invoker` view that omits the column
  4. a SECURITY DEFINER function

### B. Views and SECURITY DEFINER (Supabase RLS guide)

- "Views bypass RLS by default because they are usually created with the `postgres` user". Use `with (security_invoker = true)` on PG15+ ([RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)).
- SECURITY DEFINER functions run as their owner, which bypasses RLS on `postgres`-owned tables. So they must:
  - use `set search_path = ''` with fully schema-qualified names
  - never live in an exposed schema ("should never be created in a schema in the 'Exposed schemas'")
  - have `EXECUTE` revoked from `public`/`anon` where it isn't needed
- They are the standard way to break policy recursion. For example, a claims policy needs "is the viewer the event owner, and has the reveal opened?", which means looking at `items` and `events`.
- **Performance:** wrap `auth.uid()` and helper functions as `(select auth.uid())` so they run once per statement (initPlan), and index every column a policy filters on.

### C. Explicit grants now required ([Supabase changelog, 2026-04-28](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically); CLI [#5524](https://github.com/supabase/cli/pull/5524))

- New `public` tables are not reachable by Data API roles without an explicit `grant`.
  - Default for new projects: 2026-05-30.
  - **Enforced on all existing projects: 2026-10-30.**
  - The local CLI's unset `auto_expose_new_tables` now means "revoke".
- The prescribed unit per table is:
  1. `grant` per role
  2. `enable row level security`
  3. `create policy`
- A missing grant returns `42501` "permission denied for table", **before** RLS runs. Supabase-js exposes this as `error.code === '42501'`, and `error.hint` carries the GRANT to run (Context7 `/supabase/supabase`, "handling errors in supabase-js").

### D. Atomic single-claim (PostgreSQL docs plus engineering write-ups)

- **Unique index.** A `UNIQUE` constraint is arbitrated by the index at insert time. The second concurrent insert gets `SQLSTATE 23505`, and there is no check-then-insert (TOCTOU) window.
- **Conditional UPDATE is also atomic** (for example `UPDATE items SET claimed_by = … WHERE id = … AND claimed_by IS NULL`, checking affected rows). Under READ COMMITTED the WHERE is re-evaluated against the latest committed row ([PG docs §13.2](https://www.postgresql.org/docs/current/transaction-iso.html)).
  - **But it puts claim state on `items`, which the organizer must read.** That conflicts with Finding A.
- **A `BEFORE INSERT` trigger with `IF EXISTS` is NOT atomic** under READ COMMITTED. Two new rows never conflict until an index arbitrates, so a sequential test will make the trigger look correct.
- **Therefore:** a dedicated claims table with `UNIQUE (item_id)`, and the loser mapped from `23505` in the action. This is also what answers S-03's open question on race-loser UX (`roadmap.md:144`).

### E. Realtime and RLS ([Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [Postgres Changes](https://supabase.com/docs/guides/realtime/postgres-changes))

- "When using Postgres Changes on tables with RLS, database records are sent only to clients who are allowed to read them."
  - Policies are evaluated when the client connects and are cached for that connection.
  - **DELETE events are not RLS-filtered.** Irrelevant here, since claims are never deleted in v1.
  - A time-gated policy is evaluated per event against the connection's JWT.
- Broadcast and Presence are a separate layer, governed by `realtime.messages` RLS.
- Realtime is out of scope for v1 (`tech-stack.md` `has_realtime: false`). The point is that **gating in RLS automatically covers any future realtime path**, whereas an app-side filter would not.

### F. Time and timezones

- "Every Supabase database is set to UTC timezone by default" ([DB configuration](https://supabase.com/docs/guides/database/postgres/configuration)).
- `current_date` and `date` comparisons depend on the session timezone.
- A **`date`** column compared with `now()` flips at **00:00 UTC of the event day** ("on"). **`event_date + 1 day`** flips at the end of the day in UTC ("after").
- For organizers who aren't on UTC, both are wrong by hours unless the event stores an IANA timezone, or a precomputed `reveal_at timestamptz`.
- Always gate on the **database clock** (`now()` inside the policy), never on the app server's `new Date()`.

### G. Testing (Context7 `/supabase/supabase`, `/supabase/cli`, `/vitest-dev/vitest/v4.1.6`, `/vercel/next.js/v16.2.9`)

**pgTAP:** the Supabase-documented path.
- `supabase test new <name>.test` creates the file; `supabase test db` runs `supabase/tests/*.sql` against the local stack.
- Canonical assertions:
  - `set local role anon|authenticated`
  - `set local request.jwt.claim.sub = '<uuid>'` to impersonate a user
  - `throws_ok(…, '42501')` for a missing grant or a failed `WITH CHECK`
  - `is_empty(…)` for filtered reads
  - `results_eq` for positive reads
  - pair every denied write with a check that the row is intact
- One file per RLS table.
- The optional "test helpers" package (`tests.create_supabase_user`, `tests.authenticate_as`, `tests.rls_enabled('public')`) cuts boilerplate.
- Everything runs in one transaction with a rollback, so **it can prove the unique constraint exists and fires, but only one statement at a time**, not under a true race.

**Vitest 4.1:**
- `projects` can split `unit` (node env) from `integration` (node env, hitting the local stack).
- The `@/` alias needs `new URL('./src/', import.meta.url).pathname`.
- Next 16.2.9 docs: Vitest **does not support async Server Components**; use E2E for those.
- A true concurrency test for single-claim means N signed-in supabase-js clients firing `Promise.all(insert…)` against the local stack, asserting exactly one success and the rest `23505`.

**Anti-pattern:** mocking `auth.uid()` in JS. "Mock it in JS and you're testing the mock, not the policy". Impersonation must happen in a real Postgres session.

**Licences:** pgTAP (PostgreSQL licence) and Vitest (MIT) are both free/OSS, matching the user's tooling preference.

## Code References

- `src/utils/supabase/server.ts:4-7,9-33`: per-request anon client; the comment names RLS as the organizer-blindness enforcer
- `src/utils/supabase/client.ts:3-12`: browser client, anon key + RLS only
- `src/utils/supabase/proxy.ts:71-74,84-86,93-118`: `getUser()`, "RLS remains the real guarantee", 401 for `/api`, 307/303 login redirect
- `src/middleware.ts:4-15,26`: Edge middleware (deprecated convention, on purpose); matcher skips image extensions
- `src/lib/auth/routes.ts:1-8,23-26,41-61,83-89`: fail-closed allowlist, Edge-purity rule, `/lists/` forward declaration, `isPublicRoute`
- `src/lib/auth/schemas.ts:38-58`: the `FormState` union that S-01/S-04 should reuse and generalise
- `src/app/actions/auth.ts:13-16,63-92`: Server Action pattern; error-field handling; `redirect` outside try/catch
- `src/app/api/health/route.ts:12-35`: auth-only health check, no DB probe
- `src/app/layout.tsx:41-45`: `AuthStatus` makes every route dynamic, incidentally
- `src/components/status-badge/status-badge.tsx:3-10`: `BadgeStatus` vocabulary and labels
- `supabase/config.toml:13-24,42,59-71,87-88,195`: schemas, grants default, PG17, migrations and seed paths, realtime, anonymous sign-ins
- `next.config.ts:4-6`, `open-next.config.ts:2-6`, `wrangler.jsonc:9-17`: no cache components, no incremental cache, R2 deferred
- `eslint.config.mjs:32-44`: only bans `next/link`. **Nothing lint-blocks importing `createClient` from `@supabase/supabase-js` directly**, which could make the anon-only rule mechanical.
- `tsconfig.json:7,21-32`: strict; `@/*`; includes `**/*.ts`, so test files are typechecked

## Architecture Insights

1. **Postgres is the security boundary, by explicit design.** Middleware is a UX convenience (`proxy.ts:84-86`), the anon key is public, and there is no privileged client. F-02's contract therefore lives in its migrations (GRANTs, RLS, constraints, helper functions), and its tests must exercise Postgres directly.
2. **The fact that an item is taken and who took it need different visibility.** The fact must reach every guest, including anonymous ones, but never the owner before the gate. The claimer's identity may reach only the claimer, and the owner after the gate. RLS alone cannot split a row by column (External §A). The design must separate them, either by table (fact vs identity) or behind a function that returns a per-viewer status.
3. **One gate definition, reused everywhere.** A single helper, for example `private.reveal_open(event_id) returns boolean` (SECURITY DEFINER, `search_path=''`, in the unexposed `private` schema), evaluated against `now()`. It would be used by:
   - the claims SELECT policy for the owner
   - the "given" UPDATE policy
   - any read function

   This avoids a second copy of the date logic drifting in TypeScript.
4. **Claim writes: a direct insert under RLS plus a unique index is enough.** `WITH CHECK (claimer_id = (select auth.uid()) AND NOT private.is_event_owner(item_id) AND NOT private.reveal_open(...))`, together with `UNIQUE(item_id)`.
   - Postgres checks the RLS `WITH CHECK` before inserting into the unique index. So an organizer probing their own item gets `42501` whether or not it's taken, and the error can't be used to detect a claim. **The pgTAP suite should verify this explicitly.**
   - Whether claims close at the event date is a product question (§Open Questions).
5. **Fits the repo's conventions:**
   - `server-only` data access in `src/lib/<feature>/` (no barrel)
   - thin actions in `src/app/actions/<feature>.ts` (precedent) returning a generalised `FormState`
   - public read under `/lists/[token]`
   - organizer UI under a protected prefix such as `/events/…`
   - SQL tests in `supabase/tests/` (the "next to the code under test" rule, applied to SQL whose source lives in `supabase/migrations/`)
   - TS tests colocated as `*.test.ts`

## Recommendation: where to enforce the date gate

**Enforce it in Postgres RLS (and the SECURITY DEFINER helpers the policies call). Don't add a parallel app-side date filter.**

- **Only RLS holds.** The anon key is in the browser (`client.ts:3-6`), so a TypeScript filter can be bypassed by calling PostgREST directly. RLS is also what CLAUDE.md's "query-level filter" means in practice: Postgres applies the policy as a `WHERE` on every query, including direct-URL, refresh, concurrent and realtime paths (External §E).
- **"Both" adds drift, not protection.** A second copy of the date rule in TypeScript protects nothing RLS doesn't already. It adds a second clock (`new Date()` on the Worker vs `now()` in Postgres) and a second place to get the timezone wrong. Defence in depth belongs elsewhere:
  - the organizer read path must return *absent* status (§4)
  - a pgTAP suite must lock the gate
  - a lint rule should ban opt-in caching and direct `createClient` imports for these reads
- **One helper, one clock.** Define the gate once as a `private` helper function and store the gate instant in a form that makes the timezone explicit (see Open Question 1).

**Test runner recommendation:**
- **pgTAP (`supabase test db`) is the F-02 lock.** It covers RLS enabled on every table, grants per role, anon/guest/owner/claimer read matrices before and after the gate (by setting `event_date` or `reveal_at` in the past or future inside the transaction), the unique constraint firing `23505`, and the owner's claim attempt returning `42501`.
- **Vitest** is set up for the queued TypeScript unit targets. Optionally add one local-stack integration test for the true concurrent-claim race, which pgTAP can't express.
- Note that neither runs in Workers Builds today (§5, CI).

## Historical Context (from prior changes)

- `context/changes/deployment/deployment-plan.md:141-142`: no service_role; reveal as RLS `USING (event_date < now())`; future privileged use must be tested against claim-status reads
- `context/changes/deployment/deployment-plan.md:201,274`: hard trigger for guarding preview URLs; previews run against the production DB
- `context/changes/deployment/deployment-plan.md:258-260`: migration workflow (new, reset, test locally, push manually)
- `context/archive/2026-09-07-email-password-auth/plan.md:57,444-450`: "all schema" deferred to F-02; colocated-tests rule; queued unit targets
- `context/archive/2026-09-07-email-password-auth/reviews/impl-review.md:99`: open-redirect cases to verify once a runner exists
- `context/archive/2026-09-10-design-system-baseline/plan.md:53,288,503-508`: no "hidden" status; `BadgeStatus` naming defers to F-02; queued ARIA tests
- `context/foundation/infrastructure.md:79-82,90,97`: preview leak, rollback asymmetry, RLS-bypass and no-test-runner risks (with the stale service-role instructions at `:80,106`)

## Related Research

None. This is the first `research.md` in the repo. F-01 and F-03 went straight to `/10x-plan`.

## Open Questions

> **All questions (1–15) were resolved on 2026-09-11. See "Decisions on Open Questions" at the end of this document.**

1. **When does the gate lift, and in which timezone?** This blocks the schema, because it decides the column type.
   - "After the date passes" appears at `prd.md:56,72,131,134,155` and `CLAUDE.md`.
   - "On and after the event date" appears at `prd.md:157` and `roadmap.md:170`.
   - The guardrail at `prd.md:47` instead says "before the post-event confirmation step".
   - No document mentions a timezone, and the DB is UTC.
   - Options:
     - (a) a `date` with a UTC-midnight flip
     - (b) a `date` plus an IANA `timezone` column, with the gate computed as the end of the day in that zone
     - (c) a precomputed `reveal_at timestamptz` set at create or edit time
2. **What about an organizer who is signed out, or on a second account, opening their own link?** The data layer cannot distinguish them from a guest, and the PRD requires anonymous visitors to see status (`prd.md:59,166`). Accept this as a residual risk and record it in the PRD? Or require sign-in to see *status* (not the list), which conflicts with US-01 AC1? This is a product decision.
3. **Can the organizer claim items on their own list?** Nothing forbids it. Recommend forbidding it in RLS `WITH CHECK`; it also prevents the organizer using a failed claim to detect status.
4. **Do claims close at the event date?** Can a guest claim after the reveal? This decides whether `WITH CHECK` includes `NOT reveal_open`.
5. **How is "given" stored?** Either one `given_at`/`given_by` pair on the claim, or independent flags for claimer and organizer (`prd.md:73` says "independently"). It is a gated post-date UPDATE with two writers. Column-level UPDATE grants may be needed so a claimer can't rewrite `item_id` or `claimer_id`.
6. **Guest read shape.** Options:
   - (i) split the claim fact from the claimer's identity
   - (ii) column grants on a single claims table (Supabase-discouraged)
   - (iii) a per-viewer status function that returns `available/taken/mine/given`, and *absent* for the owner before the gate. This needs a SECURITY DEFINER body in an exposed schema, or an invoker wrapper around a `private` definer.

   Options (i) and (iii) are the strongest candidates. Decide in `/10x-plan`.
7. **Share token.** A random, unguessable slug separate from the event id (recommended, because the URL is public). Revocation is deferred (`prd.md:184`), but a separate column keeps rotation possible later.
8. **Price range:** one free-text field or a min/max pair (`prd.md:111`)?
9. **Is the organizer's edit really a workaround for irreversible claims?** It doesn't release a claim, and it can rewrite an item a guest already bought for (`prd.md:125`). Intended?
10. **Does the preview-URL guard (`deployment-plan.md:201`) fire on this branch?** F-02 adds claim schema and policies against a production-shared DB, with no UI yet.
11. **CI gate:** should `pnpm test` / `supabase test db` gate anything? Workers Builds runs no checks today, and there are no GitHub Actions.
12. **Housekeeping (stale docs):**
    - `infrastructure.md:80,106`: service-role instructions
    - `CLAUDE.md` "Supabase … (not yet wired)"
    - `bootstrap-verification/verification.md:23-24`: Vercel / GitHub Actions
    - `package.json` name is still `"bootstrap-scaffold"`

## Follow-up Research 2026-09-11T21:40:25+02:00

**Question (user):** `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are public. Does that mean anyone could access the DB, read users' data and change stored data? How do we fix that?

### Short answer

- **Yes, anyone holding the URL and the anon key can call the Data API directly** (`https://<ref>.supabase.co/rest/v1/…`, `/rest/v1/rpc/…`, `/graphql/v1`) as the Postgres role `anon`. After signing up for a free account, they can call it as `authenticated`.
- **No, that is not a hole by itself.** The key only identifies the *application*, not a user. What it can reach is exactly what Postgres **grants** plus **RLS policies** allow for `anon`/`authenticated`. Supabase's model is "the publishable key is taped to the front door, and it only opens the lobby" ([API keys](https://supabase.com/docs/guides/api/api-keys)).
- **The real risk is a table, view or function that is granted without RLS (or with a loose policy)**, which then becomes world-readable and writable. That is the thing to prevent, and F-02 is where it is prevented.
- **The fix is least-privilege grants, RLS on every exposed object, no public enumeration path, and tests that lock this in.** Hiding the key is optional defence in depth, not the fix.

### What is actually exposed today (internal evidence)

| Surface | Today | Evidence |
|---|---|---|
| Anon key in the browser bundle | **Not present.** 0 files in `.next/static` and `.open-next/assets` contain the key or the URL (build of 2026-09-11 13:31). `src/utils/supabase/client.ts` (the only `createBrowserClient` call) is imported nowhere. All 6 `"use client"` files use Server Actions instead. | grep of build output; `grep createBrowserClient src` |
| Anon key in the server bundle | Present (6 files under `.open-next/`). This is expected, since server and middleware clients read it. | `server.ts:13-14`, `proxy.ts:44-45` |
| Key in git | No. `.env*` is gitignored (`.gitignore:36`), and only `.env.example` is tracked. **The repo is PUBLIC** (`apigon/gift-I-need`), so this matters. | `git ls-files`, `gh repo view` |
| Key type | **Legacy JWT `anon` key** (`eyJ…`, 208 chars) on the hosted project. Supabase is deprecating it by the end of 2026. It expires 10 years after creation, and it can only be rotated by rotating the JWT secret, which signs everyone out. | `.env`; [API keys](https://supabase.com/docs/guides/api/api-keys); [JWT signing keys blog](https://github.com/supabase/supabase/blob/master/apps/www/_blog/2025-07-14-jwt-signing-keys.mdx) |
| Tables/views/functions in exposed schemas | **None.** There are no migrations yet, so `anon` can reach nothing in `public` today. | §2 (no `supabase/migrations/`) |
| User records (emails, password hashes) | In the `auth` schema, which is **not exposed** (`config.toml:13` exposes only `public`, `graphql_public`). They are unreachable through the Data API. | `config.toml:13` |
| GraphQL | `graphql_public` is exposed locally (`config.toml:13`). Since 2026-05-18, `pg_graphql` is not enabled by default on new hosted projects. | [changelog 45329](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) |
| Default grants on the hosted project | The project was created **2026-07-02** (`deployment-plan.md:48`), after the 2026-05-30 "no auto-expose" default. But the rollout was "gradual over a few weeks", so it is **unverified** whether new `public` tables auto-grant to `anon`/`authenticated` there. On the old default, *any* table created without RLS is fully readable and writable by anyone. | changelog 45329 |
| Sign-up | Open (`enable_signup = true`, `config.toml:193`). Email confirmation is off locally (`:249`), and the hosted setting is unverified. CAPTCHA is not configured (`:236-239`). **Anyone can become `authenticated` in seconds.** | `config.toml` |

**Conclusion:** there is no data at risk *today*, because there is no data surface. The risk arrives with F-02's first migration. That is why F-02 must ship the protections together with the schema, not after it.

### Threats that matter for F-02 specifically

1. **Forgotten RLS or a loose policy.** A table with grants but RLS off, or a policy like `to authenticated using (true)`, is readable and writable by any signed-up stranger. `authenticated` means "anyone with an account", not "a trusted user".
2. **Enumerating every gift list.** *This is the most likely real leak.* The PRD says "anyone with the link can view", but **RLS cannot see the URL**. If `events`/`items` get `to anon using (true)` so that `/lists/<token>` works, then `GET /rest/v1/items?select=*` returns **every item of every organizer**, and the share token protects nothing.
   - Supabase: "`to anon using (true)` grants every unauthenticated visitor read access to every row … Use it only for data that is meant to be public" ([RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security)).
3. **Views and SECURITY DEFINER functions bypass RLS.** A plain view over `claims`, or a definer function in `public`, hands out every row ("A view over a protected table hands out every row its policies were meant to withhold"; "Never create [a security definer function] in a schema listed under Exposed schemas").
4. **Writes beyond intent.** A guest `UPDATE`-ing `claimer_id`/`item_id`, anyone `DELETE`-ing claims (claims are irreversible, `prd.md:125`), or an organizer editing someone else's event. Default table grants include `DELETE`.
5. **Bulk abuse by a legitimate account.** A script that claims every item on a list it knows. RLS allows each insert individually. This is a product and rate-limit concern, not an access-control one.
6. **Leaking the key has little impact, but a secret key would be catastrophic.** The `service_role`/`sb_secret_…` key bypasses RLS. None is wired, by decision (`deployment-plan.md:141`), and it must stay that way.

### How to fix it: the layers, ranked by value

**Layer 1: deny by default, in the F-02 migration (required).**
- At the top of the first migration, revoke default privileges for `postgres` in `public` from `anon`, `authenticated` and `service_role`, as the statements in [changelog 45329](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) show. This makes the hosted project behave like local and like the post-2026-10-30 world, **regardless of which default the project got**. Existing objects are unaffected, and there are none.
- For each table, the unit is **grant (minimum) + `enable row level security` + policies**, in the same migration ([Securing your API](https://supabase.com/docs/guides/database/hardening-data-api)).
- **`anon` gets no table privileges at all.** Signed-out viewing goes through Layer 2.
- `authenticated` gets only the verbs each table needs:
  - `events`/`items`: `select, insert, update` scoped by `owner_id = (select auth.uid())`
  - `claims`: `insert`, plus a column-level `update (given…)` if "given" lives there
  - **no `delete` on anything** (edit-only items, irreversible claims)
- `service_role`: nothing, since it is unused.
- **Never** `using (true)` on a table, never a plain view over claim data, and SECURITY DEFINER only in the unexposed `private` schema with `search_path = ''` and `revoke execute … from public`.

**Layer 2: close the enumeration path (required).**
- Serve the shared list through **one token-taking function**, e.g. `rpc('get_shared_list', { token })`. It returns the event, its items and the per-viewer status (`available/taken/mine/given`, *absent* for the owner before the gate) **only for the matching share token**. Grant `execute` on it to `anon, authenticated`.
- Build it as a thin `security invoker` wrapper in `public` that calls a `security definer` body in `private`, so no definer lives in an exposed schema. This merges with Open Question 6 option (iii).
- Nobody can list rows without a valid token, and the token must be high-entropy (Open Question 7).
- Rejected alternative: passing the token as a request header read in RLS via `current_setting('request.headers')` ([documented](https://supabase.com/docs/guides/database/hardening-data-api#request-information)). It works, but it spreads the token check across every policy and is easy to forget on one table.

**Layer 3: lock it with tests (required, F-02 already plans pgTAP).** Add to the pgTAP suite:
- RLS is enabled on every `public` table (`tests.rls_enabled('public')`)
- `anon` gets `42501` on a direct `select` from every table
- `authenticated` without a token cannot list another organizer's events or items
- no role has `DELETE` on claims
- a guest cannot `update` `claimer_id`/`item_id`
- the RPC returns nothing for a wrong token

After `supabase db push`, check the Dashboard **Security Advisor** (it flags RLS-disabled and SECURITY DEFINER lints).

**Layer 4: shrink the exposed surface (recommended, cheap).**
- If GraphQL isn't used, drop `graphql_public` from `[api] schemas` (`config.toml:13`) and don't enable `pg_graphql` on the hosted project.
- Optionally move to a dedicated `api` exposed schema holding only the RPCs, with tables in an unexposed schema. This is Supabase's "Dedicated API schemas" pattern: "a dedicated schema makes the exposed surface easier to identify and audit". It is stronger, but it changes every query to `rpc()`. Worth it only if the plan leans RPC-first anyway.

**Layer 5: keep the key server-only (optional defence in depth).**
- The key is already absent from the browser.
- To make that intentional:
  - rename it to a non-`NEXT_PUBLIC_` variable (e.g. `SUPABASE_PUBLISHABLE_KEY`)
  - delete the unused `src/utils/supabase/client.ts`
  - lint-ban `createBrowserClient` and `@supabase/supabase-js`'s `createClient` outside `src/utils/supabase/`
- Then a future `"use client"` import can't silently inline it.
- **Do not rely on this.** Supabase treats any key that could be exposed as public, and a key can leak through logs or a copy-paste.
- The plan should verify that a non-`NEXT_PUBLIC` variable reaches Edge middleware on Workers. OpenNext injects `.env*` into `process.env` at runtime (`deployment-plan.md:151`), but that is untested for Edge.
- The cost is losing a direct browser client for a future realtime feature (out of scope for v1).

**Layer 6: migrate to publishable/secret API keys (recommended, before end of 2026).**
- Create an `sb_publishable_…` key in Dashboard → Settings → API Keys and swap the env value.
- Once nothing uses the legacy `anon` and `service_role` JWTs, disable them.
- A publishable key can be **rotated instantly** without signing users out, which is the real remedy if a key is abused.
- Secret keys also refuse browser `User-Agent`s.
- This is independent of F-02, so it is a small separate change or an F-02 housekeeping phase.

**Layer 7: abuse controls (later, product-dependent).**
- Turnstile CAPTCHA on sign-up (`[auth.captcha] provider = "turnstile"`, free on Cloudflare).
- Email confirmation on the hosted project.
- A PostgREST `db_pre_request` function for per-user or per-IP rate limits on the claim path ([pre-request checks](https://supabase.com/docs/guides/database/hardening-data-api#pre-request-checks)).
- None of these is needed to protect data. They limit bulk claiming and fake accounts.

### What this changes in the F-02 recommendation

- It **confirms** "RLS only, one gate helper" and adds four hard requirements to the plan:
  1. the default-privilege revoke at the top of the first migration
  2. no `anon` table grants, with the shared list served only through a token-taking RPC
  3. no `DELETE` grants
  4. pgTAP cases for enumeration and privileges
- It **corrects** the earlier wording "the anon key ships in the browser bundle". Today it does not (unused browser client). The design conclusion is unchanged, because the key must still be treated as public.

### New open questions

13. **Hosted default privileges.** Run a read-only check on the hosted project (Dashboard SQL editor: `select * from pg_default_acl;`, or `\ddp` in psql) to see whether `public` still auto-grants. The Layer 1 revoke makes the answer irrelevant going forward, but it confirms the risk model.
14. **Key hygiene scope.** Should the server-only key (Layer 5) and the publishable-key migration (Layer 6) ride along in F-02, or be a separate small change?
15. **Hosted auth settings.** Is email confirmation on? Is CAPTCHA wanted before S-02 opens claiming?

## Decisions on Open Questions (2026-09-11, user)

- **Q1 — Gate timing and timezone:**
  - **Timezone.** Each event carries an IANA timezone. It defaults to the creating user's browser timezone and the organizer can change it, for events held elsewhere in the world.
  - **Automatic unlock** at 00:00 on **event_date + 2 days** in the event's timezone. That is one full day later than "the day after".
  - **Manual unlock.** The organizer may unlock early, but only once the event date has passed (from 00:00 on event_date + 1 day in the event's timezone). This needs a stored `revealed_at` (or similar) plus a gated UPDATE.
  - **Rationale (user).** A determined organizer can spoil the surprise anyway with a second account, so manual early unlock adds no new leak.
  - **Implication.** `private.reveal_open(event_id)` = `now() >= auto_reveal_at OR revealed_at IS NOT NULL`. Prefer storing a precomputed `timestamptz` (recomputed when the date or timezone is edited) so the policy compares `now()` against one column.
- **Q2 — The organizer peeking while signed out: status requires sign-in.**
  - Signed-out visitors see the list items but no taken/available status.
  - This **changes PRD US-01 AC1** (`prd.md:59,166`), so the PRD must be updated.
  - A second account still sees status. This is accepted, per the Q1 rationale.
  - The shared-list read returns status only to `authenticated` callers, and never to the owner before the gate.
- **Q3 — The organizer may not claim on their own list.** RLS `WITH CHECK` rejects claims on events the caller owns.
- **Q4 — Claiming closes when the list is actually revealed.**
  - Claiming stays open until the reveal happens: either the organizer's manual unlock (possible from event_date + 1 day) or the automatic unlock at event_date + 2 days, both in the event's timezone. This allows a grace period for late claims if the organizer doesn't unlock early.
  - The claims `WITH CHECK` includes `NOT private.reveal_open(event_id)`.
  - After the reveal the list is read-only, except for marking items "given".
  - Consequence: the manual-unlock UPDATE and a concurrent claim INSERT race. Whichever commits first wins, and either outcome is consistent, because a claim that commits before the unlock is simply revealed with it. pgTAP should cover "a claim after the reveal is rejected".
- **Q5 — "Given" is a single `given_at` + `given_by` pair on the claim.**
  - Whoever marks it first sets it: either the claimer or the owner, only after the reveal (`prd.md:73,131` "after the date").
  - Column-level `grant update (given_at, given_by)` for `authenticated`, and a policy limiting the update to the claimer or the event owner with `reveal_open`. `given_by` must equal `auth.uid()` (`WITH CHECK`).
  - A further mark by the other party is a no-op. The UI shows "given" once either party has marked it.
  - This departs from the PRD's "independently" wording, so the PRD needs a note.
- **Q7 — The share token is a random column.** A separate unique `share_token` column with high entropy (for example 16 random bytes, base64url, generated in Postgres). It is independent of the event id, so rotation or revocation stays possible later.
- **Q8 — Price range is one free-text field.** One optional `text` column (`price_range`), with a length check in both zod and SQL.
- **Q6 — The shared list is read through a token RPC.**
  - `public.get_shared_list(token)` is a `security invoker` wrapper that calls a `security definer` body in `private` with `search_path = ''`.
  - It returns the event, its items and a per-viewer status:
    - `null` for `anon`
    - `null` for the owner before the reveal
    - `available/taken/mine/given` for signed-in guests
    - the full status for the owner after the reveal
  - `anon`/`authenticated` get **no direct SELECT** on the claims table. `anon` gets no table grants at all. This closes the enumeration leak.
  - The organizer's own views read their events and items through RLS-scoped table access (`owner_id = auth.uid()`), or a sibling RPC.
- **Q9 — Organizer edits are always allowed, and `updated_at` is recorded.**
  - Blocking edits to claimed items would leak their status.
  - Store `items.updated_at` (maintained by a trigger), so a later slice can compare it with `claims.created_at` to show the claimer "edited after you claimed". There is no extra UI in F-02.
- **Q10 — The preview-URL guard is skipped for now.** The user will configure additional environments (for example staging) in a later 10xDevs lesson. The hard trigger at `deployment-plan.md:201` stays open and tracked. Note in the F-02 plan that previews still hit the production database.
- **Q11 — Tests run locally only for now.** F-02 adds `pnpm test` (Vitest) and `supabase test db` (pgTAP) as local commands, with no GitHub Actions or Workers Builds gate. CI is deferred to a later change.
- **Q12 — Doc updates ride along in F-02 (all four):**
  1. **PRD:** the Q1 gate (auto at event_date + 2, manual after the date, event timezone), Q2 (signed-out visitors see no status, which changes US-01 AC1), Q4 (claims close at the reveal), Q5 (a single "given" mark)
  2. **`infrastructure.md:80,106`:** remove the stale service-role instructions
  3. **`CLAUDE.md`:** drop "Supabase … (not yet wired)" and "No test runner is configured yet". **`package.json`:** rename `bootstrap-scaffold` to `gin`
  4. **`bootstrap-verification/verification.md:23-24`:** mark as superseded
- **Q13 — Skip the hosted check and rely on the migration's revoke.** The first F-02 migration begins with the `alter default privileges … revoke` statements (changelog 45329), which makes the hosted default irrelevant.
- **Q14 — Key hygiene is a separate small change.** Making the key server-only and migrating to `sb_publishable_…` go in their own change (for example `supabase-key-hygiene`), before the legacy keys are removed at the end of 2026. F-02 does not touch env var names or `client.ts`.
- **Q15 — Skip all abuse hardening until after v1.** Email confirmation, Turnstile CAPTCHA and claim rate limits are deferred. The user will add them later via `/10x-lesson`.
