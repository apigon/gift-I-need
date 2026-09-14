---
date: 2026-09-14T21:29:51+02:00
researcher: Claude (claude-sonnet-5)
git_commit: 876686c8c461232665c25b56004caa4891f0a0f4
branch: GIN-33-testing-organizer-blindness-claim-integrity
repository: apigon/gift-I-need
topic: "Rollout Phase 1 — Organizer-blindness & claim-integrity guard (Risks #1, #2, #3)"
tags: [research, codebase, organizer-blindness, claims, rls, pgtap, server-actions, nextjs-refresh, supabase-rpc, testing]
status: complete
last_updated: 2026-09-14
last_updated_by: Claude (claude-sonnet-5)
---

# Research: Organizer-blindness & claim-integrity guard

**Date**: 2026-09-14T21:29:51+02:00
**Researcher**: Claude (claude-sonnet-5)
**Git Commit**: 876686c8c461232665c25b56004caa4891f0a0f4
**Branch**: GIN-33-testing-organizer-blindness-claim-integrity
**Repository**: apigon/gift-I-need

## Research Question

For Rollout Phase 1 of `context/foundation/test-plan.md` (§3, row 1), ground the three risks named in `context/changes/testing-organizer-blindness-claim-integrity/change.md` in the live codebase — not the RPC layer alone, which is already covered — so `/10x-plan` can write test phases against real gaps instead of assumed ones:

1. Does the organizer page's own data composition (not the RPC) ever leak claim status/identity/counts pre-reveal, under normal load, post-claim, refresh, or direct URL access?
2. Does a guest's claim request ever resolve as "success" without a durable DB row, or the reverse (persisted but never reflected)?
3. Is a direct RPC call for `claim_item`/`mark_given`/`unlock_event` against an event/item the caller doesn't own or wasn't shared with rejected the same way the UI path rejects it?

## Summary

All three risks are real, but not in the shape the risk map's one-line description implies. Each investigation found a **more precise, cheaper-to-test gap** than "the obvious thing could be wrong":

1. **Risk #1 is not a leak risk — it's an unproven invariant.** The composition (`src/app/events/[id]/page.tsx`) cannot structurally leak claim status: `getOwnedEvent` never selects claim data at all, and `get_shared_items` re-derives `status: null` from the **live** DB `private.reveal_open` on every call regardless of what the app's own JS-computed `revealOpen` believes. The one place this could theoretically go wrong — the app's JS-side reveal clock diverging from the DB's — is documented only in a code comment (`owned-events.ts:152-159`) claiming the divergence is "cosmetic, never a leak." No test proves it. That's the actual, narrow thing to test: not "does status leak" (structurally it can't) but "does the page-level orchestration (skip-fetch-when-closed, merge-when-open, degrade-on-error) behave correctly across the full state matrix," which today only has its pure sub-piece (`mergeOwnedItemsWithStatus`) under test, not the orchestration in `page.tsx` itself.

2. **Risk #2 exists in the *opposite* direction from how the change.md framed it.** The framing asked to challenge "a non-error response guarantees persistence" — but the code shows the RPC is called and awaited *before* anything else happens, and its `{ok, error}` result is captured correctly. The actual unguarded step is **after** a successful, committed write: `refresh()` (Next.js 16's client-router refresh primitive) runs unguarded between the RPC call and the action's `return`, with no `try/catch` anywhere in the file and no `error.tsx`/`global-error.tsx` in the whole app. If `refresh()` throws, the DB write has already committed but the guest's promise rejects instead of resolving — the reverse of what the risk statement anticipated, and the higher-value case to test.

3. **Risk #3's real gap is a missing fixture shape, not a missing check.** All three write RPCs already do their own authorization (auth check → owner-exclusion → reveal-state check) independent of any share-token/ACL concept — there is no share/ACL table in the schema at all; `share_token` gates the two *read* RPCs only. Every existing pgTAP test's "unauthorized caller" is a guest who owns *no* event, tested against the *one* organizer's own event(s) in that file. No test exercises "organizer A, who owns event A, calls a write RPC against event B owned by organizer C" — the literal cross-owner case the risk names. Code inspection suggests this passes today (the ownership check is a flat `owner_id = auth.uid()` comparison with no special-casing), but that's an inference, not a proof.

## Detailed Findings

### Risk #1 — Organizer page composition

