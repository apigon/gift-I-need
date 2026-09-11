<!-- IMPL-REVIEW-REPORT -->
# Implementation Review: Design System Baseline (F-03)

- **Plan**: context/changes/design-system-baseline/plan.md
- **Scope**: Phases 1–4 of 4 (full plan)
- **Date**: 2026-09-11
- **Verdict**: NEEDS ATTENTION
- **Findings**: 0 critical, 4 warnings, 4 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| Plan Adherence | WARNING |
| Scope Discipline | WARNING |
| Safety & Quality | WARNING |
| Architecture | PASS |
| Pattern Consistency | WARNING |
| Success Criteria | PASS |

## Evidence

- **Plan drift.** 25 of the 26 planned items match the plan, with no drift and nothing missing. Two deviations were approved and implemented to their updated contracts: TextField became `Input`, and `routes.ts` got the `DEV_ONLY_EXACT_PATHS` conditional allowlist. The one extra is `src/app/not-found.tsx`, which the user approved.
- **Automated checks (re-run 2026-09-11)**, all passing:
  - `pnpm lint` exits 0, `pnpm typecheck` exits 0 and `pnpm build` exits 0.
  - The drift-guard probes (`text-red-600`, `text-sm`, `md:text-sm`, `dark:bg-black`) fail lint, and `bg-canvas` passes.
  - The off-system grep returns nothing.
  - `pnpm why sonner` shows 2.0.8.
  - The barrel has no `"use client"` directive. `toaster.tsx` is the only client module.
  - The grep for hand-rolled `<button>`, `<label>` or `role="alert"` markup returns nothing, and `next/link` is imported only from `link.tsx`.
  - Signed out, `/design-system` returns 200 in dev and a 307 to `/login?next=%2Fdesign-system` in prod.
- **Manual checks.** All 32 Progress items are `[x]` with commit SHAs. None of them is contradicted by the diff.
- **Security.** No security, open-redirect or client/server boundary regressions were found. The auth forms keep their controlled `value`/`onChange`, the hidden `next` input, the error ids, and the pending double-submit guard.

## Findings

### F1 — Drift guard misses common variant and modifier forms

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: eslint.config.mjs:9
- **Detail**: The plan says the guard flags palette colours "with or without variant prefixes", but the variant pattern `([a-z-]+:)*` doesn't allow digits, brackets or `=`. Probing with `eslint --stdin` shows these pass lint:
  - `2xl:text-red-500`, a built-in breakpoint;
  - `data-[state=open]:bg-red-500`;
  - `bg-red-500!`, Tailwind v4's important suffix;
  - `md:dark:bg-canvas`, because `dark:` is only caught at the start of a class.

  After the reset, each of these silently renders nothing, which is exactly what the guard exists to prevent. Arbitrary values such as `text-[13px]` were an accepted gap in the plan (plan.md:176) and are not counted here.
- **Fix**: Widen the variant prefix to `([^\s:]+:)*` in all three branches, allow a trailing `!?` before the end anchor, and match `dark:` after any prefix (`(^|\s|:)dark:`). Then re-probe the four forms above plus the token classes.
  - Strength: A one-line regex change that closes every palette hole the probes found. It uses the same verification method the plan review used.
  - Tradeoff: A broader prefix makes false positives slightly more likely in non-class strings. The existing probe set catches that.
  - Confidence: HIGH. Each gap was reproduced with a real ESLint run.
  - Blind spot: Arbitrary values (`bg-[rgb(…)]`, inline `style`) remain out of scope, as the plan decided.
- **Decision**: FIXED (Fix now), with one addition: `!?` also allowed after the prefix, which covers the legacy leading `!bg-red-500`. Verified with ESLint `--stdin` probes: all 16 must-flag forms and the template-literal form are flagged, and all 16 token classes pass. `pnpm lint` exits 0.

### F2 — `/` and the 404 page lost their `<main>` landmark

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/app/page.tsx:5, src/app/not-found.tsx:5
- **Detail**: On main, `page.tsx` wrapped its content in `<main>`. The Phase 4 rewrite uses a bare `<div>`, and `not-found.tsx` does the same. `layout.tsx` has no `<main>`, so both pages have no main landmark, while `/login`, `/signup` and `/design-system` do.
- **Fix**: Change the outer `<div>` to `<main>` in both files.
- **Decision**: FIXED (Fix now). The outer `<div>` is now `<main>` in `src/app/page.tsx` and `src/app/not-found.tsx`. `pnpm lint` and `pnpm typecheck` exit 0.

### F3 — Typography passed through `className` on primitives

- **Severity**: ⚠️ WARNING
- **Impact**: 🔎 MEDIUM — real tradeoff; pause to reason through it
- **Dimension**: Pattern Consistency
- **Location**: src/app/layout.tsx:47, src/app/design-system/page.tsx:70
- **Detail**: This change's own CLAUDE.md rule (line 68) says `className` on a primitive is "layout only … never colour or typography". It is broken in two places:
  - `<Link href="/" className="font-display text-heading">`. The wordmark also inherits Link's `text-accent underline`.
  - `<Text variant="small" className="font-bold">`.

  The plan's Phase 4 §3 wording ("wordmark in `font-display` linking to `/`") invited the first one. Lint can't see these because the classes are valid tokens, which makes them the first examples future slices would copy.
