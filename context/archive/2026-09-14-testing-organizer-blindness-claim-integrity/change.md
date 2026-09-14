---
change_id: testing-organizer-blindness-claim-integrity
title: Organizer-blindness and claim-integrity guard
status: archived
created: 2026-09-14
updated: 2026-09-14
archived_at: 2026-09-14T21:38:12Z
---

## Notes

Rollout Phase 1 of `context/foundation/test-plan.md` ("Organizer-blindness & claim-integrity guard").

Risks covered:
- #1 — organizer page composition (merging two reads, caching, or a direct URL hit) leaks claim status/claimer identity/counts pre-reveal, even though the underlying RPC correctly nulls it.
- #2 — a guest's claim request resolves in a way the client reads as "success" without a durable, matching DB row, or the reverse (persisted but never reflected).
- #3 — a shared-token RPC call (`claim_item`/`mark_given`/`unlock_event`) made directly, bypassing the UI, against an event/item the caller doesn't own or wasn't shared with, isn't rejected the same way the UI path rejects it.

Test types planned: integration (Vitest), pgTAP.

Risk response intent:
- #1: prove that organizer data reads (normal load, post-claim, refresh, direct URL) never expose claim status/identity/counts pre-reveal; challenge the assumption that the RPC alone is sufficient — the composition layer is the real risk surface.
- #2: prove the guest's next read always matches what was actually persisted after a claim resolves, in every response path; challenge the assumption that a non-error Server Action response guarantees persistence.
- #3: prove that direct RPC calls (bypassing the UI) for an unowned/unshared event or item are rejected identically to the UI path; challenge the assumption that "the button does not render" is itself a security control.

See `context/foundation/test-plan.md` §2 (Risk Map + Risk Response Guidance, rows #1–#3) and §3 (Phased Rollout, row 1) for full source evidence and rationale.
