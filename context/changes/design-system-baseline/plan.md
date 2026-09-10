# Design System Baseline (F-03) Implementation Plan

## Overview

This replaces the stock Next.js scaffold styling with GIN's shared visual contract, so that S-01–S-05 can be built in parallel without drifting apart. It has five parts:

- **Semantic token layer.** The approved pastel palette with Tailwind's default colour palette switched off, plus a semantic type scale and radii.
- **Fonts.** Fraunces with its `SOFT` axis for headings, and Geist for everything else.
- **Six shared primitives.** Heading/Text, Button, Link, TextField, StatusBadge and Alert.
- **Toast layer.** Sonner, styled with the tokens.
- **Dev-only showcase and guardrails.** A `/design-system` route, a lint rule that rejects off-system classes, and existing screens moved onto the system.

## Current State Analysis

- **`src/app/globals.css:1-26` is untouched scaffold.** It has two hex variables, a `prefers-color-scheme: dark` block (`:16-21`), and `body { font-family: Arial, … }` (`:23-27`). That rule overrides the Geist fonts `src/app/layout.tsx:2-15` already loads, so Geist is downloaded but never rendered.
- **Raw palette and size classes are scattered through the app:**
  - `text-red-600` ×7: `sign-in-form.tsx:40,60,81`, `sign-up-form.tsx:31,51,72`, `login/page.tsx:38`.
  - `bg-zinc-50`, `dark:bg-black`, `bg-white` and `text-amber-500` in `src/app/page.tsx:3-6`.
  - `text-sm` and `text-2xl` across the auth pages and `auth-status.tsx`.
- **F-01 deferred styling to this change on purpose** (`src/app/(auth)/login/page.tsx:8`: "Markup is deliberately plain: F-03 … owns the visual layer"). The auth forms duplicate the same label/input/error/button markup, and F-03's primitives absorb it.
- **The F-01 forms are controlled on purpose** (`sign-in-form.tsx:22-31`). React 19 resets uncontrolled forms after an action, so any primitive has to pass `value`/`onChange` through untouched.
- **The auth proxy is fail-closed** (`src/lib/auth/routes.ts:28-48`). Any new route not allowlisted redirects signed-out visitors to `/login`, and edits to that file are security-relevant.
- **No test runner exists.** F-02 owns adding one. Verification here is lint, typecheck, build and manual review.

## Desired End State

- **The token system.** `globals.css` defines only GIN's semantic tokens: colour, font-size scale, radii and fonts. Tailwind's default colour, font-size and radius namespaces are reset, so `bg-zinc-50` or `text-sm` generates nothing.
- **The drift guard.** An ESLint rule fails `pnpm lint` on any raw palette, default font-size, default radius, arbitrary hex or `dark:` class, and on a direct `next/link` import outside the Link primitive.
- **Fonts.** Headings render in Fraunces with `SOFT` 100, and body and UI text render in Geist.
- **Light only.** The app renders the light theme on every device, including devices set to dark mode.
- **Primitives.** `src/components/` exports Heading, Text, Button, Link, TextField, StatusBadge, Alert, Toaster and `notify` from one barrel.
- **Toasts.** A token-styled Sonner `<Toaster>` is mounted in the root layout.
- **Showcase.** `/design-system` renders every token, status variant, primitive state and a live toast in development, and returns 404 in production.
- **Existing screens.** `/`, `/login`, `/signup` and the header render entirely through primitives and tokens, and the F-01 behaviour is unchanged.
- **Agent guidance.** CLAUDE.md has a "Design system" section telling agents to use tokens and primitives only.

### Key Discoveries:

- **Tailwind 4.3.2 is CSS-first, with no `tailwind.config.*`.** Its default namespaces are `--color-*`, `--text-*`, `--radius-*` and `--font-*`, with `--spacing: 0.25rem` (`node_modules/tailwindcss/theme.css:325,347-359,398-400`). Resetting a namespace with `--color-*: initial` is supported.
- **Tailwind emits nothing for an unknown class, and doesn't error.** Once the palette is reset, a leftover `text-red-600` renders as unstyled text with no warning. Resetting the palette alone isn't a guard, and that's the reason for the lint rule.
- **`next/font/google` accepts `axes` for variable fonts** (`node_modules/next/dist/docs/01-app/03-api-reference/02-components/font.md:160`). Fraunces exposes `SOFT`, `WONK`, `opsz` and `wght` (checked in `font-data.json`).
- **Sonner 2.0.8 is MIT-licensed** with peer deps `react ^18 || ^19`, which fits the user's free/OSS preference.
- **Contrast is checked against WCAG AA.** Every text pair in `context/changes/design-system-baseline/palette-proof.html` is at least 4.5:1, and UI boundaries are at least 3:1. The user supplied `#E2B4BD` fails with white text (1.83:1) and as a border (1.71:1), so it is decorative-only.