- **Fix A ⭐ Recommended**: Put the typography on a plain element inside the primitive, `<Link href="/"><span className="font-display text-heading">Gift I Need</span></Link>`, and drop `font-bold` from the showcase `Text`.
  - Strength: The smallest change, with no new API surface, and it follows the rule literally.
  - Tradeoff: The wordmark stays accent-coloured and underlined, as it looks today.
  - Confidence: HIGH. The change is purely structural.
  - Blind spot: Whether you want the wordmark to look like a link at all.
- **Fix B**: Add a `variant="plain"` (no accent or underline) to `Link` and use it for the wordmark.
  - Strength: Gives the brand mark a proper non-link look, and later nav and logo work will need that anyway.
  - Tradeoff: Grows the primitive API, and the new variant needs a showcase entry.
  - Confidence: MED. It's a guess at future needs.
  - Blind spot: A plain variant loses the visual affordance that it's a link.
- **Decision**: SKIPPED

### F4 — CLAUDE.md and the plan still name `TextField`

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Plan Adherence
- **Location**: CLAUDE.md:68, plan.md (§2.5, §2.9, Testing Strategy)
- **Detail**: The rename to `Input` is recorded only in the p2 commit message. CLAUDE.md, which every later agent reads first, lists `TextField` among the primitives, so an S-01 agent following it will write `import { TextField } from "@/components"` and hit a build error.
- **Fix**: Change `TextField` to `Input` in CLAUDE.md:68, and add a short deviation addendum to plan.md recording the rename (and the `not-found.tsx` addition, see F5).
- **Decision**: FIXED (Fix now). CLAUDE.md:68 now lists `Input`, and plan.md has a new `## Deviations` section before `## Progress` that records the rename and the `not-found.tsx` addition. The plan body and `plan-brief.md` were left as the original contract.

### F5 — Unplanned `src/app/not-found.tsx`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Scope Discipline
- **Location**: src/app/not-found.tsx
- **Detail**: This page isn't in any phase. The user approved it as a follow-up. It's built entirely from primitives and tokens, so it's harmless, but the plan doesn't record it.
- **Fix**: Note it in the same plan addendum as F4.
- **Decision**: FIXED (resolved by F4's plan addendum). `not-found.tsx` is recorded in plan.md `## Deviations`.

### F6 — Both `/design-system` guards key on the same `NODE_ENV`

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (security)
- **Location**: src/lib/auth/routes.ts:32-38, src/app/design-system/page.tsx:48
- **Detail**: Both guards fail closed under a normal `next build`: the value is inlined at build time, the path match is exact, and prod was verified to return a 307. But `next build` keeps any `NODE_ENV` already set in the environment and only warns when it is `development`. `NODE_ENV=test next build` would switch both guards off together, so they aren't independent. The only thing exposed would be a static showcase with no data.
- **Fix**: Accept the risk, and say in the PR description (already required for the `routes.ts` edit) that both layers depend on `NODE_ENV`.
- **Decision**: ACCEPTED (risk). No code change. The PR-description note is queued in `follow-ups/review-fixes.md` (F6).

### F7 — `notify` from the barrel is a client reference

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (reliability)
- **Location**: src/components/index.ts:8
- **Detail**: `notify` is re-exported from `"use client"` `toaster.tsx`. A Server Component or Server Action that imports it from `@/components` compiles and lints cleanly, then throws at runtime. No current caller does this, but S-03's claim action is the obvious candidate.
- **Fix**: Add a one-line JSDoc on `notify` ("client-only — Server Actions return state; call notify from the client form"). Reconsider a lint rule when S-03 lands.
- **Decision**: FIXED (Fix now). A client-only JSDoc was added to `notify` in `src/components/toaster/toaster.tsx`. The lint rule is deferred to S-03.

### F8 — Caller props can override computed ARIA attributes

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW — quick decision; fix is obvious and narrowly scoped
- **Dimension**: Safety & Quality (accessibility)
- **Location**: src/components/input/input.tsx:29-36, src/components/button/button.tsx:27-36
- **Detail**: `{...props}` is spread after the computed `aria-invalid`/`aria-describedby` (Input) and `aria-busy` (Button; `disabled` is destructured, so the pending lock is safe). A caller passing `aria-describedby` silently breaks the hint and error link. No current caller does either.
- **Fix**: Spread `{...props}` before the computed attributes, merging a caller's `aria-describedby` with the computed ids.
- **Decision**: FIXED (Fix now, applied through destructuring instead of reordering the spread). `aria-invalid` and `aria-describedby` are destructured in Input, and `aria-busy` in Button, so the spread can no longer carry them. A caller's `aria-describedby` is merged with the hint and error ids. `error` and `pending` win, and otherwise the caller's value passes through. `pnpm lint`, `pnpm typecheck` and `pnpm build` exit 0.

## Triage summary (2026-09-11)

| Outcome | Findings |
|---------|----------|
| Fixed | F1, F2, F4, F5 (via F4's addendum), F7, F8 |
| Accepted (risk) | F6. The PR note is queued in `follow-ups/review-fixes.md` |
| Skipped | F3 |

After the fixes, `pnpm lint`, `pnpm typecheck` and `pnpm build` all exit 0.
