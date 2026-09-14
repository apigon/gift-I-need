<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Surprise-Rule Data Contract (F-02)

- **Plan**: `context/changes/surprise-rule-data-contract/plan.md`
- **Scope**: Phases 1–4 (complete, committed) + Phase 5 docs (uncommitted working tree)
- **Date**: 2026-09-12
- **Verdict**: REJECTED at review; all 10 findings triaged and FIXED (re-verified — see each Decision)
- **Findings**: 1 critical (fixed), 6 warnings, 3 observations

> Phase 5 manual items 5.4–5.8 are **intentionally skipped** by user direction — the migrations were already pushed to the hosted project. They are not counted as gaps. Note this means F1 is live in production.

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | PASS |
| Safety & Quality | FAIL |
| Architecture | WARNING |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

All automated criteria re-run and pass: `pnpm test` (53), `pnpm test:db` (99 pgTAP, 4 files), `pnpm test:integration` (×3), `pnpm typecheck`, `pnpm lint`, `pnpm build`, `pnpm db:types` (no diff), stale-statement grep (empty). No scope creep: every non-`context/`, non-lockfile path in the diff maps to a plan item.

## Findings

### F1 — Organizer reads pre-reveal claim status, filter and count via the `xmax` system column

- **Severity**: ❌ CRITICAL
- **Impact**: 🔬 HIGH — architectural stakes; think carefully before deciding
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260911211956_surprise_rule_schema.sql:239`
- **Detail**: `grant select on public.items to authenticated` gives the organizer direct base-table access. `claims.item_id` is a FK to `items`, so every `insert into claims` takes a `SELECT ... FOR KEY SHARE` on the parent `items` row, writing the locking xid into that tuple's `xmax` header. `xmax` is a system column readable by anyone holding table SELECT, and PostgREST passes unknown column names straight through. Unclaimed item ⇒ `xmax = 0`; claimed ⇒ non-zero.

  **Reproduced live over the real Data API** with a genuine organizer JWT, event dated 2026-12-01 (reveal firmly closed, `private.reveal_open` = `f`):

  ```
  POST /rest/v1/rpc/get_shared_items   (intended path — correctly blind)
  [{"title":"ITEM_A","status":null},{"title":"ITEM_B","status":null}]

  GET /rest/v1/items?select=id,title,xmax&event_id=eq.<ev>&order=title
  [{"title":"ITEM_A","xmax":"2070"},   <-- claimed
   {"title":"ITEM_B","xmax":"0"}]      <-- not claimed

  GET /rest/v1/items?select=title&xmax=neq.0&event_id=eq.<ev>
  [{"title":"ITEM_A"}]                 <-- filters to claimed items

  GET /rest/v1/items?select=id&xmax=neq.0&…   Prefer: count=exact
  Content-Range: 0-0/1                 <-- exact pre-reveal claim COUNT
  ```

  This violates all three clauses of the hard rule in CLAUDE.md (claim status, and claim counts, before the reveal). `get_shared_items` itself is airtight — the leak is the *parallel* direct-table read path the RPC design was meant to eliminate, and it contradicts the migration's own header claim that claims are reachable only through the RPCs. No pgTAP test covers it: `04_shared_list.test.sql:139` asserts only that a **stranger** cannot select `items`; the **owner's** direct read is never exercised. Because migrations are already pushed, this is live in production (no UI consumes it yet, so no organizer can currently reach it through the product).
- **Fix A ⭐ Recommended**: Revoke the owner's direct `SELECT` on `public.items` and route owner reads through a `security_invoker` view that projects only the business columns.
  ```sql
  revoke select on public.items from authenticated;
  create view public.owner_items with (security_invoker = true) as
    select id, event_id, title, notes, link, price_range, created_at, updated_at
    from public.items;
  grant select on public.owner_items to authenticated;
  ```
  - Strength: Verified to close it — `select xmax from public.owner_items` errors with `column "xmax" does not exist`, because a view has no system columns. INSERT/UPDATE column grants on the base table are unaffected, and RLS still applies through `security_invoker`.
  - Tradeoff: Adds a third read surface; S-01/S-04 must target the view. Needs a new migration and a prod push.
  - Confidence: HIGH — fix tested against the running stack; no UI consumes `items` yet, so blast radius is near zero today.
  - Blind spot: Have not audited whether `events` leaks anything comparable (no child table writes on it pre-reveal, so likely not), nor checked `ctid`/`cmin`/`cmax` as secondary channels.
- **Fix B**: Drop the direct grant entirely and add a `get_owner_items(p_event_id)` RPC, matching the `returns table` shape already used for the shared list.
  - Strength: Restores the plan's stated architecture exactly — one read path, no direct table access, no system columns anywhere.
  - Tradeoff: More surface to write and test now, for slices not yet built; duplicates a projection a view gives for free.
  - Confidence: MEDIUM — clearly correct, but specifies more of S-01/S-04's read contract than this change intended to own.
  - Blind spot: Item *writes* still need base-table grants, so the base table stays reachable for INSERT/UPDATE regardless.
- **Also required either way**: a pgTAP regression asserting the owner gets identical results for a claimed and an unclaimed item across **every** path they hold a grant on — not just `get_shared_items`. Worth a `lessons.md` entry: any table that gains a child row on a state the organizer must not see leaks that state through `xmax`.
- **Decision**: FIXED via Fix A, **adapted** — see below.

  **Deviation from the literal Fix A, and why.** Fix A as written (`revoke select ... ` + a `security_invoker` view) is defective: revoking SELECT outright breaks the organizer's own item editing, because `update ... where` requires SELECT on the predicate columns (the plan's own Key Discovery says so). A view does not help there either — the UPDATE still runs against the base table, so base-table column grants are needed regardless, at which point the view adds a read surface without adding protection.

  What was applied instead achieves Fix A's *intent* (remove the system-column channel) with a strictly smaller change: **replace the table-level SELECT with a COLUMN-scoped SELECT** over exactly the business columns. System columns require the table-level privilege, so `xmax` becomes `permission denied` while ordinary reads and `update ... where` are untouched. No view, no new RPC, no application change, and nothing for S-01/S-04 to re-target.

  **A second leaking table was found while fixing this.** `private.claim_item` takes `... for share` on the `public.events` row, which stamps `events.xmax` too — giving the organizer an "at least one claim exists on this event" signal pre-reveal. Verified, and fixed by the same column-scoping.

  **Landed:**
  - `supabase/migrations/20260911231857_column_scoped_select.sql` — column-scoped SELECT on `public.events` and `public.items`.
  - `supabase/tests/05_owner_direct_reads.test.sql` (new, 9 assertions) — owner cannot read `items.xmax`, `events.xmax` or `items.ctid`, cannot count via an `xmax` predicate, still reads their own titles, can still run `update ... where`, still sees `null` status for claimed and unclaimed alike, and still cannot touch `claims`.
  - `supabase/tests/01_privileges.test.sql` — `table_privs_are` for `events`/`items` now asserts `array[]::name[]`, plus two `has_table_privilege` invariants pinning the absence of table-level SELECT. `plan(37)` → `plan(39)`.

  **Verified:** `supabase db reset` applies all three migrations from scratch; `pnpm test:db` 110/110 pass; the original exploit re-run over the Data API now returns `42501` on all three paths (read, filter, count) while `get_shared_items` still returns `status: null`; organizer create/list/`select *`/update over REST all still work; `pnpm test` (53), `pnpm test:integration`, `typecheck`, `lint`, `build` and `db:types` (no diff) all pass.

  **Still outstanding — this fix is not yet in production.** The hosted project has only the first two migrations, so the leak is live there until someone runs `supabase db push`. That is the human step in Phase 5.

### F2 — Deny-by-default does not hold for functions, in `public` or `private`

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `supabase/migrations/20260911211956_surprise_rule_schema.sql:14-19, 26-31`
- **Detail**: The lockdown covers tables and sequences but cannot revoke the `PUBLIC` pseudo-role's built-in EXECUTE on functions (the file's own comment at :11-13 says so), and `alter default privileges` was never issued for schema `private` at all. Verified in a rolled-back transaction — a function added by a *future* migration is immediately callable by `anon` in both schemas:
  ```
  public.future_fn_probe     anon=t  authenticated=t
  private.future_priv_probe  anon=t  authenticated=t
  ```
  Combined with `grant usage on schema private to anon` (:31), any future `private` function is reachable too. All 13 current functions revoke correctly — the risk is entirely forward-looking. `01_privileges.test.sql:37` will not catch it: it is an allowlist of named functions, not an invariant, and it omits all four `get_shared_*` functions from migration 2 entirely, so their grants are untested.
- **Fix**: Add `alter default privileges for role postgres in schema private revoke all on functions from public, anon, authenticated;` and replace the enumeration with an invariant that fails on any PUBLIC-executable function:
  ```sql
  select * from is_empty($$
    select n.nspname || '.' || p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public','private')
      and (p.proacl is null or array_to_string(p.proacl, ',') ~ '(^|,)=X/')
  $$, 'no function in public/private grants EXECUTE to PUBLIC');
  ```
  - Strength: Turns a per-function discipline into a structural guarantee; also closes the `get_shared_*` test gap.
  - Tradeoff: `plan(n)` in `01_privileges.test.sql` must be updated.
  - Confidence: HIGH — `proacl is null` means the default ACL, under which PUBLIC holds EXECUTE.
  - Blind spot: Not verified against Supabase-managed schemas that may legitimately expect PUBLIC EXECUTE — the invariant is scoped to `public`/`private` only, so it should be safe.
- **Decision**: FIXED, with one correction to the proposed fix.

  **The per-schema form does not work.** The originally proposed `alter default privileges ... in schema private revoke all on functions from public` is a no-op — verified: after running it, a new `private` function is still `has_function_privilege('anon', ..., 'execute') = true`. A per-schema default cannot revoke a global one, exactly as the 20260911211956 comment warned. The **global** form (no `IN SCHEMA`) does work and covers `public` and `private` together.

  **Landed:**
  - `supabase/migrations/20260911232448_function_default_privileges.sql` — `alter default privileges for role postgres revoke execute on functions from public;`, scoped to migration-created objects so Supabase's own roles are untouched.
  - `supabase/tests/01_privileges.test.sql` — added the eight missing `get_shared_*` rows (both wrappers and both private bodies, anon + authenticated) to the EXECUTE allowlist, and added the PUBLIC-EXECUTE invariant as a new assertion. `plan(39)` → `plan(40)`.

  **Verified, both directions:** a function created by a future migration is now `anon execute = false` in `public` *and* `private` (it was `true` before); and the invariant is non-vacuous — an explicit `grant execute ... to public` is caught by it. Full suite green: 111 pgTAP, 53 unit, integration, typecheck, lint, build, db:types no diff.

### F3 — `getSharedList` collapses an RPC failure into "list not found"

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Safety & Quality
- **Location**: `src/lib/lists/shared-list.ts:32-38`
- **Detail**: Both `data` and `error` are destructured (the `lessons.md` rule is honoured), but three distinct outcomes — malformed token, no such list, and **Supabase unreachable / RPC failed** — all return the same `null`, and the errors are discarded without even a `console.error`. This is the only read path for the product's main page, so a DB outage renders "list not found" to every visitor, silently and unlogged. A second latent case: if the guard were ever loosened, a non-null `itemsError` with a null `eventError` would render an *empty* list, which reads to a guest as "everything is available".
- **Fix**: Widen the return into a discriminated result and log the failure — `{kind:"ok",…} | {kind:"not_found"} | {kind:"error"}`; return `"error"` when `eventError || itemsError`, `"not_found"` only when both calls succeeded and `eventRows` is empty.
  - Strength: Makes an outage distinguishable from a deleted list at the one place the distinction matters, before any UI depends on the current shape.
  - Tradeoff: Changes the DAL signature that S-02/S-03/S-05 will consume — cheapest to do now, while there are no callers.
  - Confidence: HIGH — no production callers exist yet (grep: nothing in `src/` imports `@/lib/lists`).
  - Blind spot: The right UX for `"error"` is S-02's call, not this change's.
- **Decision**: FIXED.

  **Landed:**
  - `src/lib/lists/types.ts` — new `SharedListResult = {kind:"ok",event,items} | {kind:"not_found"} | {kind:"error",code}`. `not_found` is now reserved for the case where both RPCs *succeeded* and returned no event.
  - `src/lib/lists/shared-list.ts` — `getSharedList` returns `SharedListResult`; an RPC error is logged via `console.error` and returned as `{kind:"error", code: mapRpcError(...)}` before the event-row check, so a failure can no longer masquerade as an absent list.
  - `src/lib/lists/shared-list.test.ts` (new, 5 tests) — malformed token short-circuits without touching the DB; both-succeed-no-event → `not_found`; event RPC fails → `error`; **items RPC fails while the event resolves → `error`** (the subtle case, which must never render an empty list); success maps both shapes.

  **Verified non-vacuous:** restoring the old collapsing branch makes exactly the two error tests fail; reverting makes them pass again. Full suite green: 58 unit, 111 pgTAP, integration, typecheck, lint, build.

  **Contract note:** this changes `getSharedList`'s signature from the Phase 4 plan text (`… | null`). There are no callers yet — nothing in `src/` imports `@/lib/lists` — so the change is free now and would not have been later. S-02 still owns what the `"error"` state renders.

### F4 — `redirect.test.ts` contains a raw NUL byte, making a security test unreviewable

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/auth/redirect.test.ts:12`
- **Detail**: The C0-control test case is written as a literal `0x00` byte (offset `0x10C`) rather than an escape. Verified consequences: `git diff main...HEAD` reports `Bin 0 -> 735 bytes` — **this file received no line-level diff review in the PR**; `grep -rn "safeReturnTo"` on it returns nothing (exit 1) despite the text being present; `file` reports `data`. Many editors silently strip or mangle the byte on save, which would turn the assertion into `"/evil"` — a value `safeReturnTo` *accepts* — inverting the test's meaning without changing its name. It also contradicts the SUT's own comment at `src/lib/auth/redirect.ts:44-45`: *"no literal control byte ends up in source"*.
- **Fix**: Write it as `"\u0000/evil"` (identical runtime value, plain-text file), with a comment naming the NUL-truncation vector. Consider adding `\r` and `\n` cases, which the SUT comment calls out as the header-smuggling risk and which are currently untested.
- **Decision**: FIXED (escape + CR/LF cases).

  Raw `0x00` replaced with the `\u0000` escape, and four previously untested vectors added: CRLF header smuggling (`/evil\r\nX-Injected: 1`), bare CR, bare LF, and DEL (`\u007f`) — the exact cases `redirect.ts:42-45` names as the reason the guard exists. A comment records why the escape form is load-bearing.

  **Verified:** `file` now reports ASCII text (was `data`); `grep` matches again (11 hits, previously 0 with exit 1); `git diff --no-index` renders it as 40 text lines. 62 unit tests pass. Note `git diff HEAD` still prints `Bin 735 -> 1197` purely because the *committed* blob is binary — once this lands, future diffs are text.