## What We're NOT Doing

- **A component library beyond the six primitives plus Toaster.** Anything else (Card, Modal, Select, list layouts) belongs to the slice that first needs it.
- **Dark mode.** v1 is light-only. `color-scheme: light` is set so native controls don't flip on dark-mode devices.
- **Storybook or any component workbench.** The showcase route replaces it.
- **Tests.** F-02 owns the test runner. Unit-test targets are listed under Testing Strategy for when it exists.
- **Resetting the spacing scale or shadows.** Tailwind's default `--spacing` (0.25rem) is the spacing token.
- **Claim, list, or event UI.** S-01–S-05 build those with these primitives. StatusBadge and the toast demo appear only in the showcase.
- **An organizer "hidden" status style.** The organizer's pre-event view renders no status at all. Enforcement stays at the data layer (F-02).
- **Page metadata beyond fixing the scaffold "Create Next App" title.**

## Implementation Approach

The work runs bottom-up. Tokens come first, together with a mechanical class swap and the lint guard, so nothing is ever silently unstyled. Next come primitives that consume only tokens, then a showcase that exercises every primitive state. Last, existing screens move onto the primitives.

Primitives stay Server-Component-compatible (no `"use client"`, no hooks) except the Toaster, so they drop into the F-01 pattern of Server Components plus small client forms. Primitives take `className` for **layout only** (margin, width, flex placement). Colour and typography come from their own variants. That rule is documented rather than enforced by a class-merging library, to avoid adding `tailwind-merge`.

## Critical Implementation Details

