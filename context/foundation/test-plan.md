# Test Plan

> Phased test rollout for this project. Strategy is frozen at the top
> (§1–§5); cookbook patterns at the bottom (§6) fill in as phases ship.
> Read before writing any new test.
>
> Refresh: re-run `/10x-test-plan --refresh` when stale (see §8).
>
> Last updated: 2026-09-13

## 1. Strategy

Tests follow three non-negotiable principles for this project:

1. **Cost × signal.** The cheapest test that gives a real signal for the
   risk wins. Do not promote to e2e because e2e "feels safer." Do not put a
   vision model on top of a deterministic visual diff that already catches
   the regression.
2. **User concerns are first-class evidence.** Risks anchored in "the team
   is worried about X, and the failure would surface somewhere in area Y"
   carry the same weight as PRD lines or hot-spot data.
3. **Risks are scenarios, not code locations.** This plan documents *what
   could fail* and *why we believe it's likely* — drawn from documents,
   interview, and codebase *signal* (churn, structure, test base). It does
   NOT claim to know which line owns the failure. That knowledge is
   produced by `/10x-research` during each rollout phase. If the plan and
   research disagree about where the failure lives, research is the
   ground truth.

Hot-spot scope used for likelihood weighting: `src/`, `supabase/` (excluding
`node_modules`, `.next`, build output, generated types).

## 2. Risk Map