**Route and fetch/merge sequence** — `src/app/events/[id]/page.tsx`:
- `getOwnedEvent(id)` (`src/lib/lists/owned-events.ts:105-176`) is a direct RLS-scoped table read (not an RPC) of `events`/`items`. Its return type, `OwnedItem`, has **no `status` field at all** — it structurally cannot carry claim data.
- `page.tsx:47-49` (verified): `result.kind === "not_found"` → `notFound()`. RLS means a stranger's id and a nonexistent id both come back empty — direct URL access by a non-owner 404s before any claim-adjacent code runs.
- `page.tsx:71-82` (verified): `getSharedList(event.shareToken)` — the **same function the guest shared page uses** — is called **only if** `event.revealOpen` is true; the comment at line 65-67 states this is an optimization ("status would only ever come back null anyway"), not a security gate. On RPC error, `statusUnavailable = true` and the page degrades to titles-only rather than failing.
- `mergeOwnedItemsWithStatus(items, sharedItems)` (`src/lib/lists/reveal-status.ts:1-24`) is the actual composition point — a pure overlay-by-id function. When `sharedItems` is `null` (pre-reveal, fetch skipped), every item gets `status: null` unconditionally; there is no code path that can produce a non-null status in that branch.

**The `revealOpen` double-computation** — the one place this risk could theoretically bite:
- App-side: `owned-events.ts:160-162` independently recomputes reveal state in JS (`revealed_at !== null || Date.now() >= auto_reveal_at`) from already-fetched columns, purely to decide whether to bother calling `getSharedList` at all.
- DB-side: `private.reveal_open(event_id)`, called live inside `private.get_shared_items` (`supabase/migrations/20260911233636_single_reveal_gate_and_policy_subplan.sql:81`) on every invocation — this is the real, authoritative gate, re-evaluated per call, never cached or trusted from a prior read.
- Because the DB re-derives its own null/real-status decision independent of what the app believes, a stale/wrong app-side `revealOpen` cannot cause a leak in either direction (false-positive → RPC still nulls; false-negative → RPC never called, conservative). **This claim is asserted only in a code comment** (`owned-events.ts:152-159`), not by any test that drives a deliberately diverging apparent-vs-actual reveal clock.

**No caching found anywhere in this path** — no `unstable_cache`/`force-cache`/`revalidate`/React `cache()` under `src/app` or `src/lib`; root layout's `AuthStatus` forces full dynamic rendering on every route via `cookies()`, and both `owned-events.ts` and `shared-list.ts` call `connection()` before querying.

**What the RPCs actually return pre-reveal**: `private.get_shared_items` returns every item's non-status fields (title/notes/link/price_range) always — expected, since the organizer wrote them — but actively sets `status` to SQL `null` via a `case` expression when caller is owner and reveal isn't open (`20260911233636_single_reveal_gate_and_policy_subplan.sql:81`). Claimer identity/counts are never selected anywhere in this path — confirmed via grep, zero occurrences of `claimer_id`/`given_by`/any count concept in `src/app/events` or `src/lib/lists`.

**Existing coverage**:
- `reveal-status.test.ts` — unit-tests the pure merge function only.
- `owned-events.test.ts` — unit-tests `getOwnedEvent`'s reveal/unlockable boundary math via mocked client.
- No test file exists for `page.tsx` itself — the orchestration (skip-fetch-when-closed / merge-when-open / degrade-on-RPC-error) is untested end-to-end.
- pgTAP (`supabase/tests/04_shared_list.test.sql`, `05_owner_direct_reads.test.sql`) already proves RPC-level owner-blindness and the `xmax`/system-column side channel is closed — explicitly not this phase's job to re-prove.

### Risk #2 — Claim write integrity

**Full trace of `claimItemAction`** (`src/app/actions/lists.ts:36-57`, verified directly):
```
const result = await claimItem(itemId);   // RPC call, awaited, captured correctly
refresh();                                 // unconditional, no try/catch, runs before return
if (!result.ok) { return {status:"error", ...} }
return { status: "idle" };
```
`claimItem` (`src/lib/lists/shared-list.ts:69-79`) calls `supabase.rpc("claim_item", ...)` and correctly destructures `{ error }` (not a throw) — consistent with the existing team lesson that Supabase calls return errors rather than throwing. `mapRpcError` (`errors.ts:43-57`) maps `23505`→`already_taken`, `42501`→`not_authenticated`, `P0001`→raised message key.

**The actual gap**: `refresh()` — Next.js 16's "refresh the client router from a Server Action" primitive — sits **unguarded between a successful, already-committed RPC write and the function's `return`**. Its own docs (`node_modules/next/dist/docs/.../refresh.md`) only document it throwing when called *outside* a Server Action, not inside one — so this isn't a documented failure mode, but nothing in the codebase guards against it either: no `try/catch` in `lists.ts` or `shared-list.ts`, and **no `error.tsx`/`global-error.tsx` exists anywhere in `src/app`** (confirmed via `find`). If `refresh()` ever throws post-write, the guest's `useActionState`-awaited promise rejects, the DB row already exists, and the guest sees Next's default unstyled crash screen instead of any toast/confirmation — persisted but never reflected, the literal "reverse" case the risk names.