- **Ordering: the reset and the swap land together.** The palette reset in `globals.css` and the mechanical swap of existing raw classes must land in the same commit (Phase 1). Split apart, the reset silently strips the auth error colour and page backgrounds, and nothing fails.
- **Barrel and client boundary.** `src/components/index.ts` must not carry `"use client"`. Only `toaster/toaster.tsx` (and the showcase's `toast-demo`) do. A `"use client"` barrel would turn every primitive into a client component and break Server Component usage such as `AuthStatus`.
- **The toast is never the only signal.** It is supplementary. The NFR's "visible within 1s, no ambiguous pending state" is met by the inline change: Button `pending`, then the StatusBadge flip. A missed or dismissed toast must never be the only confirmation. Document this for S-03 in the CLAUDE.md section.
- **Tailwind keywords after the reset.** `--color-*: initial` also removes `--color-white` and `--color-black`. `transparent`, `current` and `inherit` are built-in keywords and should survive. Confirm `bg-transparent` still works in the Phase 3 showcase.

## Phase 1: Token layer, fonts, and drift guard

### Overview

Establish the semantic tokens and fonts, turn off Tailwind's default palette, swap the few existing raw classes onto tokens in the same commit, and add the lint rule and CLAUDE.md guidance that keep it that way.

### Changes Required:

#### 1. Theme tokens

**File**: `src/app/globals.css`

**Intent**: Replace the scaffold variables, dark block and Arial override with GIN's semantic theme, and reset the default namespaces so off-system utilities stop generating.

**Contract**: One `@theme` block resets `--color-*`, `--text-*` and `--radius-*` to `initial`, then defines the tokens below. They generate utilities such as `bg-canvas`, `text-fg`, `border-edge`, `text-title` and `rounded-control`. Values are the approved rev 2 palette from `palette-proof.html`:

| Token | Value | Role |
|---|---|---|
| `--color-canvas` | `#FFF5F5` | page background |
| `--color-surface` | `#FFFFFF` | cards, inputs, toasts |
| `--color-surface-tint` | `#F7D6D0` | subtle fills, info alert |
| `--color-fg` | `#4A4A4A` | body text (8.28 on canvas) |
| `--color-fg-muted` | `#6B6B6B` | secondary text, canvas/surface only (4.98) |
| `--color-edge` | `#9C7D84` | UI boundaries: inputs, secondary button (3.46) |
| `--color-hairline` | `#EFD9DA` | decorative dividers only — never a UI boundary |
| `--color-brand-rose` | `#E2B4BD` | decorative brand accent — never a fill for controls |
| `--color-primary` | `#7B5EA7` | primary button fill (white label 5.25) |
| `--color-primary-hover` | `#6D4C9F` | primary hover (6.59) |
| `--color-on-primary` | `#FFFFFF` | label on primary |
| `--color-accent` | `#6D4C9F` | links, focus ring (6.16 on canvas) |
| `--color-danger` / `--color-danger-surface` | `#A33A3A` / `#FBE4E1` | errors (5.36) |
| `--color-success` / `--color-success-surface` | `#2F6B4F` / `#DDEEDD` | success (5.88) |
| `--color-status-available` / `-surface` | `#2F5D3A` / `#DDEEDD` | 6.31 |
| `--color-status-taken` / `-surface` | `#5A5A5A` / `#ECE6E6` | 5.59 |
| `--color-status-mine` / `-surface` | `#5B3F8C` / `#ECE4F7` | 6.71 |
| `--color-status-given` / `-surface` | `#7A5A1E` / `#FBEBC8` | 5.39 |

Font-size tokens (each with a `--line-height` companion): `display` 2.5rem/1.1, `title` 1.5rem/1.2, `heading` 1.125rem/1.3, `body` 1rem/1.55, `small` 0.875rem/1.5, `caption` 0.75rem/1.4. Radii: `control` 0.625rem and `card` 1rem (`rounded-full` stays built in).

Fonts go in a separate `@theme inline` block because they reference next/font variables: `--font-display` (Fraunces variable, then Georgia/serif), `--font-sans` (Geist, then system-ui), `--font-mono` (Geist Mono). `--font-display` carries a `SOFT` 100 variation companion:

```css
@theme inline {
  --font-display: var(--font-fraunces), "Iowan Old Style", Georgia, serif;
  --font-display--font-variation-settings: "SOFT" 100;
}
```

If Tailwind 4.3 doesn't apply the `--font-*--font-variation-settings` companion (check in the showcase), fall back to setting the variation on `h1–h3` in the base layer.

An `@layer base` rule sets `:root { color-scheme: light }`, gives `body` the canvas background, `fg` text and `font-sans`, and styles `:focus-visible` globally with a 2px `accent` outline at 2px offset. The dark media block and the Arial rule are deleted.

#### 2. Fonts

**File**: `src/app/layout.tsx`

**Intent**: Load Fraunces with its soft axis and actually apply the fonts. The stale scaffold metadata gets fixed while this file is open.

**Contract**:

- Add `Fraunces({ subsets: ["latin"], axes: ["SOFT", "opsz"], variable: "--font-fraunces" })` next to the existing Geist and Geist Mono loaders, and add its `.variable` to the `<html>` className.
- Set metadata `title` to "Gift I Need" and write a one-line description.
- Leave the header markup and the AuthStatus note untouched. Phase 4 restyles them.

#### 3. Mechanical class swap

**Files**: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/login/components/sign-in-form/sign-in-form.tsx`, `src/app/(auth)/signup/page.tsx`, `src/app/(auth)/signup/components/sign-up-form/sign-up-form.tsx`, `src/app/components/auth-status/auth-status.tsx`, `src/app/page.tsx`

**Intent**: Swap each off-system class for its token equivalent, one-for-one, so the reset doesn't strip styling. This isn't a redesign; Phase 4 does that.

**Contract**:

| Old class | New class |
|---|---|
| `text-red-600` | `text-danger` |
| `text-sm` | `text-small` |
| `text-2xl` | `text-title` |
| `bg-zinc-50 dark:bg-black` | `bg-canvas` |
| `bg-white dark:bg-black` | `bg-surface` |
| `text-amber-500` | `text-accent` |

Bare `border` utilities get `border-edge`.

#### 4. Drift guard

**File**: `eslint.config.mjs`

**Intent**: Make `pnpm lint` fail on off-system classes. Tailwind silently ignores them after the reset, so without this rule drift is invisible.

**Contract**: Add a config entry scoped to `src/**/*.{ts,tsx}` that uses `no-restricted-syntax` against string `Literal` and `TemplateElement` nodes. Its message points to the CLAUDE.md "Design system" section. The pattern must flag:

- default palette colours on any colour utility, with or without variant prefixes and shades;
- the default font-size scale (`text-xs`…`text-9xl`), with or without variant prefixes (`md:text-sm`) and line-height modifiers (`text-sm/6`);
- the default radius scale (`rounded-sm`…`rounded-4xl`, and side/corner forms), with or without variant prefixes;
- arbitrary hex values (`-[#…]`);
- any `dark:` variant.

The regex is the non-obvious part (esquery regex, so backslashes are doubled inside the JS string):

```js
const OFF_SYSTEM =
  "/(^|\\s)([a-z-]+:)*(bg|text|border|ring|outline|fill|stroke|divide|placeholder|decoration|accent|caret|shadow|from|via|to)-(red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)(-\\d{2,3})?(\\/\\d+)?(\\s|$)|(^|\\s)([a-z-]+:)*text-(xs|sm|base|lg|[2-9]?xl)(\\/\\S+)?(\\s|$)|(^|\\s)([a-z-]+:)*rounded(-[trblse]{1,2})?-(xs|sm|md|lg|[2-4]?xl)(\\s|$)|-\\[#|(^|\\s)dark:/";
// selectors: `Literal[value=${OFF_SYSTEM}]` and `TemplateElement[value.raw=${OFF_SYSTEM}]`
```

Token names (`canvas`, `edge`, `primary`, `status-*` …) are chosen so none collide with a banned palette name.

This regex was run through ESLint 9 / esquery 1.7 during plan review. It flags palette, variant-prefixed, `/opacity`, `md:text-sm`, `text-sm/6`, `md:rounded-lg`, `-[#…]`, `dark:` and template-literal forms, and it passes the token classes. It knowingly does not flag bare `rounded` or arbitrary non-hex values such as `text-[13px]`.

#### 5. Agent guidance

**File**: `CLAUDE.md`

**Intent**: Give every later slice's agent the contract in a place it reads first.

**Contract**: Add a `## Design system` section after "Code structure convention", 10–15 lines at most, covering:

- Only semantic tokens, never raw palette/hex/`dark:` (lint-enforced).
- Primitives come from `@/components`. `className` on a primitive is for layout only.
- A status always renders through StatusBadge, with its label.
- Toasts supplement the inline state change and never replace it.
- New tokens are added to `globals.css` **and** `/design-system`.
- `palette-proof.html` is the colour reference.
- Primary buttons use purple `primary` with `on-primary`. `brand-rose` is decorative only.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm typecheck`
- Production build succeeds: `pnpm build`
- The drift guard fires. A throwaway `src/lint-probe.tsx` containing `className="text-red-600"`, one containing `className="text-sm"`, one containing `className="md:text-sm"` and one containing `className="dark:bg-black"` each make `pnpm lint` fail. Delete the probe afterwards.
- No off-system classes remain: `grep -rnE 'text-red-|zinc-|amber-|dark:' src` returns nothing

#### Manual Verification:

- `/login` and `/signup` look the same as before apart from colours and fonts, and validation errors still render in the danger colour
- The home page shows the canvas background, and the Network tab shows the Fraunces font file loading. Heading rendering is checked in Phase 3 (3.7), once `Heading` exists.
- With the OS set to dark mode, the app stays light, including native form controls
- Body text renders in Geist, not Arial (check the computed font in DevTools)

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 2: Primitives and toast layer

### Overview

Build the six shared primitives and the token-styled toast layer. Everything is exported from one barrel. Nothing consumes them yet except the mounted Toaster.

### Changes Required:

#### 1. Class-join helper

**File**: `src/lib/cn.ts`

**Intent**: A tiny dependency-free helper that joins conditional class strings for the primitives.

**Contract**: `cn(...parts: Array<string | false | null | undefined>): string`. It filters falsy parts and joins with spaces, with no conflict resolution (hence "className is layout only"). `classnames`/`clsx` were considered and not adopted, because primitives select classes from variant maps plus boolean flags, so object syntax adds nothing. If a slice later needs it, re-export `clsx` (or `clsx` + `tailwind-merge`) as `cn` here; call sites don't change.

#### 2. Typography

**File**: `src/components/typography/typography.tsx`

**Intent**: One place that maps the semantic type scale to elements, so slices never pick font sizes or families directly.

**Contract**:

- `Heading({ level: 1 | 2 | 3; size?: "display" | "title" | "heading"; className?; children })` renders `h1`–`h3` in `font-display`. `size` defaults to `level` 1 → `title`, 2 → `heading`, 3 → `heading`; `display` is opt-in for hero use.
- `Text({ as?: "p" | "span" | "div"; variant?: "body" | "small" | "caption"; tone?: "default" | "muted"; className?; children })`. `caption` is uppercase with letter-spacing.

#### 3. Button

**File**: `src/components/button/button.tsx`

**Intent**: The primary and secondary buttons, with the pending state the claim NFR depends on.

**Contract**:

- `Button({ variant?: "primary" | "secondary"; pending?: boolean; pendingLabel?: string } & ButtonHTMLAttributes)`. `type` defaults to `"button"`.
- `primary` is `bg-primary text-on-primary`, with `hover:bg-primary-hover`.
- `secondary` is `bg-surface text-fg border-edge`.
- When `pending` is set, the button is `disabled` and `aria-busy`, shows an inline spinner (static under `motion-reduce`) and `pendingLabel` if one is given. Disabling on pending keeps F-01's double-submit protection.
- No hooks and no `"use client"`, so it works inside a Server Component `<form action={serverAction}>`.

#### 4. Link

**File**: `src/components/link/link.tsx`

**Intent**: A styled wrapper around `next/link` so every in-app link looks and focuses the same.

**Contract**: `Link(props: ComponentProps<typeof NextLink>)` renders `text-accent` with an underline offset and a thicker underline on hover. Focus uses the global ring.

#### 5. TextField

**File**: `src/components/text-field/text-field.tsx`

**Intent**: Replace the label/input/error block duplicated in both auth forms, with the accessibility wiring built in.

**Contract**:

- `TextField({ id: string; label: string; error?: string; hint?: string } & InputHTMLAttributes)`. It renders a `<label htmlFor>`, an input with `border-edge rounded-control bg-surface`, an optional hint (`${id}-hint`) and an error (`${id}-error`, `text-danger`).
- It sets `aria-invalid` when `error` is present, and `aria-describedby` to whichever of hint and error exist.
- It passes all remaining props, notably `value` and `onChange`, straight to the `<input>`, so the controlled F-01 forms keep working.
- The error id format matches F-01's existing `email-error` / `password-error` ids.

#### 6. StatusBadge

**File**: `src/components/status-badge/status-badge.tsx`

**Intent**: The load-bearing available/taken/mine/given visual. It is never colour-only.

**Contract**:

- `StatusBadge({ status: BadgeStatus; children?: ReactNode })`, with `export type BadgeStatus = "available" | "taken" | "mine" | "given"`.
- Default labels are "Available", "Taken", "Claimed by you" and "Given". `children` overrides the label text only.
- Renders a pill with a dot, a 1px `currentColor` outline and the label, using the `status-<x>` / `status-<x>-surface` tokens.
- There is deliberately no "hidden" or unknown variant. The display union is named `BadgeStatus` so it doesn't pre-empt F-02's domain type.

#### 7. Alert

**File**: `src/components/alert/alert.tsx`

**Intent**: Inline feedback, replacing the ad hoc `role="alert"` paragraphs.

**Contract**:

- `Alert({ tone: "danger" | "success" | "info"; title?: string; children })`.
- `danger` is `role="alert"` on `danger-surface`/`danger`.
- `success` is `role="status"` on `success-surface`/`success`.
- `info` is `role="status"` on `surface-tint`/`fg`.

#### 8. Toast layer

**Files**: `src/components/toaster/toaster.tsx`, `src/app/layout.tsx`, `package.json`

**Intent**: One app-wide, token-styled toast mechanism, so no slice builds its own.

**Contract**:

- Add `sonner` (^2.0.8) with `pnpm add sonner`.
- `toaster.tsx` is `"use client"`. It exports:
  - `Toaster()`, which renders Sonner's `<Toaster position="bottom-center" closeButton toastOptions={{ unstyled: true, classNames: {…} }}>` with classes built only from tokens (surface, hairline ring, `shadow`, `rounded-card`, `text-small`);
  - `notify`, an object `{ success(title, description?), error(title, description?) }` wrapping Sonner's `toast`. It keeps Sonner out of feature code.
- Mount `<Toaster />` once in the root layout, after `{children}`.

#### 9. Barrel

**File**: `src/components/index.ts`

**Intent**: A single import surface, per the CLAUDE.md barrel convention.

**Contract**: Re-exports `Heading`, `Text`, `Button`, `Link`, `TextField`, `StatusBadge`, `BadgeStatus` (type), `Alert`, `Toaster` and `notify`. It has no `"use client"` directive.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm typecheck`
- Production build succeeds: `pnpm build`
- Sonner resolves as a direct dependency: `pnpm why sonner` shows `sonner 2.x`
- The barrel is not a client module: `grep -c '"use client"' src/components/index.ts` prints `0`
- Only the toaster is a client module: `grep -rl '"use client"' src/components` lists only `toaster/toaster.tsx`

#### Manual Verification:

- `/`, `/login` and `/signup` render as they did after Phase 1. The mounted Toaster adds no visible element and no console errors.

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 3: Design-system showcase route

### Overview

A dev-only `/design-system` page that renders every token and primitive state. It is the manual review surface for this change and the visual reference later slices' agents read.

### Changes Required:

#### 1. Showcase page

**File**: `src/app/design-system/page.tsx`

**Intent**: Render the whole system in one place so it can be checked against `palette-proof.html` and later slices can see what exists.

**Contract**:

- The page is a Server Component that calls `notFound()` when `process.env.NODE_ENV === "production"`.
- Sections, in order:
  - colour swatches for every token (name, hex, role). Write each swatch class out literally (`bg-canvas`, …) and never build it as `` `bg-${name}` ``, because Tailwind only generates classes it finds literally in source;
  - the type scale;
  - Button (primary, secondary, disabled, pending);
  - Link;
  - TextField (default, with hint, with error). The controlled-value sample is the client child in §2, because a `value` without `onChange` in this Server Component makes a read-only field and a React console warning;
  - StatusBadge (all four);
  - Alert (all three tones);
  - a toast demo;
  - one `bg-transparent` sample, confirming the keyword survives the reset.
- Built only from primitives and tokens.

#### 2. Toast demo

**Files**: `src/app/design-system/components/toast-demo/toast-demo.tsx`, `src/app/design-system/components/controlled-field-demo/controlled-field-demo.tsx`, `src/app/design-system/components/index.ts`

**Intent**: The only interactive part of the showcase, isolated as a client child component per the structure convention.

**Contract**: The `"use client"` component `ToastDemo` renders two Buttons that call `notify.success("You claimed this gift", …)` and `notify.error("Someone else just claimed this", …)`. Copy comes from the palette proof. A sibling `"use client"` `ControlledFieldDemo` holds a `useState` value wired to a `TextField` through `value`/`onChange`, the same pattern as the F-01 forms. The barrel re-exports both.

#### 3. Allowlist the route

**File**: `src/lib/auth/routes.ts`

**Intent**: Let signed-out developers and agents open the showcase in dev. Production 404s on its own, so nothing is exposed.

**Contract**: Add `"/design-system"` to `PUBLIC_EXACT_PATHS` with a comment saying it is dev-only and the page 404s in production. This is an exact match, not a prefix. Per the file header, this is a security-relevant edit, so call it out in the PR.

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm typecheck`
- Production build succeeds: `pnpm build`
- In dev, signed out, the showcase serves: with `pnpm dev` running, `curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/design-system` prints `200`, not a `307` to `/login`
- In production it 404s: after `pnpm build && pnpm start`, the same curl prints `404`

#### Manual Verification:

- Swatches, badges, buttons and alerts match `palette-proof.html` rev 2 side by side
- Headings show Fraunces with `SOFT` 100. If the variation companion didn't apply, use the base-layer fallback from Phase 1.
- Both toast buttons show a token-styled toast, and a screen reader (VoiceOver) announces it
- Tabbing through the page shows a visible accent focus ring on every Button, Link and TextField
- With "reduce motion" on, the pending spinner is static
- At 375px width nothing overflows horizontally

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Phase 4: Move current screens onto the design system

### Overview

Rebuild every existing screen with the primitives, so the auth flow, header and home page are the first real consumers and no hand-rolled styling is left in `src/app`.

### Changes Required:

#### 1. Auth forms

**Files**: `src/app/(auth)/login/components/sign-in-form/sign-in-form.tsx`, `src/app/(auth)/signup/components/sign-up-form/sign-up-form.tsx`

**Intent**: Replace the duplicated field and button markup with primitives. Behaviour stays exactly the same.

**Contract**:

- Each label/input/error block becomes a `TextField`, keeping `id`, `name`, `type`, `autoComplete`, `required`, the controlled `value`/`onChange` pair and the error from `errors?.<field>[0]`.
- The form-level `message` becomes `<Alert tone="danger">`.
- The submit button becomes `<Button type="submit" variant="primary" pending={pending} pendingLabel="Signing in…">` (or "Creating account…").
- **Keep** the "CONTROLLED ON PURPOSE" and "TYPE-ONLY on purpose" comments, and the hidden `next` input.

#### 2. Auth pages

**Files**: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`

**Intent**: Give the pages a real composition using the primitives.

**Contract**:

- The `h1` becomes `Heading level={1}`.
- The failed-confirmation paragraph becomes `<Alert tone="danger">`.
- The switch-page line uses `Text` and `Link`.
- Content sits on a `bg-surface rounded-card` panel on the canvas.
- Remove the now-obsolete "Markup is deliberately plain: F-03 owns the visual layer" comment. Keep the `searchParams` comments.

#### 3. Header and auth status

**Files**: `src/app/layout.tsx`, `src/app/components/auth-status/auth-status.tsx`

**Intent**: Style the global header with tokens and primitives.

**Contract**:

- The header gets `bg-surface border-b border-hairline`, plus a "Gift I Need" wordmark in `font-display` linking to `/`.
- Signed out, AuthStatus renders two `Link`s. Signed in, it renders the email as `Text variant="small" tone="muted"` and a `Button variant="secondary" type="submit"` inside the existing Server Action form.
- AuthStatus stays a Server Component, and its COST and NOTE comments stay.

#### 4. Home page

**File**: `src/app/page.tsx`

**Intent**: Replace the scaffold layout with a token-based welcome.

**Contract**: A `Heading level={1} size="display"` "Gift I Need" and one `Text` line, "Share one link, get gifts you actually want.", on the canvas. No new functionality and no links beyond what the header provides.

#### 5. Lock in the Link primitive

**Files**: `eslint.config.mjs`, `CLAUDE.md`

**Intent**: The class-based drift guard can't see a raw `next/link`, and auto-import will keep offering it to later slices, which would bypass the styled wrapper. This lands in Phase 4 rather than Phase 1 because the auth pages and AuthStatus import `next/link` until §2–§3 migrate them.

**Contract**:

- Add `no-restricted-imports` with `paths: [{ name: "next/link", message: … }]`, pointing to `Link` from `@/components`, plus an override entry for `src/components/link/**` that turns the rule off. The plan review verified this shape in ESLint 9 flat config.
- Add one bullet to the CLAUDE.md "Design system" section: use `Link` from `@/components`, never `next/link` directly (lint-enforced).

### Success Criteria:

#### Automated Verification:

- Lint passes: `pnpm lint`
- Type checking passes: `pnpm typecheck`
- Production build succeeds: `pnpm build`
- No hand-rolled form markup or direct `next/link` import is left: `grep -rnE '<button|<label|role="alert"' src/app` returns nothing, and `grep -rln 'from "next/link"' src` lists only `src/components/link/link.tsx`

#### Manual Verification:

- Sign-up with a too-short password shows the field error under the password field, and the typed email is **still in the field** (the controlled-form regression check)
- Sign-in with wrong credentials shows the danger Alert, and the button shows "Signing in…" while pending
- `/login?error=confirmation_failed` shows the danger Alert
- Sign-out from the header works and returns to the signed-out header
- `/login?next=/somewhere`: after sign-in the user lands on `/somewhere`, so the `next` threading still works
- Keyboard-only: every field, button and link is reachable with a visible focus ring
- At 375px width the auth pages and header have no horizontal scroll

**Implementation Note**: After completing this phase and all automated verification passes, pause here for manual confirmation from the human that the manual testing was successful before proceeding to the next phase.

---

## Testing Strategy

### Unit Tests (deferred to F-02's runner, targets defined here):

- **TextField:** `aria-invalid` and `aria-describedby` reflect whichever of hint and error are present, and the ids follow `${id}-error` / `${id}-hint`.
- **StatusBadge:** each status renders its default label, and a `children` override replaces only the text.
- **Button:** `pending` sets `disabled` and `aria-busy` and swaps in `pendingLabel`.
- **Alert:** `danger` uses `role="alert"`, and `success`/`info` use `role="status"`.

### Integration Tests:

- None in this change. The Phase 4 manual steps cover the F-01 flows end to end.

### Manual Testing Steps:

1. Open `/design-system` in dev and compare it against `context/changes/design-system-baseline/palette-proof.html`.
2. Run the Phase 4 auth regression steps, especially the input-preserved-on-error check.
3. Switch the OS to dark mode and confirm the app stays light.
4. Tab through `/design-system` and `/login` and confirm the focus rings.
5. Resize to 375px and check `/`, `/login`, `/signup` and `/design-system`.

## Performance Considerations

- **Fraunces with `SOFT` and `opsz`** adds one variable-font download to every route, on top of Geist. Keep `subsets: ["latin"]` and next/font's default `display: swap`. If first-paint weight matters later, trim the axes to `["SOFT"]` only.
- **Sonner** adds a few KB of client JS to the root layout on every route. That's accepted because every slice needs toasts.
- **The root layout is already dynamic** (the AuthStatus note in `layout.tsx`), so the fonts and Toaster don't change the rendering mode.

## Migration Notes

There are no data changes. Everything happens on the single branch `GIN-17-design-system-baseline`. Phase 1's reset and swap must stay one commit (see Critical Implementation Details). S-01–S-05 are not yet built, so no in-flight slice work needs rebasing onto the tokens.

## References

- Approved palette proof (rev 2): `context/changes/design-system-baseline/palette-proof.html`
- Roadmap item: `context/foundation/roadmap.md` (F-03), GitHub issue #17
- PRD: FR-007, FR-009, NFR (claim confirmation) in `context/foundation/prd.md`
- F-01 plan (deferral of styling to F-03): `context/changes/email-password-auth/plan.md:27,59,191`
- Next 16 CSS and font docs: `node_modules/next/dist/docs/01-app/01-getting-started/11-css.md`, `13-fonts.md`, `03-api-reference/02-components/font.md:160`
- Tailwind default theme: `node_modules/tailwindcss/theme.css`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Token layer, fonts, and drift guard

#### Automated

- [ ] 1.1 Lint passes: `pnpm lint`
- [ ] 1.2 Type checking passes: `pnpm typecheck`
- [ ] 1.3 Production build succeeds: `pnpm build`
- [ ] 1.4 Drift-guard probe fails lint for palette, font-size (incl. responsive), and `dark:` classes
- [ ] 1.5 No off-system classes remain in `src`

#### Manual

- [ ] 1.6 Auth pages unchanged apart from colours/fonts; errors in danger colour
- [ ] 1.7 Home page on canvas; Fraunces font loads
- [ ] 1.8 App stays light under OS dark mode
- [ ] 1.9 Body text renders in Geist, not Arial

### Phase 2: Primitives and toast layer

#### Automated

- [ ] 2.1 Lint passes: `pnpm lint`
- [ ] 2.2 Type checking passes: `pnpm typecheck`
- [ ] 2.3 Production build succeeds: `pnpm build`
- [ ] 2.4 Sonner 2.x is a direct dependency
- [ ] 2.5 Components barrel has no `"use client"`
- [ ] 2.6 Only `toaster.tsx` is a client module in `src/components`

#### Manual

- [ ] 2.7 Existing pages unchanged; mounted Toaster adds no visible element or console error

### Phase 3: Design-system showcase route

#### Automated

- [ ] 3.1 Lint passes: `pnpm lint`
- [ ] 3.2 Type checking passes: `pnpm typecheck`
- [ ] 3.3 Production build succeeds: `pnpm build`
- [ ] 3.4 `/design-system` returns 200 signed-out in dev
- [ ] 3.5 `/design-system` returns 404 in production build

#### Manual

- [ ] 3.6 Showcase matches `palette-proof.html` rev 2
- [ ] 3.7 Headings show Fraunces SOFT 100
- [ ] 3.8 Toasts render token-styled and are announced
- [ ] 3.9 Visible focus ring on every interactive primitive
- [ ] 3.10 Pending spinner static under reduced motion
- [ ] 3.11 No horizontal overflow at 375px

### Phase 4: Move current screens onto the design system

#### Automated

- [ ] 4.1 Lint passes: `pnpm lint`
- [ ] 4.2 Type checking passes: `pnpm typecheck`
- [ ] 4.3 Production build succeeds: `pnpm build`
- [ ] 4.4 No hand-rolled form markup or direct `next/link` import left

#### Manual

- [ ] 4.5 Sign-up validation error keeps typed email in the field
- [ ] 4.6 Sign-in error shows danger Alert; button shows pending label
- [ ] 4.7 Confirmation-failed Alert renders on `/login?error=confirmation_failed`
- [ ] 4.8 Sign-out from header works
- [ ] 4.9 `next` return path still honoured after sign-in
- [ ] 4.10 Keyboard-only navigation with visible focus rings
- [ ] 4.11 No horizontal scroll at 375px on auth pages and header