The top failure scenarios this project must protect against, ordered by
risk = impact × likelihood. Risks are failure scenarios in user / business
terms, not test names. The Source column cites the *evidence that surfaced
this risk* — never a specific file as "where the failure lives" (that is
research's job, see §1 principle #3).

| # | Risk (failure scenario) | Impact | Likelihood | Source (evidence — not anchor) |
|---|---|---|---|---|
| 1 | Organizer's own page composition (merging two reads, caching, or a direct URL hit) leaks claim status/claimer identity/counts before the reveal, even though the underlying RPC correctly nulls it | High | High | PRD NFR (holds under concurrent updates/refresh/direct URL access); CLAUDE.md hard rule; interview Q1; hot-spot dir `src/app/events/` (13 commits/30d), `src/lib/lists/` (16 commits/30d) |
| 2 | A guest's claim request resolves in a way the client reads as "success" without a durable, matching DB row — or the reverse (persisted but never reflected to the guest) | High | Medium | PRD Guardrail (duplicate-prevention must be reliable) + NFR (claim confirms within 1s, no ambiguous pending state); interview Q1 |
| 3 | A shared-token RPC call (`claim_item`/`mark_given`/`unlock_event`) made directly, bypassing the UI, against an event/item the caller doesn't own or wasn't shared with, isn't rejected the same way the UI path rejects it | High | Medium | PRD Access Control + CLAUDE.md ("claims reachable only through the RPCs — never a direct table read/write"); abuse/security lens (auth + share-token access surface) |
| 4 | The computed reveal instant (`event_date + 1` / `+2` in the event's IANA timezone) lands on the wrong wall-clock day for a DST-transition date or a non-UTC/half-hour-offset zone | High | Medium | PRD FR-003/FR-011 (timezone-keyed reveal); interview Q4 (explicitly flagged, "no test there") |
| 5 | A migration that touches an *existing* RLS policy or grant (not a new table) silently weakens the organizer-blindness or single-claim guarantee, with nothing in CI catching it | High | Medium | interview Q4 ("migration ordering/rollbacks — definitely big one"); interview Q3 (DL/DB = least-confident area); CLAUDE.md's grants+RLS+pgTAP rule (governs new tables, not edits to existing ones) |
| 6 | A regression in page-level rendering (badge visibility, gating banners, button conditions) ships undetected because there is no automated coverage above the data/action layer — only manual checklists followed once at ship time | Medium | High | interview Q4 (FE components under-tested) + Q5 (wants e2e instead of component tests); archived-slice pattern (no `*.test.tsx` anywhere); Next.js's own testing guidance (Vitest does not support rendering async Server Components — recommends e2e) |

**Impact × Likelihood rubric** (High/Medium/Low, coarse by design — see
`references/test-plan-schema.md` §2 for the full table).

**Abuse / security lens.** GIN has authentication, a share-token access
surface, and accepts user input — Risk #3 is the abuse-lens row; it did not
surface from the Phase 2 interview (expected — happy-path interviews rarely
produce attacker-shaped scenarios).

### Risk Response Guidance

| Risk | What would prove protection | Must challenge | Context `/10x-research` must ground | Likely cheapest layer | Anti-pattern to avoid |
|------|-----------------------------|----------------|--------------------------------------|-----------------------|-----------------------|
| #1 | A request to the organizer's own event data — normal load, right after a guest claims, on refresh, or via direct URL — never returns/renders claim status, identity, or counts pre-reveal | That the RPC nulling status is sufficient — the leak risk is in the application-layer composition of two reads, not the RPC alone | How/when the status-overlay fetch is triggered relative to `revealOpen`; whether the merge step can ever pass a non-null status through pre-reveal | Integration test against the actual composed data-loading function (Vitest can't render async Server Components); e2e only if "direct URL access" needs the real routed response | Asserting only that the RPC nulls status (already covered) instead of the full object the page actually receives |
| #2 | After a claim resolves (success or error), the guest's next read always matches what was actually persisted — no phantom "claimed" state, no permanently stuck pending UI | That a non-error Server Action response guarantees persistence — check what happens if the RPC succeeds but a downstream step (refresh/mapping) throws | The Server Action's error-handling and refresh-call sequencing; whether every code path triggers a re-fetch | Unit test on the action's response mapping + refresh guarantee | Re-testing the DB unique-constraint race itself (already proven) instead of the action-layer handling around it |
| #3 | Calling the RPCs directly with a valid session, for an event/item the caller doesn't own or wasn't shared with, is rejected the same way the UI path is | That "the UI never renders the button" is a security control — a direct RPC/PostgREST call skips the UI entirely | Whether existing coverage exercises cross-event/cross-owner calls, or only same-event unauthorized cases | pgTAP — extend the existing owner-exclusion/RLS-denial pattern to a second, unrelated event | Treating "the button doesn't render" as equivalent to "the request is rejected" |
| #4 | For a representative set of IANA timezones incl. DST-transition dates, the computed unlock/reveal instants land on the correct day in that timezone | That testing UTC (or the dev's local zone) is sufficient — DST and half-hour-offset zones are exactly where naive date arithmetic breaks | Where the instant is actually computed (SQL vs. app code) and what arithmetic/library it uses | Unit or pgTAP tests against fixed non-UTC/DST fixtures | Testing only UTC, which would pass even with a real DST bug |
| #5 | Every RLS policy/grant that enforces organizer-blindness and single-claim has an explicit pgTAP assertion — weakening any one fails the suite | That the "new table ships with pgTAP" rule is self-enforcing — it doesn't cover edits to existing policies | The current full policy/grant set vs. what existing pgTAP files actually assert | pgTAP — coverage-completeness audit before it's new-test-writing | A broad "RLS exists" smoke test instead of per-role, per-table allow/deny assertions |
| #6 | The guest claim flow and organizer reveal/mark-given flow work end-to-end in a real browser, including the pre-reveal direct-URL non-leak, without relying on a human re-running a checklist | That the manual checklists baked into past plans are an adequate substitute for automated coverage going forward | Which manual steps are safe to automate now vs. need a human (visual review) | e2e (Playwright or equivalent) — the only layer that can exercise async Server Component rendering at all | Reaching for component-render tests as a stopgap — async Server Components aren't renderable in Vitest per Next's own docs |

## 3. Phased Rollout

Each row is a discrete rollout phase that will open its own change folder
via `/10x-new`. Status moves left-to-right through the values below; the
orchestrator updates Status as artifacts appear on disk.

| # | Phase name | Goal (one line) | Risks covered | Test types | Status | Change folder |
|---|---|---|---|---|---|---|
| 1 | Organizer-blindness & claim-integrity guard | Lock the composition-layer leak and claim-write integrity guarantees; close the RPC-bypass abuse case alongside since it's cheap at the same layer | #1, #2, #3 | integration (Vitest), pgTAP | change opened | `context/changes/testing-organizer-blindness-claim-integrity/` |
| 2 | Migration/RLS regression net | Audit and close gaps in pgTAP coverage so a future edit to an existing policy fails CI | #5 | pgTAP | not started | — |
| 3 | Reveal-timing correctness | Close the DST/timezone gap in the reveal-instant computation | #4 | unit or pgTAP (whichever layer owns the computation) | not started | — |
| 4 | E2E on critical flows | Add e2e covering the guest claim flow (incl. race) and organizer reveal/mark-given flow, re-exercising Phase 1's leak check at the full-render level | #6 (+ #1) | e2e (new tooling) | not started | — |
| 5 | Quality-gates wiring | Wire lint/typecheck/unit/integration/pgTAP/e2e as required merge gates — none run in CI today (deploy is Cloudflare Git auto-deploy, no gate) | cross-cutting | gates | not started | — |

**Status vocabulary** (fixed — parser literals): `not started` →
`change opened` → `researched` → `planned` → `implementing` → `complete`.

## 4. Stack

The classic test base for this project. Recommendations below are grounded
in local manifests/configs plus the MCP/tools actually exposed in the
current session.

| Layer | Tool | Version | Notes |
|---|---|---|---|
| unit + integration | Vitest | ~4.1 | Two projects (`unit`, `integration`) via `vitest.config.mts`; `integration` needs `colima start` + `supabase start` (`pnpm test:integration`) |
| DB / RLS | pgTAP via `supabase test db` | — | 5 test files under `supabase/tests/`; needs local Supabase stack |
| API mocking | `vi.mock` on `@/utils/supabase/{client,server}` | — | Existing convention across `src/lib/lists/*.test.ts` — no MSW/network-level mocking needed since the boundary is the Supabase client, not raw HTTP |
| e2e | none yet — see §3 Phase 4 | — | No Playwright/Cypress config exists. Load-bearing gap: Next.js's own App Router testing guidance states Vitest does not support rendering async Server Components and recommends e2e for them — this codebase has zero `*.test.tsx` for exactly that reason |
| accessibility | none yet | — | Not scoped by any rollout phase below; revisit at `--refresh` if it becomes a stated concern |
| (optional) AI-native | none yet | n/a | No AI-native layer proposed in this rollout — the identified gaps (composition-layer leak, RLS coverage, DST math, e2e) are all deterministic and cheaper to catch classically |

**Stack grounding tools (current session):**
- Docs: Context7 available — not queried; the load-bearing Next.js 16 testing fact (Vitest can't render async Server Components) came from the local `node_modules/next/dist/docs/01-app/02-guides/testing/vitest.md`, which CLAUDE.md instructs to prefer for this exact reason (training data may not reflect Next.js 16's breaking changes); checked: 2026-09-13
- Search: Exa.ai available — not used, no external-currency question arose; checked: 2026-09-13
- Runtime/browser: none available in this session (no Playwright/browser MCP) — relevant since e2e (§3 Phase 4) is this project's one structural gap; the phase's `/10x-plan` will need to select and configure a runner without session MCP assistance; checked: 2026-09-13
- Provider/platform: none available as MCP; `gh`/`supabase` CLIs are usable via Bash but are not session tools; checked: 2026-09-13

## 5. Quality Gates

| Gate | Where | Required? | Catches |
|---|---|---|---|
| lint + typecheck | local (`pnpm lint`, `pnpm typecheck`) | required | syntactic / type drift |
| unit (`pnpm test`) | local | required | logic regressions in DAL/actions |
| integration (`pnpm test:integration`) | local, needs local stack | required after §3 Phase 1 | composition-layer leaks, claim-write integrity |
| pgTAP (`pnpm test:db`) | local, needs local stack | required after §3 Phase 2 | RLS/grant regressions |
| e2e on critical flows | required after §3 Phase 4 | required after §3 Phase 4 | broken guest-claim / organizer-reveal flows end to end |
| CI enforcement of the above | required after §3 Phase 5 | required after §3 Phase 5 | any of the above merging unreviewed — none of these gates currently block a merge; deploy is Cloudflare Git auto-deploy on push with no test step |
| post-edit hook | local (agent loop) | not proposed this rollout | — |
| multimodal visual review | CI on PR | not proposed this rollout | — |

## 6. Cookbook Patterns

How to add new tests in this project. Each sub-section fills in once the
relevant rollout phase ships; before that it reads "TBD — see §3 Phase N."

### 6.1 Adding a unit test

- **Location**: co-located with the unit under test (e.g. `src/lib/lists/shared-list.test.ts` next to `shared-list.ts`).
- **Naming**: `<module>.test.ts`.
- **Reference test**: `src/lib/lists/shared-list.test.ts`.
- **Run locally**: `pnpm test`.

### 6.2 Adding an integration test

- **Location**: co-located with the module under test (e.g. `src/lib/lists/organizer-view.integration.test.ts` next to `organizer-view.ts`).
- **Naming**: `<module>.integration.test.ts`.
- **Pattern**: a real `@supabase/supabase-js` client against the local stack, anon key only — no client mocking. Guard every test with `it.skipIf(!ENV_READY)` so the suite degrades to a visible skip (not a false pass) when the local stack isn't running. Use the shared `signedInClient`/`uniqueEmail` helpers to sign in as distinct real users rather than reusing one session.
- **Reference tests**: `src/lib/lists/claim-race.integration.test.ts` (original — real-DB claim race), `src/lib/lists/organizer-view.integration.test.ts` (pre-reveal composition proof against a real guest claim).
- **Run locally**: `pnpm test:integration` (needs `colima start` + `supabase start`).

### 6.3 Adding a pgTAP test

- **Location**: `supabase/tests/`, numbered prefix (`0N_<area>.test.sql`).
- **Reference test**: `supabase/tests/03_claims.test.sql`.
- **Run locally**: `pnpm test:db` (needs `colima start` + `supabase start`).

### 6.4 Adding an e2e test

- TBD — see §3 Phase 4 (no runner configured yet).

### 6.5 Adding a test for reveal-timing / date math

- TBD — see §3 Phase 3.

### 6.6 Per-rollout-phase notes

(Fills in after each phase lands — captures anything surprising the phase taught.)

**2026-09-14 — Rollout Phase 1 (`testing-organizer-blindness-claim-integrity`, Risks #1–#3):** Vitest cannot render this codebase's async Server Components at all, so `page.tsx`-shaped composition logic is untestable in place — the only way to get coverage on it is to extract the orchestration into a plain function first (`organizer-view.ts`), then test the extracted function directly. Once extracted, a two-layer split covers the invariant cheaply: unit tests (mocked `getOwnedEvent`/`getSharedList`) prove every branch, and exactly one integration test against the real local stack (real event, real guest claim, real RPC) proves the branch that matters for the security invariant — pre-reveal status stays `null` — holds against live data, not just a mock that could quietly drift from the real RPC's behavior. Separately: `refresh()` (Next.js 16) is synchronous, so guarding a post-commit call needs only a plain `try/catch`, no `await`. And the cross-owner pgTAP fixture (Phase 4) confirmed each write RPC's owner check is scoped to the *specific event*, not "is this caller an owner of anything" — `claim_item` treats a cross-owner caller exactly like any other guest (allowed), while `mark_given`/`unlock_event` reject one identically to a stranger.

## 7. What We Deliberately Don't Test

- **`/design-system` showcase page** — dev-only tool, not user-facing. (Source: Phase 2 interview Q5.)
- **`/api/health` route** — trivial, low blast radius. (Source: Phase 2 interview Q5.)
- **Snapshot/visual-diff tests** — break on incidental rendering differences and catch nothing real for this project. (Source: Phase 2 interview Q5.)
- **Component-level render tests as a general pattern** — deprioritized in favor of e2e for main flows (§3 Phase 4); also structurally limited since Vitest cannot render this codebase's async Server Components. (Source: Phase 2 interview Q5; Next.js testing docs.)
- **Rate-limit / resource-abuse testing on claim/mark-given/unlock** — considered under the abuse lens and dropped: all three RPCs are already atomic/idempotent at the DB layer and the product's target scale is low-QPS/medium-users, so this would be a Low×Low row padding the map rather than real signal. Re-evaluate if target scale changes. (Source: challenger pass, Phase 3 synthesis.)

## 8. Freshness Ledger

- Strategy (§1–§5) last reviewed: 2026-09-13
- Stack versions last verified: 2026-09-13
- AI-native tool references last verified: n/a — no AI-native layer in this rollout

Refresh (`/10x-test-plan --refresh`) when:

- a new top-3 risk surfaces from the roadmap or archive,
- a recommended tool's `checked:` date is older than three months,
- the project's tech stack changes (new framework, new test runner) — including if the Next.js→Vite consideration mentioned in interview Q2 becomes an active plan,
- §7 negative-space no longer matches what the team believes.