The `refresh()`-runs-on-every-outcome ordering is deliberate and commented (`lists.ts:43-45`) — it's there so a *failed* claim still shows real item status. That reasoning addresses the "false success" direction but not "refresh throws after a real success."

**Client-side handling** (`claim-modal.tsx:28-52`, `useActionState`): fires `notify.success("Claimed!")` and closes the modal purely on the action's returned `status === "idle"` — with no coupling to whether the `refresh()`-triggered re-render actually landed. Per the archived plan (`context/archive/2026-09-13-claim-gift-item/plan.md:37`), there is deliberately no optimistic UI — but the plan's own critical-details section (`plan.md:119`) assumes "`refresh()` inside the action has already brought the item's real status back" as a given, never flagged as a possible failure point.

**Existing coverage**:
- `claim-race.integration.test.ts` calls `guest.rpc("claim_item", ...)` **directly**, bypassing the Server Action, `claimItem()`, and `refresh()` entirely — proves the DB-level unique-constraint race only.
- `src/app/actions/lists.test.ts` mocks `refresh` from `next/cache` as a plain `vi.fn()` that never rejects — the exact hermetic-stub gap: `refresh` failing is trivial to simulate with a rejecting mock and currently isn't.
- No `*.test.tsx` exists for `ClaimModal`/`ClaimButton` — the client-side toast/close timing (point above) has zero coverage at any layer.

### Risk #3 — Direct RPC calls bypassing the UI

**Authorization model, per RPC** (`supabase/migrations/20260911211956_surprise_rule_schema.sql`, `private.*` SECURITY DEFINER bodies wrapped by `public.*` SECURITY INVOKER pass-throughs, both revoked from `public`/`anon` and granted only to `authenticated`):
- `claim_item`: not-authenticated → owner-exclusion (`private.is_event_owner`) → reveal-not-open → insert (unique-constraint race). **No share-token check.**
- `mark_given`: not-authenticated → reveal-must-be-open → claim-must-exist → caller-is-claimer-or-owner. **No share-token check.**
- `unlock_event`: ownership check (deliberately returns the *same* `event_not_found` for "doesn't exist" and "not yours," to prevent enumeration) → not-too-early → idempotent no-op if already revealed.

**No share/ACL table exists anywhere in the schema** (confirmed by reading every `create table` in the schema migration — only `events`, `items`, `claims`). `share_token` gates only the two *read* RPCs (`get_shared_event`/`get_shared_items`); the write RPCs take a bare UUID and rely solely on "authenticated + not-owner + reveal-state," with the security property resting on the 128-bit UUID being unguessable rather than on any per-user ACL. This makes the risk statement's phrase "wasn't shared with" a product-language concept with **no literal enforcement point** in the RPCs — worth stating as an oracle clarification rather than assuming an ACL check should exist.

**The coverage gap**: every pgTAP fixture across `01`–`05` uses **one** organizer plus stranger/guest fixtures who own **no event of their own** (`03_claims.test.sql:9-11`, `02_events_items.test.sql:10-11`, etc.). `unlock_event`'s existing "non-owner stranger" test (`03_claims.test.sql:127-128`) is a stranger-with-nothing calling on the one owner's event — same-event-wrong-role, not cross-owner. **No test in the entire suite has organizer A (who owns event A) call a write RPC against organizer C's unrelated event B.** Since `is_event_owner` is a flat `owner_id = auth.uid()` comparison with no special-casing for "another organizer" vs. "a guest with nothing," this is very likely to already pass — but that is an inference from reading the function body, not a proven fact, and it's exactly the gap `context/archive/2026-09-11-surprise-rule-data-contract/research.md:64` already flagged as a recommended (never-added) extension.

**Full pgTAP map** (for coverage-completeness context): `01_privileges.test.sql` (static grant/RLS contract, 40 assertions), `02_events_items.test.sql` (ownership CRUD + date/timezone validation, 20), `03_claims.test.sql` (the RPC cookbook file, 26), `04_shared_list.test.sql` (organizer-blindness via read RPCs across viewer types, 20), `05_owner_direct_reads.test.sql` (owner-privilege side channels, 12).

## Code References

