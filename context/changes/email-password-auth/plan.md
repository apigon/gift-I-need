# Email/Password Authentication (F-01) Implementation Plan

## Overview

Build the user-facing email/password authentication surface — sign-up, sign-in, sign-out — on top of the Supabase SSR scaffold that already exists in this repo, plus allowlist-based route protection with a safe `returnTo` redirect and a built-but-disabled email-confirmation path.

This is roadmap item **F-01**, a bounded foundation. Its justification is downstream: S-01 (create event), S-03 (claim item — the north star), S-04 (edit items), and S-05 (post-event reveal) are all authenticated writes and cannot start without a session the app can obtain and display. It deliberately does not build a dashboard, OAuth, or password reset.

## Current State Analysis

The session plumbing is done. The user-facing surface is entirely absent.

**What exists:**

- `src/utils/supabase/server.ts` — per-request server client (anon key + cookie session, so RLS applies with `auth.uid()`). Correctly created inside each call, never a module global, because Workers cannot reuse a connection across requests.
- `src/utils/supabase/client.ts` — browser client for Client Components.
- `src/utils/supabase/proxy.ts` — `updateSession()`, which refreshes the auth token and writes rotated cookies onto the response. It **already calls `getUser()` on every matched request** (`proxy.ts:37`).
- `src/middleware.ts` — invokes `updateSession` with a matcher covering every path except `_next/static`, `_next/image`, `favicon.ico`, and common image extensions. Uses the *deprecated* `middleware.ts` convention on purpose: `@opennextjs/cloudflare` 1.20.1 rejects Next 16's Node-runtime `proxy.ts` middleware entry, and the deprecated convention is the only one that emits an *Edge* entry the adapter accepts (`src/middleware.ts:4-12`, upstream `opennextjs-cloudflare#962`).
- `src/app/api/health/route.ts` — smoke endpoint proving the cookie/session path round-trips under `workerd`.

**What is missing:**

- No auth routes, no route group, no Server Actions, no forms, no header, no sign-out affordance.
- No validation library (`package.json` has no zod/yup) and no `typecheck` script — `pnpm lint` and `pnpm build` are the only checks wired.
- No test runner. Roadmap **F-02** owns introducing one; F-01 must not pre-empt that choice because the two changes are declared parallel.
- No route protection. `proxy.ts:36` records this explicitly: "No route-protection redirects yet: the scaffold has no protected routes, and auth is enforced at the data layer via RLS."
- No design tokens. `src/app/globals.css` holds only the stock Next scaffold variables; roadmap **F-03** adds the real token layer in parallel, so auth UI built here will be restyled later.

**Constraints discovered:**

- Deploy target is **Cloudflare Workers via OpenNext**, not Vercel — `wrangler.jsonc` and `open-next.config.ts` are authoritative. Middleware therefore runs on the **Edge runtime**. (`context/foundation/tech-stack.md` said `deployment_target: vercel` at planning time; corrected 2026-09-08 along with its stale `ci_provider: github-actions`.)
- `supabase/config.toml` sets `enable_confirmations = false` and `minimum_password_length = 6` — but that file configures the *local* stack only. The hosted project's dashboard settings are separate and must be aligned by hand.
- Hosted Supabase's built-in SMTP is rate-limited to ~2 emails/hour (`[auth.rate_limit] email_sent = 2`), which is why confirmations stay off for v1.
- `context/foundation/infrastructure.md:92` risk register: *"smoke-test auth/session on a deployed preview, not just local"* — this plan treats that as a hard verification requirement, not a nice-to-have.

### Key Discoveries:

- `src/utils/supabase/proxy.ts:37` already performs `getUser()` on every matched request, so route-protection redirects cost **zero additional round trips** — the user object is in hand at exactly the point the decision must be made. Protection belongs inside `updateSession`, not in a second middleware pass.
- `src/middleware.ts:26` already matches all non-asset paths, so the public/protected policy is a pathname check in code, **not** a matcher change. The matcher stays untouched.
- `src/utils/supabase/proxy.ts:39-41` warns that building a new response loses the refreshed cookies. A redirect response is a new response — this is the single most likely way to break sessions in this change.
- Next.js 16 `redirect()` throws `NEXT_REDIRECT` and must be called **outside** `try/catch` (`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md:50-52`).
- The bundled Next 16 auth guide prescribes exactly the chosen stack: `<form action={...}>` + Server Actions + `useActionState` + zod, with a `FormState` union carrying field-level errors (`node_modules/next/dist/docs/01-app/02-guides/authentication.md:33-130`).

## Desired End State

A visitor can create an account with email and password, is signed in immediately (no confirmation email), sees their email and a working sign-out button in the app header, and stays signed in across page refreshes and a real Cloudflare Workers deploy. An unauthenticated request to any path outside the public allowlist lands on `/login?next=<original-path>` and, after signing in, arrives at the path they originally requested. A `/auth/confirm` route handler exists and is correct, but is dormant because confirmations are disabled.

Verified by: `pnpm lint`, `pnpm typecheck`, `pnpm build` all clean, plus the manual script in "Testing Strategy" run against both `pnpm dev` and `pnpm preview` (Workers).