### F5 — The `ItemStatus`/`BadgeStatus` type assertion is inert

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `src/lib/lists/types.ts:11-15`
- **Detail**: The plan calls for a type-level assertion that `ItemStatus` stays assignable to `BadgeStatus`. `type AssertItemStatusIsBadgeStatus = ItemStatus extends BadgeStatus ? true : never;` is not one — if the relation breaks, the conditional evaluates to `never` and the alias is simply assigned `never`, which is legal TypeScript. Verified independently: compiling the identical construct with a deliberately broken `ItemStatus` (extra `"oops"` member) under `tsc --noEmit --strict` exits **0**. The union is correct today, so there is no live bug — but the regression guard the plan asked for does not exist.
- **Fix**: Use a form that fails compilation, e.g. `const _check: BadgeStatus = null as unknown as ItemStatus;` or the standard `type Assert<T extends true> = T` helper applied to the conditional.
- **Decision**: FIXED. Replaced with `const _assertItemStatusIsBadgeStatus: BadgeStatus = null as unknown as ItemStatus;` plus a comment recording why the conditional-type form was inert. **Verified it now fires:** adding a bogus `"oops"` member produces `error TS2322: Type 'ItemStatus' is not assignable to type 'BadgeStatus'` naming the divergent member — where the old form exited 0.