- `src/app/events/[id]/page.tsx:42-84` — organizer page composition: fetch, conditional shared-status fetch, merge
- `src/lib/lists/owned-events.ts:105-176` — `getOwnedEvent`, no status field in return type
- `src/lib/lists/owned-events.ts:152-162` — app-side JS reveal-clock recompute, documented-but-unproven "cosmetic drift" claim
- `src/lib/lists/shared-list.ts:17-79` — `getSharedList` (reused by organizer + guest) and `claimItem`
- `src/lib/lists/reveal-status.ts:1-24` — `mergeOwnedItemsWithStatus`, the pure composition point
- `src/app/actions/lists.ts:36-57` — `claimItemAction`, the unguarded `refresh()` call
- `src/app/actions/lists.test.ts:9-15` — `refresh` mocked as a non-throwing `vi.fn()`
- `src/lib/lists/claim-race.integration.test.ts` — DB-level race only, bypasses the Server Action entirely
- `src/app/lists/[token]/components/claim-modal/claim-modal.tsx:28-52` — client success/close purely on action state
- `supabase/migrations/20260911211956_surprise_rule_schema.sql:277-435` — `claim_item`/`mark_given`/`unlock_event` bodies and wrappers
- `supabase/migrations/20260911233636_single_reveal_gate_and_policy_subplan.sql:59-92` — `private.get_shared_items`, live `reveal_open` re-derivation
- `supabase/tests/03_claims.test.sql:9-11,127-128` — single-owner fixture, same-event-only unauthorized cases

## Architecture Insights

- **Organizer and guest reads deliberately share one function** (`getSharedList`) rather than a parallel organizer-only status path — a conscious design choice (`context/archive/2026-09-13-post-event-reveal/plan.md:49`) that collapses Risk #1's surface area: there is only one place that decides what a viewer sees, and it's the same, already-tested RPC either way.
- **Two independent "is it revealed" computations exist by design** — one cheap JS optimization gate (skip a doomed RPC call) and one authoritative DB gate (re-checked every call). The pattern of "optimize with a cheap local check, but never trust it for anything security-relevant" is implicit here but never stated as a rule — worth a `context/foundation/lessons.md` entry if `/10x-plan` confirms the invariant holds.
- **No `try/catch` exists anywhere in the Server Action / RPC-wrapper call chain**, and the app has no error boundaries (`error.tsx`) at all. This is a structural gap beyond just Risk #2's claim path — any Server Action in this codebase has the same "post-success side effect throws → no user-visible signal" shape.
- **The write RPCs' authorization model is capability-based (UUID-as-bearer-token for reads), not ACL-based** — a deliberate, documented trade-off from the original schema design, not an oversight, but one that makes "wasn't shared with" in the risk map's language not literally testable as written; the plan should test "cross-owner," not "not shared with."

## Historical Context (from prior changes)

- `context/archive/2026-09-13-post-event-reveal/plan.md:24,49` — the phase that shipped the current composition explicitly scoped new coverage at "the untested application-layer composition," but what shipped (`reveal-status.test.ts`) only covers the pure merge function, not the page-level orchestration — the same gap this research reconfirms, now independently.
- `context/archive/2026-09-13-claim-gift-item/plan.md:17,36,119,220` — established the `refresh()`-after-mutation pattern and explicitly ruled out any live-push/polling alternative, meaning `refresh()` is the *only* channel connecting a successful write to what the guest next sees — and its reliability is assumed, never tested, throughout that plan.
- `context/archive/2026-09-11-surprise-rule-data-contract/research.md:64,402-436` — original design rationale for the share-token-as-capability model, and the source of the exact "extend to a second, unrelated event" recommendation that was never acted on — this phase is the first to act on it.

## Related Research

- `context/archive/2026-09-11-surprise-rule-data-contract/research.md` — schema/RLS/RPC design origin
- `context/archive/2026-09-13-claim-gift-item/plan.md` — guest claim flow (GIN-12)
- `context/archive/2026-09-13-post-event-reveal/plan.md` — reveal/composition flow (GIN-14)

## Open Questions

1. **Risk #1**: should the test target the app-vs-DB reveal-clock divergence directly (mock/fixture a diverging `auto_reveal_at` vs. DB `reveal_open`), or is proving the *orchestration* (fetch-skip / merge / degrade branches in `page.tsx`) sufficient, treating the divergence-is-harmless claim as already structurally guaranteed by `get_shared_items` re-deriving state per call? Recommend the latter as primary (cheaper, directly observable), with the former only if `/10x-plan` wants belt-and-suspenders.
2. **Risk #2**: confirmed the higher-value case is "RPC succeeds, `refresh()` throws" (hermetic, mock-based) rather than the false-success direction implied by change.md's original framing. `/10x-plan` should re-read the risk intent against this finding before phasing.
3. **Risk #3**: the risk map's phrase "wasn't shared with" doesn't map to a literal check in this codebase (no ACL exists) — recommend `/10x-plan` phrase the new pgTAP case as "cross-owner" (organizer A vs. unrelated organizer C's event), not "unshared," to keep the oracle honest.