## What We're NOT Doing

- **OAuth / social login** — PRD Non-Goals; v2.
- **Password reset / forgot-password** — not in FR-001 or FR-002, and it drags in the SMTP problem confirmations were disabled to avoid. Consequence accepted: a forgotten password means a dead account in v1.
- **Email confirmation as an active flow** — the route handler ships, the feature stays off.
- **A dashboard of events organized/attended** — FR-014, parked in the roadmap.
- **Email change, account deletion, profile fields** — no FR covers them.
- **A `profiles` table or any schema work** — F-02 (`surprise-rule-data-contract`) owns all schema. This change touches only `auth.users`, which Supabase manages.
- **Introducing a test runner** — F-02 owns that choice; see Phase 1 for how this plan stays testable anyway.
- **Design tokens or a component library** — F-03 owns the visual layer. Auth UI here is deliberately plain.
- **Rate limiting or CAPTCHA on the auth forms** — Supabase's built-in per-IP limits (`sign_in_sign_ups = 30` per 5 min) are accepted as sufficient for v1.

## Implementation Approach

Build inward-out: pure, dependency-free primitives first (Phase 1), then the flows that use them (Phases 2–3), then the middleware policy that depends on those flows existing (Phase 4), then the deferred confirmation path and the deploy-level verification (Phase 5).

Three decisions shape the file layout:

1. **Validation and error shape are a shared contract, not local detail.** `FormState` defined in Phase 1 is what S-01's event form and S-04's item form will reuse. It lives in `src/lib/auth/` for now; when a second feature needs it, it moves to `src/lib/forms/`.
2. **Route protection is allowlist-based** — everything is protected unless explicitly public. This fails closed, which is the right default for a product whose whole point is a visibility guarantee. The cost is that FR-007's unauthenticated shared-list route must be public *before* S-02 ships, and that route does not exist yet. Handled by putting the allowlist in one named module with a forward-declared `/lists` prefix, so S-01 either adopts that URL shape or changes one line.
3. **The middleware is the only enforcement point for page access**, per the chosen approach — but it is not the only enforcement point for *data*. RLS (F-02) remains the real guarantee for writes. The middleware is a UX layer that also happens to fail closed.

4. **File layout follows `CLAUDE.md` §Code structure convention.** Components live in their own directory beside the parent that uses them, each exposing an `index.ts` barrel; `src/components/` is reserved for components with more than one consumer, and nothing in this change qualifies. Unit tests co-locate with their subject. This change is the first to exercise those rules, so the layout it establishes is the one S-01, S-03 and S-04 will copy — which is the main reason to get it right here rather than tidy it later.

   The one deliberate exception is `src/app/actions/auth.ts`. Server Actions are grouped by technical role rather than by feature, which sits against "feature based as much as possible"; kept because `signOut` is consumed by the header outside the `(auth)` group, and because the Next-conventional location is the one a reader will look in first. Revisit if the directory grows past a handful of files.

## Critical Implementation Details

**Cookie preservation on redirect.** `updateSession` returns `supabaseResponse` specifically so the rotated auth cookies survive (`src/utils/supabase/proxy.ts:39-41`). A redirect built with `NextResponse.redirect(url)` is a *new* response and silently drops them, which logs the user out on the very request that was supposed to send them to login — and, worse, can leave a half-rotated refresh token. When Phase 4 redirects, it must copy `supabaseResponse.cookies.getAll()` onto the redirect response before returning it.

**Ordering inside `updateSession`.** `proxy.ts:33-36` warns that no code may run between `createServerClient` and `getUser()`. The public/protected check reads `user`, so it necessarily goes *after* the `getUser()` call — this is both required by the warning and the only place the answer is available.

**Sign-up error specificity is coupled to confirmations being off.** With `enable_confirmations = false`, `supabase.auth.signUp()` for an already-registered email returns an explicit `User already registered` error, which is what makes the chosen "specific sign-up error" copy possible. With confirmations *on*, Supabase deliberately obfuscates this (returning a fake user object) to prevent enumeration. So the Phase 5 confirm route must carry a comment: whoever enables confirmations in v2 must simultaneously revert the sign-up error copy to generic, or the flow will silently claim success for an email that already exists.

**Edge-runtime purity.** `src/lib/auth/routes.ts` and `src/lib/auth/redirect.ts` are imported by middleware, which runs on the Edge runtime under OpenNext. They must stay pure TypeScript with no Node built-ins, no `next/headers`, and no Supabase imports. `src/lib/auth/schemas.ts` may import zod (server/client only) but must not be imported *into* the middleware path.

This is why `src/lib/auth/` gets **no** `index.ts`. The barrel rule in `CLAUDE.md` applies to *component* directories only, and extending it here would be actively harmful: a barrel that re-exports `schemas.ts` alongside `routes.ts` means middleware importing `isPublicRoute` through it drags zod into the Edge bundle. Middleware must import from the exact module path.