### F6 — Sole XSS-link guard test pins no SQLSTATE

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/tests/02_events_items.test.sql:100-102`
- **Detail**: Single-argument `throws_ok` asserts only that *something* was raised. This is the only test of the `items_link_format` check constraint — the guard against stored `javascript:` URLs — so it would pass just as happily on a typo in the `format()` string, a privilege error, or a bad UUID cast. It can therefore stay green while the constraint itself is gone. Every other `throws_ok` in the suite pins a code; this one is the exception.
- **Fix**: Pin the code — `throws_ok(format(…), '23514', 'new row for relation "items" violates check constraint "items_link_format"')`, or at minimum `'23514'`.
- **Decision**: FIXED. Now pins SQLSTATE `23514`, the exact constraint-violation message, and a description, with a comment explaining why a bare `throws_ok` was insufficient. 111 pgTAP still pass.

### F7 — Race test reads only `error` from `signUp`, against the repo's own lesson

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Pattern Consistency
- **Location**: `src/lib/lists/claim-race.integration.test.ts:45-52`
- **Detail**: `const { error } = await client.auth.signUp(...)` — `lessons.md:40-45` ("signUp has three outcomes, not two") says this exact pattern hides the sessionless-success case. If `enable_confirmations` is ever turned on locally, all six clients come back sessionless with no error, all five `claim_item` calls return 42501, and the test fails with `expected [] to have length 1` — three layers removed from the cause. It fails loudly rather than silently, which is why this is a warning and not a critical.
- **Fix**: Destructure `data` too and assert the session exists: `if (!data.session) throw new Error("signUp returned no session — is enable_confirmations on?")`.
- **Decision**: FIXED. Now destructures `data`, and throws a message naming the email and `enable_confirmations` in `supabase/config.toml` as the likely cause, with a comment citing the lesson. Integration test still passes.

### F8 — `items_select_owner` calls a SECURITY DEFINER function per row

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality
- **Location**: `supabase/migrations/20260911211956_surprise_rule_schema.sql:243-246`
- **Detail**: Because the argument varies per row, `private.is_event_owner(event_id)` cannot be hoisted into an InitPlan the way the `(select auth.uid())` form is in the `events_*` policies (:226, :231, :236 — those are correctly written). Each candidate `items` row triggers a separate `exists` scan of `events`. Harmless at v1 volumes and invisible to the tests, but it is the standard Supabase RLS performance trap. Note this policy may be replaced entirely by F1's fix.
- **Fix**: `using (event_id in (select id from public.events where owner_id = (select auth.uid())))`, which the planner collapses into one hashed subplan. Write policies can keep the function form — they are single-row.
- **Decision**: FIXED in `supabase/migrations/20260911233636_single_reveal_gate_and_policy_subplan.sql`. `items_select_owner` dropped and recreated with the `in (select ...)` form. Write policies deliberately keep `private.is_event_owner(...)` — single-row, and it reads better beside the `not private.reveal_open(...)` clause. Organizer reads/updates re-verified over REST after the change.

### F9 — The reveal predicate is written out three times

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Architecture
- **Location**: `20260911211956_surprise_rule_schema.sql:204`; `20260911221653_shared_list_rpcs.sql:31`, `:89`
- **Detail**: `private.reveal_open`, `get_shared_event` and `get_shared_items` each independently spell `now() >= e.auto_reveal_at or e.revealed_at is not null`. The one at `:89` *is* the organizer-blindness gate. The plan's stated approach was "**one** gate definition"; there are three. A future change to reveal semantics that updates two of the three sites opens the leak, and no test compares them.
- **Fix**: Have both `get_shared_*` bodies call `private.reveal_open(e.id)`. Both are SECURITY DEFINER already, so the grant asymmetry (`reveal_open` is not granted to `anon`) does not matter inside them.
  - Strength: Restores the plan's single-definition principle; makes the gate impossible to desynchronise.
  - Tradeoff: One function call per row in `get_shared_items` — interacts with F8's concern.
  - Confidence: MEDIUM — correctness is clear; the per-row cost needs a glance at the query plan.
  - Blind spot: Not benchmarked.
- **Decision**: FIXED in the same migration (`20260911233636`). Both `private.get_shared_event` and `private.get_shared_items` now call `private.reveal_open(e.id)` instead of restating the predicate, leaving exactly one definition. Both bodies are SECURITY DEFINER, so they reach `reveal_open` despite it being granted only to `authenticated` — the anon assertions in `04_shared_list.test.sql` pass unchanged, which is the proof.

  Added three assertions to `05_owner_direct_reads.test.sql` (`plan(9)` → `plan(12)`) pinning that `get_shared_event.reveal_open` agrees with `private.reveal_open` both before and after the reveal, plus a non-vacuity check that the gate actually flips. 114 pgTAP pass.

### F10 — `infrastructure.md` still names a service-role key it says does not exist

- **Severity**: 🔵 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: `context/foundation/infrastructure.md:82`
- **Detail**: Phase 5 rewrote :80 to "there is no service-role key to rotate", but the Approval bullet two lines below still lists "**Human-only**: rotating the Supabase service-role key" as a standing procedure. Uncommitted working-tree edit; a cold reader gets contradictory statements in adjacent bullets. (Phase 5's other doc edits — PRD FR-003/004/008/010/011, roadmap S-02/S-03/S-05, CLAUDE.md, deployment-plan trigger note, verification.md supersede note — all match the plan's contract.)
- **Fix**: Drop the service-role clause from the :82 Human-only list, leaving "dropping/altering production Postgres, deleting the Worker or KV/R2 namespaces, and changing the billing tier".
- **Decision**: FIXED. The Human-only list now reads "dropping/altering production Postgres, deleting the Worker or KV/R2 namespaces, and changing the billing tier".

## Verified correct (checked, not re-litigated)

- **Single-claim rests on a real constraint**: `claims.item_id uuid not null unique` (:87); `claim_item` inserts blind and lets `23505` arbitrate (:308-310). No TOCTOU. The integration test fires 5 RPCs from pre-built clients in one `Promise.all` and asserts **exactly** one winner, not "at least one".
- **`for share` ↔ `unlock_event` serialisation works**, with no deadlock cycle: `unlock_event` touches only `events`; concurrent claims hold mutually-compatible `FOR SHARE` then contend only on the `claims` unique index.
- **Error keys are not an enumeration oracle**: `unlock_event` raises one `event_not_found` for both missing and not-owned; `claim_item` checks `owner_cannot_claim` before the reveal gate and the insert; `mark_given` checks `not_revealed` before `not_claimed`. `03_claims.test.sql:49-50, 64-65` assert exactly these orderings.
- **`get_shared_items` itself leaks nothing**: owner branch precedes every claim branch; `left join` on a unique `claims.item_id` cannot multiply rows; `order by i.created_at, i.id` is claim-independent. Neither RPC projects `claimer_id`, `given_by`, claim timestamps or any aggregate.
- **Every function has `set search_path = ''`** with schema-qualified identifiers; no SECURITY DEFINER function in `public`; no dynamic SQL anywhere (zero injection surface).
- **`claims` is sealed**: RLS on, no grants, no policies; `03:59-61` proves 42501 on direct insert/select/update.
- **No DELETE anywhere**, deliberately and tested (`01:103-105`). `share_token` and `owner_id` are unsettable by clients.
- **`plan(n)` matches reality in all four files** (37/16/26/20 = 99, confirmed by the run).
- **Reveal arithmetic**: 2026-12-24 / Europe/Warsaw → `unlockable_at` 2026-12-24 23:00Z, `auto_reveal_at` 2026-12-25 23:00Z.
- **eslint guards were NOT weakened**: both override blocks re-declare the restrictions they don't lift; `next/link` stays banned outside `src/components/link/**`.
- **Edge purity holds**: nothing in `src/` imports `@/lib/lists`; `shared-list.ts:1` is `import "server-only"`.

## Deferred / not counted

- **Sock-puppet bypass** — an organizer with a second account sees real statuses pre-reveal. Inherent; Postgres cannot know two accounts are one person. Worth a PRD acknowledgement.
- **No CI** — `.github/workflows/` does not exist, so the pgTAP suite enforcing the product's one non-negotiable rule runs only when someone remembers. Pre-existing, and Q11 explicitly scoped CI out of this change.
- **Integration test leaves 6 `auth.users` rows per run** with no cleanup. Fine locally; worth an `afterAll` if it ever runs somewhere shared.

## Review environment note

Verification of F1 created and then deleted probe rows in the **local** dev database. The cleanup also removed 56 accumulated `@example.com` users left behind by earlier integration-test runs (see the last deferred item). All suites were re-run afterwards and pass: 53 unit, 99 pgTAP, integration ×1. Nothing in the repository was modified by this review.
