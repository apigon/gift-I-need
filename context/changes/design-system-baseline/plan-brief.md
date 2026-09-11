# Design System Baseline (F-03) — Plan Brief

> Full plan: `context/changes/design-system-baseline/plan.md`
> Approved palette proof: `context/changes/design-system-baseline/palette-proof.html`

## What & Why

This gives GIN one shared visual contract: semantic design tokens, a pastel theme, the load-bearing available/taken/mine/given status styles, and a consistent claim-feedback pattern. S-01–S-05 can then be built in parallel, often by separate agent runs, without each inventing its own badges, buttons and colours. The roadmap's own justification is capacity: stop drift before it starts.

## Starting Point

`globals.css` is untouched Next scaffold. It has a dark-mode block, and an Arial rule that silently overrides the Geist fonts the layout already loads. The F-01 auth screens were deliberately left plain for this change. They use raw classes (`text-red-600` ×7, `zinc`, `amber`, `dark:`) and duplicate their field/button markup.

## Desired End State

- Every screen renders from one semantic token set: rose-pink canvas, purple primary buttons with white labels, Fraunces "soft" headings, and Geist body text.
- Off-system classes don't compile, and `pnpm lint` rejects them.
- Six primitives (Heading/Text, Button, Link, TextField, StatusBadge, Alert) and a Sonner toast layer ship from `@/components`.
- A dev-only `/design-system` page shows all of it.
- The existing auth screens, header and home page are rebuilt on top of it with unchanged behaviour.

## Key Decisions Made

| Decision | Choice | Why (1 sentence) |
| --- | --- | --- |
| Status variants | available, taken, mine, given | Covers S-02/S-03/S-05 up front; no "hidden" variant, so the organizer view has nothing to leak |
| Token model | Semantic only; Tailwind palette, font-size and radius namespaces reset | The build refuses off-system colours rather than trusting convention |
| Dark mode | Light only for v1 (`color-scheme: light`) | Half the colour and contrast decisions; revisit post-MVP |
| Primitives scope | Heading/Text, Button, Link, TextField, StatusBadge, Alert (+ Toaster) | The pieces already duplicated or needed by every slice, and nothing beyond them |
| Claim feedback | Inline (button pending, then badge flip) **plus** toast | Inline satisfies the 1s/no-ambiguity NFR; the toast adds context but is never the only signal |
| Toast implementation | Sonner 2.x (MIT), unstyled + token classes | Accessible stacking and announcement without owning ~150 lines |
| Palette | User's `#FFF5F5` / `#4A4A4A` / `#F7D6D0`; purple `#7B5EA7` primary; `#E2B4BD` decorative-only | Rose buttons read as "danger" in review and fail AA with white text; every pair is AA-checked |
| Status colours | sage / warm grey / lavender ("mine") / honey ("given") | "Mine" in rose looked like an error; lavender ties it to the purple action that produced it |
| Typefaces | Fraunces `SOFT` 100 (headings) + Geist (body) | Free OFL match for the requested Gentle Soft Serif, which is personal-use-only |
| Accessibility | WCAG AA; status never colour-only; visible focus rings | FR-009's distinction must work for colour-blind guests too |
| Showcase | Dev-only `/design-system` route, 404 in production | One review surface and agent reference, with no Storybook |
| Drift guard | ESLint `no-restricted-syntax` regex + CLAUDE.md section | Tailwind silently drops unknown classes, so resetting the palette alone isn't a guard |
| Class joiner | Local `cn` in `src/lib/cn.ts`, no `classnames`/`clsx` | Variant maps + boolean flags need only a falsy-filter join; the `cn` name keeps a later swap to `clsx`/`tailwind-merge` a one-file change |

## Scope

**In scope:** token layer and fonts in `globals.css`/`layout.tsx`; the ESLint drift rule; the CLAUDE.md design-system section; six primitives plus Toaster/`notify`; the `/design-system` showcase (allowlisted, dev-only); moving the auth forms and pages, header and home page onto primitives.

**Out of scope:** dark mode; other components (Card, Modal, Select…); Storybook; tests (F-02 owns the runner); claim, list or event UI (S-01–S-05); resetting spacing or shadow scales.

## Architecture / Approach

The work runs bottom-up. Tokens, the class swap and the lint guard land in one commit, so nothing is silently unstyled. Primitives consume only tokens and stay Server-Component-compatible; only the Toaster is `"use client"`, and the barrel never is. Primitives accept `className` for layout only. The showcase exercises every state. Existing screens migrate last, as the first real consumers.

## Phases at a Glance

| Phase | What it delivers | Key risk |
| --- | --- | --- |
| 1. Token layer, fonts, drift guard | Semantic `@theme`, Fraunces+Geist applied, class swap, lint rule, CLAUDE.md | The palette reset silently strips classes if split from the swap; the lint regex misses a form |
| 2. Primitives + toast layer | Six primitives, Sonner Toaster, `notify()`, barrel | A `"use client"` barrel would break Server Component use |
| 3. Showcase route | `/design-system`, dev-only, allowlisted | A security-relevant edit to the fail-closed route allowlist |
| 4. Move current screens | Auth forms/pages, header and home rebuilt on primitives | Regressing F-01's controlled-input fix or `next` threading |

**Prerequisites:** none. F-01 is merged; Tailwind v4 and next/font are present.
**Estimated effort:** ~2 sessions across 4 phases.

## Open Risks & Assumptions

- The `--font-display--font-variation-settings` companion is assumed to work in Tailwind 4.3. If it doesn't, the fallback is a base-layer rule on `h1–h3`, checked in Phase 3.
- The showcase 404s on Cloudflare PR previews too, since those are production builds, so it can only be reviewed locally via `pnpm dev`.
- The ESLint regex is a heuristic. Class names built dynamically (e.g. `` `text-${c}-600` ``) can slip past it.

## Success Criteria (Summary)

- `/design-system` matches the approved palette proof, and every text pair meets AA.
- Adding `text-red-600`, `text-sm` or `dark:` anywhere in `src` fails `pnpm lint`.
- Sign-up, sign-in and sign-out behave exactly as before, now rendered entirely from primitives.
