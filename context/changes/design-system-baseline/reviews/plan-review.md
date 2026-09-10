<!-- PLAN-REVIEW-REPORT -->
# Plan Review: Design System Baseline (F-03)

- **Plan**: context/changes/design-system-baseline/plan.md
- **Mode**: Deep (claims verified inline, including the ESLint regex run through ESLint 9 / esquery 1.7 / typescript-eslint 8.62 against probe files)
- **Date**: 2026-09-10
- **Verdict**: SOUND
- **Findings**: 0 critical, 2 warnings, 2 observations

## Verdicts

| Dimension | Verdict |
|-----------|---------|
| End-State Alignment | PASS |
| Lean Execution | PASS |
| Architectural Fitness | PASS |
| Blind Spots | WARNING |
| Plan Completeness | WARNING |

## Grounding
10/10 paths ✓. 7/7 symbols ✓: `PUBLIC_EXACT_PATHS`, the `--font-*--font-variation-settings` companion (tailwindcss 4.3.2 `lib.js`), Fraunces `SOFT`/`opsz` axes, the `typecheck` script, Sonner 2.0.8 MIT with a react ^19 peer, the `email-error`/`password-error` ids, and 21/21 plan hexes present in `palette-proof.html`. brief↔plan ✓. Progress↔Phase ✓ (1.1–4.11, no stray checkboxes).

## Findings

### F1 — Drift-guard regex misses responsive and modifier forms

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW (quick decision; fix is obvious and narrowly scoped)
- **Dimension**: Blind Spots
- **Location**: Phase 1 §4 Drift guard
- **Detail**: The regex ran as written in real ESLint and caught palette, `hover:`, `/opacity`, `rounded-lg`, `-[#`, `dark:` and template-literal forms. It missed `md:text-sm` and `text-sm/6`, because the font-size and radius branches had no variant prefix or modifier. After the `--text-*` reset these emit nothing and fail silently.
- **Fix**: Add `([a-z-]+:)*` to the size and radius branches, add `(\\/\\S+)?` after the size, and add `md:text-sm` to probe 1.4. Re-verified: `md:text-sm`, `text-sm/6` and `md:rounded-lg` are now flagged, and token classes stay clean.
- **Decision**: FIXED

### F2 — Two success criteria can't tell pass from fail

- **Severity**: ⚠️ WARNING
- **Impact**: 🏃 LOW (quick decision; fix is obvious and narrowly scoped)
- **Dimension**: Plan Completeness
- **Location**: Phase 1 criterion 1.7, Phase 4 criterion 4.4
- **Detail**: 1.7 expected soft-Fraunces headings after Phase 1, but nothing in Phase 1 applies `font-display` (Heading is Phase 2, and the home page has only a `<p>`). The 4.4 grep for `className="border px` is invalidated by Phase 1's `border` → `border border-edge` swap, so it passes trivially.
- **Fix**: 1.7 now checks the canvas background plus the Fraunces font loading. 4.4 now greps `'<button|<label|role="alert"' src/app`.
- **Decision**: FIXED

### F3 — Two showcase traps in a Server Component page

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW (quick decision; fix is obvious and narrowly scoped)
- **Dimension**: Blind Spots
- **Location**: Phase 3 §1–§2
- **Detail**: Swatches built as `` `bg-${name}` `` are never generated, because Tailwind only scans literal strings. A controlled TextField in a Server Component has `value` without `onChange`, which gives a read-only field and a React console warning.
- **Fix**: Swatch classes must be written literally. The controlled sample moves to a `"use client"` `ControlledFieldDemo` sibling of `ToastDemo`.
- **Decision**: FIXED

### F4 — Primitive `Link` shares its name with next/link's default export

- **Severity**: 💡 OBSERVATION
- **Impact**: 🏃 LOW (quick decision; fix is obvious and narrowly scoped)
- **Dimension**: Architectural Fitness
- **Location**: Phase 2 §4 Link / Phase 4
- **Detail**: Auto-import in S-01 to S-05 will keep offering `next/link`, which bypasses the styled wrapper, and the class-based lint can't see it. Three files import `next/link` today.
- **Fix**: `no-restricted-imports` for `next/link`, turned off for `src/components/link/**`, plus a CLAUDE.md bullet. The rule was placed in **Phase 4 §5**, not Phase 1: the auth pages and AuthStatus import `next/link` until Phase 4 migrates them, so a Phase 1 ban would fail 1.1. The shape was verified in ESLint 9 flat config, and 4.4 also checks that only `link.tsx` imports `next/link`.
- **Decision**: FIXED
