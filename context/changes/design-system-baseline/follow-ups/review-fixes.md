# Review follow-ups: design-system-baseline

Queued from `reviews/impl-review.md` triage (2026-09-11). Tick each item when done.

## For the PR description

- [ ] **F6 — Security note for the `src/lib/auth/routes.ts` edit.** Paste into the PR body's security section:

  > `src/lib/auth/routes.ts` gains a dev-only allowlist entry for `/design-system` (exact match). It is excluded from the production bundle because `process.env.NODE_ENV` is inlined at build time, and the page also calls `notFound()` in production. Both layers depend on the same `NODE_ENV` value, so they are not independent: a production build run with a non-`production` `NODE_ENV` (for example `NODE_ENV=test next build`) would disable both. The accepted residual risk is exposure of a static showcase with no user data. Builds must run with the default `NODE_ENV`.