**Signed-out 404s become login redirects.** Under an allowlist policy, an unauthenticated request to a nonexistent path (`/typo`) matches nothing public and is redirected to `/login?next=/typo` instead of rendering a 404. Signing in then produces the 404. This is the accepted cost of failing closed; it is not a bug, and Phase 4's manual verification uses it as the test path since no protected route exists yet.

**Every route becomes dynamic.** Rendering the auth header in `src/app/layout.tsx` calls `cookies()` via `getUser()`, opting the whole app out of static rendering. This is acceptable here: `wrangler.jsonc:11-19` documents that R2 incremental caching is deliberately deferred and no route uses `revalidate`/ISR, so there is no static output to lose. Revisit if a marketing page is ever added.

---

## Phase 1: Auth primitives & validation contract

### Overview

Add the dependency-free building blocks and the missing typecheck script. No UI, no behavior change — the app renders identically after this phase. Everything here is a pure function, which is what keeps the change verifiable without a test runner: F-02 can unit-test these modules later without any refactor.

### Changes Required:

#### 1. Tooling

**File**: `package.json`

**Intent**: Add zod (the validation library the Next 16 auth guide prescribes) and a `typecheck` script, which does not currently exist — `pnpm lint` and `pnpm build` are the only checks available today.

**Contract**: New dependency `zod` (v4 — the guide's `z.email()` top-level API is v4-only). New script `"typecheck": "tsc --noEmit"`. Install with pnpm only.

#### 2. Form schemas and shared error shape

**File**: `src/lib/auth/schemas.ts`

**Intent**: Define the sign-up and sign-in schemas and the `FormState` type that Server Actions return to `useActionState`. This is the error-shape contract that S-01 and S-04 forms will copy, so field names and the pending/error discrimination matter beyond this change.

**Contract**: Exports `SignUpSchema` and `SignInSchema` (email: valid email, trimmed; password: min 8 characters) and a `FormState` type — a union of an idle/initial state and a state carrying `errors?: { email?: string[]; password?: string[] }` plus a form-level `message?: string`. Sign-in validates shape only (never password strength — an existing weak password must still be able to sign in).

#### 3. Return-path validator

**File**: `src/lib/auth/redirect.ts`

**Intent**: Turn an untrusted `next` query parameter into a safe same-origin path. This is the security-relevant piece of the change: without it, `/login?next=https://evil.example` is an open redirect on the sign-in flow.

**Contract**: Exports `safeReturnTo(next: string | null | undefined): string`. Accepts only strings beginning with a single `/`; rejects protocol-relative (`//host`), backslash-prefixed (`/\host`), and absolute URLs; returns a `DEFAULT_REDIRECT` constant (`/`) on any rejection. Pure, no imports — it runs on the Edge runtime.

#### 4. Public route allowlist

**File**: `src/lib/auth/routes.ts`

**Intent**: Name, in one place, every path an unauthenticated visitor may reach. Everything else is protected. The `/lists` entry is a forward declaration for S-02's shared-list route (FR-007), which does not exist yet.

**Contract**: Exports `isPublicRoute(pathname: string): boolean`. Public: `/` exactly; `/login`; `/signup`; anything under `/auth/`; `/api/health`; anything under `/lists/` (forward-declared — S-01 must adopt this prefix or update this file). Pure, no imports. Include a comment stating that adding a route here widens unauthenticated access and is a security-relevant edit.

Include a second comment recording the class of path this file does *not* yet cover: well-known files served from the app root — `/robots.txt`, `/sitemap.xml`, `/manifest.webmanifest`, `/opengraph-image` — are not excluded by the `src/middleware.ts:26` matcher, so whoever adds one must allowlist it here or it will 307 signed-out visitors (and crawlers) to `/login`.

### Success Criteria:

#### Automated Verification:

- Dependencies install cleanly: `pnpm install`
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- The allowlist in `src/lib/auth/routes.ts` is reviewed and agreed to cover FR-007's future shared-list route before any protection is switched on in Phase 4.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 2: Sign-up and sign-in

### Overview

The two credential flows end to end: Server Actions calling Supabase, route-group pages, and client forms wired through `useActionState`. After this phase a user can create an account and sign in, though there is not yet any visible indication they are signed in — that arrives in Phase 3.

### Prerequisites (do these first — they are not post-change cleanup):

`pnpm dev` loads `.env`, which points at the **hosted** Supabase project (`.env.example:8-16`); only `pnpm dev:local` uses the local stack. Every manual verification below therefore runs against hosted settings, and hosted Supabase ships with email confirmations **on** by default. Until these two dashboard changes are made, criteria 2.4 and 2.5 fail for configuration reasons that look exactly like code bugs — sign-up returns a user with no session, and duplicate sign-up is obfuscated into a fake success instead of `User already registered`.

1. **Auth → Providers → Email**: confirm "Confirm email" is **disabled**, matching `enable_confirmations = false`.
2. **Auth → Policies**: set the minimum password length to **8**, matching the zod schema and the `config.toml` edit in item 4 below.

Verify before writing any form: sign up on the hosted project (dashboard or `curl`) and confirm a session is returned rather than a pending-confirmation user.

### Changes Required:

#### 1. Auth Server Actions

**File**: `src/app/actions/auth.ts`

**Intent**: Server-side `signUp` and `signIn` actions that validate with the Phase 1 schemas, call the Supabase server client, map errors to the agreed copy policy, and redirect on success.

**Contract**: `"use server"` module exporting `signUp(prevState: FormState, formData: FormData): Promise<FormState>` and `signIn(prevState: FormState, formData: FormData): Promise<FormState>` — the `useActionState` signature. Both read an optional `next` field from the FormData and pass it through `safeReturnTo` for the success redirect. Uses `createClient()` from `@/utils/supabase/server`.

Error copy policy, per the planning decision:
- Sign-in failure → always the generic `"Invalid email or password."` regardless of which part was wrong.
- Sign-up with an existing email → specific: says the email is already registered and points at sign-in.
- Any other Supabase error → a generic form-level message; do not surface raw Supabase error strings, which are not user-facing copy.

`redirect()` must be called outside any `try/catch` — it throws `NEXT_REDIRECT` and a catch block will swallow it.

#### 2. Auth pages

**File**: `src/app/(auth)/login/page.tsx`, `src/app/(auth)/signup/page.tsx`

**Intent**: Server Components that render the corresponding form and thread the `next` search param into it. The `(auth)` route group keeps these grouped without affecting the URLs (`/login`, `/signup`).

**Contract**: Each page reads `searchParams` (async in Next 16 — it is a Promise that must be awaited) and passes `next` down to the form component as a prop. Each links to the other page. Markup stays deliberately plain — F-03 owns styling.

#### 3. Form components

**Files**:

```
src/app/(auth)/login/components/sign-in-form/
├── sign-in-form.tsx
└── index.ts
src/app/(auth)/signup/components/sign-up-form/
├── sign-up-form.tsx
└── index.ts
```

Each form has exactly one consumer — the sibling `page.tsx` — so it is a *child* component under `CLAUDE.md` §Code structure convention and nests beside its parent. `src/components/` is reserved for genuinely shared components; neither form qualifies, and putting them there now would set the wrong template for S-01's event form and S-04's item form, which will be copied from these.

**Intent**: Client Components binding the actions via `useActionState`, rendering field-level errors from `FormState`, and disabling the submit button while pending.

**Contract**: `"use client"`; `useActionState` imported from `react` (React 19, not `react-dom`). Each accepts a `next?: string` prop and renders it as a hidden input so the action can read it from FormData. Inputs use `name="email"` / `name="password"` matching the schema keys, with `type="email"` / `type="password"` and labels bound via `htmlFor`. Pending state comes from the third element of the `useActionState` tuple.

Each `index.ts` re-exports every component in its directory (`export { SignInForm } from "./sign-in-form";`), and the page imports through the directory, not the file — `import { SignInForm } from "./components/sign-in-form"`.

#### 4. Local password policy alignment

**File**: `supabase/config.toml`

**Intent**: The zod schema requires 8 characters but the local Supabase stack accepts 6, so a password rejected by the app would be accepted by a direct API call — a silent divergence between the two validation layers.

**Contract**: Set `minimum_password_length = 8` under `[auth]`. Note in the phase commit that the **hosted** project's dashboard setting must be changed to match by hand; `config.toml` governs the local stack only.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- Signing up with a new email at `/signup` creates an account and redirects, with no confirmation email required.
- Signing up again with that same email shows the specific "already registered" message and a link to sign in.
- Signing in at `/login` with the correct password redirects; with a wrong password it shows the generic "Invalid email or password."
- Submitting an invalid email or a 7-character password shows field-level errors without a network round trip to Supabase.
- The submit button is disabled while the action is pending.
- Hosted dashboard prerequisites confirmed before the rest of this list: "Confirm email" disabled and minimum password length 8, verified by a hosted sign-up returning a session rather than a pending-confirmation user.
- Layout conforms to `CLAUDE.md` §Code structure convention: each form lives in its page's `components/<name>/` directory with an `index.ts` barrel, pages import through the directory, and `src/components/` is still empty.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 3: Auth header and sign-out

### Overview

Make the session visible and terminable. This is the first phase where the whole loop can be exercised by a human without reading cookies in devtools, and it closes FR-002.

### Changes Required:

#### 1. Sign-out action

**File**: `src/app/actions/auth.ts`

**Intent**: Add a `signOut` Server Action so the session is cleared server-side, in the same place middleware reads it — avoiding the client/server cookie desync that the `proxy.ts` comments warn about.

**Contract**: Exports `signOut(): Promise<void>`. Calls `supabase.auth.signOut()` on the server client, then `redirect("/")`. Takes no FormData — it is bound directly as a `<form action={signOut}>`.

#### 2. Auth status component

**Files**:

```
src/app/components/auth-status/
├── auth-status.tsx
└── index.ts
```

Its only consumer is `src/app/layout.tsx`, so under the child-component rule it nests beneath that parent's directory rather than going in `src/components/`. (`src/app/components/` is not a route — the App Router only treats `page.tsx`, `route.ts`, `layout.tsx` and friends as routable, so a plain directory here is inert.)

**Intent**: A Server Component that reads the current session and renders either the signed-in email plus a sign-out button, or links to sign in / sign up.

**Contract**: `async` Server Component calling `createClient()` then `auth.getUser()`. Signed in → renders the email and a `<form action={signOut}>` with a submit button. Signed out → renders `/login` and `/signup` links. No `"use client"` — the sign-out button is a plain form submit and needs no JavaScript. `index.ts` re-exports it; the layout imports `{ AuthStatus } from "./components/auth-status"`.

#### 3. Mount the header

**File**: `src/app/layout.tsx`

**Intent**: Render `AuthStatus` in the root layout so it appears on every page.

**Contract**: Add a `<header>` above `{children}` inside `<body>`. Note the consequence recorded in Critical Implementation Details: this makes every route dynamically rendered.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- After signing in, the header shows the signed-in email on the home page.
- Clicking sign out clears the session, returns to `/`, and the header reverts to the signed-out links.
- After signing out, a browser refresh and a direct URL entry both still show signed-out state — the session is genuinely gone, not just visually reset.
- The sign-out button works with JavaScript disabled in the browser.
- `auth-status` sits in `src/app/components/auth-status/` with an `index.ts`, the layout imports through that barrel, and adding the directory created no new route.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 4: Allowlist route protection with returnTo

### Overview

Switch on the fail-closed policy: every path not named in `isPublicRoute` redirects unauthenticated visitors to `/login?next=…`, and signing in returns them where they were headed. This is the phase with the highest chance of breaking sessions, because it introduces the first redirect response inside `updateSession`.

### Changes Required:

#### 1. Protection in the session proxy

**File**: `src/utils/supabase/proxy.ts`

**Intent**: After the existing `getUser()` call, redirect unauthenticated requests for non-public paths to the login page with the original path preserved. Replaces the "No route-protection redirects yet" note at `proxy.ts:36` with a description of the actual policy.

**Contract**: Capture the result of `supabase.auth.getUser()` (currently discarded). If there is no user and `!isPublicRoute(request.nextUrl.pathname)`, build a redirect to `/login` with `next` set to the requested `pathname + search`, **copy every cookie from `supabaseResponse` onto the redirect response**, and return it. Otherwise return `supabaseResponse` unchanged. The check goes strictly after `getUser()`, never between it and `createServerClient`.

**Exception for non-page requests.** A redirect is the right answer for a browser navigation and the wrong answer for anything else. Before the redirect branch, return a `401` JSON body (with the same cookie copy) when `request.nextUrl.pathname` starts with `/api/`. `CLAUDE.md` reserves `app/api/` for webhooks and external clients, and those callers cannot follow a redirect to a login page — worse, `NextResponse.redirect` defaults to **307**, which preserves the method, so a webhook POST would be replayed against `/login`. The same 307-replay applies to a Server Action POST submitted after the session expired on a protected page.

This is the one place in the change where a code snippet is warranted, because the cookie-copy step is the non-obvious part and omitting it fails silently:

```ts
if (!user && !isPublicRoute(request.nextUrl.pathname)) {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search);

  const redirectResponse = NextResponse.redirect(url);
  // MUST copy the rotated auth cookies: NextResponse.redirect builds a NEW
  // response and would otherwise drop them mid-rotation.
  supabaseResponse.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}
```

#### 2. Consume the return path — verification only, no code change expected

**File**: `src/app/actions/auth.ts`

**Intent**: The `next` plumbing was already built in Phase 2 (item 1); this phase is the first to produce a `next` value, so this step exists to exercise that wiring end to end, not to add it.

**Contract**: Read `signIn` and `signUp` and confirm the success redirect target is `safeReturnTo(formData.get("next"))` as Phase 2 specified. If it is, there is nothing to edit here and criterion 4.4 is the real check. If it is a hardcoded path, Phase 2 was implemented against its own contract — fix it now.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`

#### Manual Verification:

- Signed out, requesting a non-public path (e.g. `/anything`) redirects to `/login?next=/anything`; signing in then lands on `/anything` (which 404s, since no protected route exists yet — that is the expected result).
- Signed out, `/`, `/login`, `/signup`, and `/api/health` all load without a redirect.
- `/login?next=https://example.com` and `/login?next=//example.com` both redirect to `/` after sign-in, never off-site.
- Signing in, then navigating between pages repeatedly, keeps the session alive — no random sign-outs, which would indicate the cookie copy is wrong.
- `/api/health` still returns `{"ok":true,...}` with `authenticated` correctly reflecting the session in both states.
- Signed out, a request to a non-allowlisted `/api/` path returns `401` JSON rather than a 307 to `/login`.

**Implementation Note**: After completing this phase and all automated verification passes, pause for manual confirmation before proceeding.

---

## Phase 5: Confirmation path and Workers verification

### Overview

Ship the dormant email-confirmation route so enabling confirmations in v2 is a configuration change rather than a code change, then verify the entire change on a real Cloudflare Workers deploy. The infra risk register calls for exactly this: auth and session must be smoke-tested on a deployed preview, not only locally (`context/foundation/infrastructure.md:92`).

Note that `pnpm preview` is **not** a deployed preview — it runs `workerd` on localhost, so it cannot reproduce anything involving Cloudflare's edge cache. It is the fast pre-check; the deployed Cloudflare PR preview (auto-built by the Git integration, `context/foundation/roadmap.md:63`) is what actually satisfies the risk register. Both are required below.

### Changes Required:

#### 1. Confirmation route handler

**File**: `src/app/auth/confirm/route.ts`

**Intent**: Exchange the `token_hash` from a Supabase confirmation email for a session and redirect the user onward. Dormant while `enable_confirmations = false`, but correct and ready. This is one of the two legitimate uses of `app/api`-style HTTP surfaces in this change — Supabase's email links are external clients that need a real URL to hit.

**Contract**: `GET` handler reading `token_hash`, `type`, and `next` from the query string. Calls `supabase.auth.verifyOtp({ type, token_hash })`; on success redirects to `safeReturnTo(next)`, on failure redirects to `/login` with a generic error indication. Note the path is `/auth/confirm`, already covered by the `/auth/` public allowlist entry from Phase 1.

Carry a comment recording the coupling from Critical Implementation Details: **enabling confirmations requires simultaneously reverting the sign-up "already registered" message to generic copy**, because Supabase obfuscates existing-user signup once confirmations are on.

#### 2. Pass the redirect target on sign-up

**File**: `src/app/actions/auth.ts`

**Intent**: Set `emailRedirectTo` on `signUp` so that if confirmations are ever enabled, the emailed link points at `/auth/confirm` rather than the site root. Harmless while confirmations are off.

**Contract**: `signUp` passes `options.emailRedirectTo` = `${process.env.NEXT_PUBLIC_SITE_URL}/auth/confirm`, carrying the validated `next` through as a query param.

The origin comes from configuration, **not** from the request: a Server Action has no request object, and the alternative — reading the `Host` header via `await headers()` — would let the caller influence the origin of a link sent by email. Supabase's redirect allowlist limits the damage but does not remove the class of problem, and this is the one file in the change whose entire purpose is a security-relevant external link. Item 3 below adds the variable.

#### 3. Redirect URL configuration

**File**: `supabase/config.toml`, `.env.example`

**Intent**: Document what must be configured for the confirmation path to work when enabled, in both the local stack and the hosted project.

**Contract**: In `config.toml`, fix and extend `additional_redirect_urls` (currently `["https://127.0.0.1:3000"]` at `supabase/config.toml:163` — the scheme is wrong for a local dev server and the host does not match the `localhost` origin a browser actually uses). Supabase matches redirect URLs **exactly**, so this must list the real local origins including `/auth/confirm`. In `.env.example`, add `NEXT_PUBLIC_SITE_URL` (consumed by item 2) with its per-environment values documented alongside the existing env-file layout notes — `http://localhost:3000` for `pnpm dev` / `pnpm dev:local`, the deployment URL for preview, the production Workers origin for prod. Also add a comment block recording that the **hosted** Supabase project's Auth → URL Configuration must list the production Workers origin and the preview origins, and that this is a manual dashboard step no file in the repo can perform.

Note the gap this leaves: Cloudflare preview URLs are per-deployment, so a single static `NEXT_PUBLIC_SITE_URL` cannot be correct for every preview. Acceptable while confirmations are off (the variable is unused at runtime); whoever enables confirmations in v2 must either wire the preview URL per deployment or accept that confirmation links from a preview point at production.

### Success Criteria:

#### Automated Verification:

- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Production build succeeds: `pnpm build`
- Workers build and preview start cleanly: `pnpm preview`

#### Manual Verification:

- Against `pnpm preview` (Workers/`workerd`, not `pnpm dev`): sign up, sign in, header shows email, sign out — the full loop works.
- Against `pnpm preview`: the Phase 4 protection redirect and `returnTo` behave identically to local dev, confirming Edge-runtime middleware behaves the same under the OpenNext adapter.
- Against `pnpm preview`: the session survives a hard refresh and a direct URL entry — the specific failure mode the risk register flags for `workerd`.
- `/api/health` on the preview returns `authenticated: true` while signed in and `false` after sign out.
- With confirmations temporarily enabled on the local stack, a signup email's link lands on `/auth/confirm` and establishes a session — then confirmations are turned back off. (Verifies the dormant path is actually correct rather than assumed.) This one runs against the **local** stack, not the hosted project, and is the only step in the plan that does — concretely:
  1. `supabase start`
  2. set `enable_confirmations = true` in `supabase/config.toml`, then `supabase stop && supabase start` to apply it
  3. `pnpm dev:local` — **not** `pnpm dev`, which points at the hosted project (`.env.example:8-16`); hosted SMTP is capped at ~2 emails/hour, which is why this cannot be tested there
  4. sign up, then open the captured email in the local mail catcher at `http://localhost:54324`
  5. follow the link, confirm a session is established, then revert `enable_confirmations = false` and restart the stack
- Against the **deployed Cloudflare PR preview** (not `pnpm preview`): the full sign-up / sign-in / refresh / sign-out loop works, and the session survives a hard refresh. This is the check `context/foundation/infrastructure.md:92` actually demands.
- On the deployed preview, an authenticated page response carries `Cache-Control: private` (or `no-store`) and does not report a `cf-cache-status: HIT`. This is the only place the failure mode named at `src/utils/supabase/proxy.ts:4-8` — Cloudflare caching a `Set-Cookie` and signing users in as each other — can be observed at all; local `workerd` has no edge cache.

**Implementation Note**: This is the final phase. After manual verification passes, the change is ready for `/10x-implement`'s closing commit and `/10x-impl-review`.

---

## Testing Strategy

No test runner is introduced here — roadmap F-02 (`surprise-rule-data-contract`) owns that choice, and F-01 and F-02 are declared parallel, so both installing one would collide on `package.json` and config.

The compensating measure is structural: every piece of logic worth testing in this change is a **pure exported function** — `safeReturnTo` in `src/lib/auth/redirect.ts`, `isPublicRoute` in `src/lib/auth/routes.ts`, and the schemas in `src/lib/auth/schemas.ts`. When F-02 lands a runner, these can be unit-tested with no refactor. That is a deliberate design constraint on Phase 1, not an accident.

Location is fixed even though the runner isn't: `CLAUDE.md` §Code structure convention puts unit tests in the same directory as their subject, so F-02 should land `redirect.test.ts` beside `redirect.ts`, not in a `__tests__/` or top-level `tests/` tree. Recording it here so the two parallel changes don't disagree.

### Unit tests (deferred to F-02, targets defined here):

- `safeReturnTo`: rejects `https://evil.example`, `//evil.example`, `/\evil.example`, empty, and `null`; accepts `/`, `/lists/abc`, `/events/1?tab=x`.
- `isPublicRoute`: `/`, `/login`, `/signup`, `/auth/confirm`, `/api/health`, `/lists/abc` are public; `/events`, `/events/new`, `/anything` are not.
- `SignUpSchema` / `SignInSchema`: reject malformed emails; sign-up rejects passwords under 8 characters; sign-in does not apply a length rule.

### Manual testing steps:

1. `pnpm dev` → `/signup` with a fresh email → expect immediate sign-in and redirect, no confirmation email.
2. `/signup` again with the same email → expect the specific "already registered" message.
3. Sign out from the header → expect the signed-out links; refresh → still signed out.
4. `/login` with a wrong password → expect generic "Invalid email or password."
5. Signed out, visit `/anything` → expect `/login?next=/anything`; sign in → expect to land on `/anything`.
6. Signed out, visit `/`, `/login`, `/signup`, `/api/health` → expect no redirect on any of them.
7. `/login?next=https://example.com` → sign in → expect to land on `/`, never off-site.
8. Repeat steps 1–7 against `pnpm preview` (Workers runtime).
9. Disable JavaScript, sign out via the header form → expect it still works.

## Performance Considerations

The middleware already calls `getUser()` on every matched request (`src/utils/supabase/proxy.ts:37`), so route *protection* adds a pathname comparison and nothing else — no new network round trip. `isPublicRoute` and `safeReturnTo` are string operations.

The auth header does add one. `getUser()` is not a local cookie decode — it revalidates the JWT against Supabase's `/auth/v1/user` endpoint — so Phase 3's `auth-status.tsx`, mounted in the root layout, puts a **second** sequential auth-server round trip on the render path of every route. Accepted deliberately: `getUser()` is the only call Supabase guarantees is authenticated in a Server Component, and it is the pattern already established at `src/app/api/health/route.ts:11`. Correctness over a hop we have not yet measured. If page latency becomes a problem, the escape hatch is `getClaims()` (local verification against the project's JWT signing key), which trades this hop for a second auth-reading pattern — not worth introducing in the change whose purpose is establishing the first one.

The one real cost is the loss of static rendering, documented in Critical Implementation Details. It is acceptable because no route in this app is statically cached today: `wrangler.jsonc:11-19` records that R2 incremental caching is deliberately deferred and nothing uses `revalidate`/ISR.

## Migration Notes

No data migration. This change creates no tables and touches no schema — `auth.users` is managed by Supabase, and all application schema belongs to F-02.

Two manual configuration steps cannot be performed by repository files and must be done in the hosted Supabase dashboard — **these are prerequisites of Phase 2, not post-change cleanup**; see "Prerequisites" at the top of that phase for why they gate criteria 2.4 and 2.5:

1. **Auth → Providers → Email**: confirm "Confirm email" is **disabled**, matching `enable_confirmations = false`.
2. **Auth → Policies**: set the minimum password length to **8**, matching the zod schema and the `config.toml` change in Phase 2.

A third step becomes necessary only if v2 enables confirmations: adding the production and preview Workers origins to Auth → URL Configuration (documented in `.env.example` by Phase 5).

Rollback is a straight revert. The only stateful side effect is user accounts created during testing, which are removable from the Supabase dashboard.

## References

- Roadmap item F-01: `context/foundation/roadmap.md:68-79`
- PRD requirements: `context/foundation/prd.md:79-83` (FR-001, FR-002), `context/foundation/prd.md:140-147` (Access Control)
- Deploy-preview verification requirement: `context/foundation/infrastructure.md:92`
- Existing session scaffold: `src/utils/supabase/proxy.ts:33-41`, `src/utils/supabase/server.ts:9`, `src/middleware.ts:4-12`
- Next.js 16 auth conventions: `node_modules/next/dist/docs/01-app/02-guides/authentication.md:33-130`
- `redirect()` outside try/catch: `node_modules/next/dist/docs/01-app/03-api-reference/04-functions/redirect.md:50-52`
- Plan brief: `context/changes/email-password-auth/plan-brief.md`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Auth primitives & validation contract

#### Automated

- [x] 1.1 Dependencies install cleanly: `pnpm install` — b003011
- [x] 1.2 Type checking passes: `pnpm typecheck` — b003011
- [x] 1.3 Linting passes: `pnpm lint` — b003011
- [x] 1.4 Production build succeeds: `pnpm build` — b003011

#### Manual

- [x] 1.5 Public allowlist reviewed and agreed to cover FR-007's future shared-list route — b003011

### Phase 2: Sign-up and sign-in

#### Automated

- [x] 2.1 Type checking passes: `pnpm typecheck` — 690ccbd
- [x] 2.2 Linting passes: `pnpm lint` — 690ccbd
- [x] 2.3 Production build succeeds: `pnpm build` — 690ccbd

#### Manual

- [x] 2.4 Sign-up with a new email creates an account and redirects, no confirmation required — 690ccbd
- [x] 2.5 Sign-up with an existing email shows the specific "already registered" message — 690ccbd
- [x] 2.6 Sign-in succeeds with correct password; wrong password shows generic error copy — 690ccbd
- [x] 2.7 Invalid email / short password show field-level errors without a Supabase round trip — 690ccbd
- [x] 2.8 Submit button is disabled while the action is pending — 690ccbd
- [x] 2.9 Hosted dashboard prerequisites confirmed (confirmations off, min length 8) — do before 2.4 — 690ccbd
- [x] 2.10 Form components follow the CLAUDE.md layout convention (own dir + `index.ts`, `src/components/` untouched) — 690ccbd

### Phase 3: Auth header and sign-out

#### Automated

- [x] 3.1 Type checking passes: `pnpm typecheck` — 667690d
- [x] 3.2 Linting passes: `pnpm lint` — 667690d
- [x] 3.3 Production build succeeds: `pnpm build` — 667690d

#### Manual

- [x] 3.4 Header shows the signed-in email after sign-in — 667690d
- [x] 3.5 Sign out clears the session and reverts the header — 667690d
- [x] 3.6 Signed-out state survives refresh and direct URL entry — 667690d
- [x] 3.7 Sign-out works with JavaScript disabled — 667690d
- [x] 3.8 `auth-status` follows the CLAUDE.md layout convention and adds no route — 667690d

### Phase 4: Allowlist route protection with returnTo

#### Automated

- [x] 4.1 Type checking passes: `pnpm typecheck` — 1f6202e
- [x] 4.2 Linting passes: `pnpm lint` — 1f6202e
- [x] 4.3 Production build succeeds: `pnpm build` — 1f6202e

#### Manual

- [x] 4.4 Non-public path redirects to `/login?next=…` and returns there after sign-in — 1f6202e
- [x] 4.5 All allowlisted public paths load without a redirect — 1f6202e
- [x] 4.6 Off-site and protocol-relative `next` values fall back to `/` — 1f6202e
- [x] 4.7 Session survives repeated navigation (verifies the redirect cookie copy) — 1f6202e
- [x] 4.8 `/api/health` reports `authenticated` correctly in both states — 1f6202e
- [x] 4.9 Signed-out request to a non-allowlisted `/api/` path returns `401` JSON, not a redirect — 1f6202e

### Phase 5: Confirmation path and Workers verification

#### Automated

- [x] 5.1 Type checking passes: `pnpm typecheck` — 8ad9074
- [x] 5.2 Linting passes: `pnpm lint` — 8ad9074
- [x] 5.3 Production build succeeds: `pnpm build` — 8ad9074
- [x] 5.4 Workers build and preview start cleanly: `pnpm preview` — 8ad9074

#### Manual

- [ ] 5.5 Full sign-up / sign-in / sign-out loop works against `pnpm preview` (workerd)
- [ ] 5.6 Protection redirect and returnTo behave identically under Workers
- [ ] 5.7 Session survives hard refresh and direct URL entry under Workers
- [ ] 5.8 `/api/health` on the preview reports the session correctly
- [ ] 5.9 With confirmations temporarily enabled locally, the email link establishes a session via `/auth/confirm`
- [ ] 5.10 Full loop + hard refresh work against the deployed Cloudflare PR preview (not `pnpm preview`)
- [ ] 5.11 Authenticated responses on the deployed preview are `Cache-Control: private`/`no-store` and never `cf-cache-status: HIT`
