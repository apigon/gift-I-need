# Organizer Creates and Shares an Event List Implementation Plan

## Overview

Implements S-01 on the roadmap: an authenticated organizer creates an event (name, date, IANA timezone), lands on a private "manage" page, adds gift ideas to it one at a time, and gets a shareable link to hand to guests — plus a second, private link back to the manage page itself, since no dashboard exists yet. This is the first slice to exercise the F-02 (`surprise-rule-data-contract`) schema end-to-end from the UI side. F-02 already built and RLS-tested the `events`/`items` tables, the immutability trigger, and the column-scoped grants — this plan adds the TypeScript data-access layer, a new searchable-dropdown design-system primitive, two pages (home page and manage page), two Server Actions, and a small amount of missing DB test coverage. No new RLS policy or RPC is needed. One narrow migration is added (Phase 1) — see Critical Implementation Details — purely to correct the generated TypeScript `Insert` type for three trigger-computed `events` columns; it changes no RLS, grant, or runtime behavior.

## Current State Analysis

- `public.events` and `public.items` exist with RLS (`supabase/migrations/20260911211956_surprise_rule_schema.sql`). The organizer inserts/selects/updates their own rows directly under RLS — this is **not** an RPC path, unlike claims.
- Grants are column-scoped: `insert (name, event_date, timezone)` / `update (name)` on `events`; `insert (event_id, title, notes, link, price_range)` / `update (title, notes, link, price_range)` on `items`. Any other column in an INSERT/UPDATE statement is rejected with `42501` before the row is even considered.
- The `events_guard` trigger computes `share_token`, `unlockable_at`, `auto_reveal_at` on INSERT and raises `invalid_timezone` / `event_date_in_past` for bad input; on UPDATE it raises `event_date_immutable` if `event_date`, `timezone`, `owner_id` or the derived reveal columns are touched.
- `items_insert_owner` / `items_update_owner` policies already close writes once `private.reveal_open(event_id)` is true — item creation naturally stops being possible after the reveal, with no app-side check needed.
- `src/lib/lists/errors.ts` already defines `ListErrorCode` and `mapRpcError`, and **already includes** `invalid_timezone`, `event_date_in_past`, `event_date_immutable`, `event_not_found`, `item_not_found` — F-02 anticipated this slice reusing that module as-is. No new error codes are needed.
- `src/lib/lists/shared-list.ts` is explicitly scoped (in its own header comment) to S-02/S-03/S-05's guest-facing reads and claim/given/unlock mutations. Organizer-side create/read/add-item logic needs a new sibling module in the same domain folder, not an addition to `shared-list.ts`.
- `src/lib/auth/schemas.ts` defines `FormState`/`AuthFieldErrors` with an explicit comment: "S-01's event form and S-04's item form are expected to reuse this shape rather than invent their own; when a second feature needs it, move it to `src/lib/forms/`." This slice is that second feature.
- `src/lib/auth/routes.ts` already makes `/lists/` a public prefix, with a comment noting it's a forward declaration for S-02 and that "S-01 must either adopt this URL prefix or change this line."
- The generated `Database["public"]["Tables"]["events"]["Insert"]` type marks `share_token`, `unlockable_at`, `auto_reveal_at` as **required** (no column-level DB default — they're trigger-assigned), even though the column grant forbids supplying them. `src/lib/lists/claim-race.integration.test.ts:81-90` worked around this with a cast (`as unknown as Database["public"]["Tables"]["events"]["Insert"]`) — this plan does not repeat that workaround; Phase 1 fixes the root cause with a migration instead (see Critical Implementation Details and the Key Discoveries note below).
- No dashboard exists (FR-014 is parked) and none is being added here. `src/app/page.tsx` is currently a static marketing placeholder (`Heading` + `Text`, no data access); `src/app/layout.tsx` already mounts `AuthStatus` (`src/app/components/auth-status/auth-status.tsx`) in the header on every route, which calls `supabase.auth.getUser()` once per request — a round trip to Supabase's `/auth/v1/user` endpoint, called out in that file's own comment as a deliberate, already-accepted cost that opts the whole app into dynamic rendering. A second `getUser()` call on the home page would double that cost for a check that only needs a boolean.
- The design system (`src/components/`) has no dropdown/select primitive at all today — `Button`, `Input`, `Alert`, `StatusBadge`, `Link`, `Toaster`/`notify`, `Heading`/`Text` are all hand-rolled wrappers around native HTML elements with no headless-UI or combobox library dependency (`package.json` has no such dependency). `globals.css` defines no elevation/shadow token, only colour, type-scale, and radius tokens.
- `src/app/design-system/page.tsx` is the dev-only (`notFound()` in production) reference page that demos every primitive against `context/changes/design-system-baseline/palette-proof.html`, with small demo components (`ControlledFieldDemo`, `ToastDemo`) living under `src/app/design-system/components/`.
- `supabase/tests/02_events_items.test.sql` already pgTAP-covers ownership, the immutability trigger, `event_date_in_past`, `invalid_timezone`, and the `items_link_format` constraint — but has **zero** coverage for the `items_title_length`, `items_notes_length`, and `items_price_range_length` check constraints, which this slice's item form is the first thing to rely on for user-facing validation.

## Desired End State

An authenticated user can:
1. Go to `/` (the app's home page) and see a create-event form in place of the marketing copy shown to signed-out visitors; enter a name and date, confirm (or change, via a searchable timezone picker) the auto-detected timezone, and submit — landing on `/events/<id>`.
2. On `/events/<id>`, see the event's name/date/timezone (read-only — immutable), add items one at a time via a form (title required; notes/link/price optional), see each new item appear in a running list, and copy two links: one to share with guests (`{site origin}/lists/<share_token>`), and one private link back to this same manage page (`{site origin}/events/<id>`) for their own future use.
3. Revisiting `/events/<id>` later (via the bookmarked/copied manage link) shows the same event and its items.
4. Anyone who isn't that event's owner — including a signed-out visitor or a different authenticated user — gets Next's not-found page at `/events/<id>`, with no way to distinguish "doesn't exist" from "exists but isn't yours."
5. A signed-out visitor still sees today's marketing copy at `/`; nothing changes for them.

### Key Discoveries:
- **(Plan-review decision, 2026-09-12 — scope deviation, accepted)**: `supabase gen types` derives Insert-optionality purely from DB-level `DEFAULT`s (`information_schema`/`pg_attrdef`), never from trigger bodies, so there is no config flag that fixes this. Since `events_guard`'s `INSERT` branch unconditionally overwrites `share_token`/`unlockable_at`/`auto_reveal_at` on every row (`supabase/migrations/20260911211956_surprise_rule_schema.sql:126-129` — not an `if null` guard), giving those three columns harmless placeholder `DEFAULT`s is a zero-behavior-change root-cause fix: it flips them to optional in the regenerated type with no RLS/grant/trigger change. This plan adopts that fix (a new Phase 1 migration) instead of reusing the `claim-race.integration.test.ts:81-90` cast — see Critical Implementation Details.
- `mapRpcError` / `ListErrorCode` in `src/lib/lists/errors.ts` need no changes — every P0001 key this slice's writes can raise is already in that map.
- The `/lists/` prefix is already public in `src/lib/auth/routes.ts`; `/events/[id]` needs no `routes.ts` change at all, since the middleware is fail-closed by default and the path is never added to the allowlist. `/` is already public and needs no change either — it must stay reachable by signed-out visitors for the marketing copy.
- `@supabase/ssr`'s `getClaims()` (mentioned as the latency escape hatch in `auth-status.tsx`'s own comment) verifies the session JWT locally against the project's cached JWKS with no network round trip, unlike `getUser()` — the right choice for a page that only needs a signed-in/signed-out boolean, given `AuthStatus` already pays the `getUser()` cost once per request.
- Every other design-system primitive is a hand-rolled wrapper around a native element with no UI-library dependency; a new `Combobox` primitive should follow that precedent rather than reaching for a new package.

## What We're NOT Doing

- No item editing or deletion (S-04, a separate slice).
- No events dashboard / list-of-my-events view (FR-014, parked). `/` shows only a create-event form for a signed-in user — not a list of their existing events. If they've already created one, they return to it via its manage link, not via `/`.
- No share-link revocation (open roadmap question, not blocking S-01).
- No new RLS policy or RPC — the write paths this slice needs already exist from F-02. **Scope deviation (plan-review, 2026-09-12, accepted)**: one narrow migration is added in Phase 1, giving three `events` columns harmless `DEFAULT`s purely to fix the generated TypeScript `Insert` type — no RLS, grant, or runtime-behavior change. See Critical Implementation Details.
- No optimistic UI for item-adding — the `Button` component's existing `pending` state is the only loading feedback.
- No live character-limit counters while typing — validation errors surface on submit, with a static `hint` under each field stating its max length.
- No third-party combobox/UI library — the new `Combobox` primitive is hand-rolled, consistent with every existing primitive.
- No component-testing infrastructure (still out of scope per F-02) — this slice's tests are Vitest unit tests (schemas + DAL) and pgTAP; the new `Combobox` and the form/page components are verified manually, matching how `Button`/`Input`/`Alert` were verified when they were built.

## Implementation Approach

Follow the same shape as the F-01 auth slice and the F-02 shared-list module: a `server-only` data-access module per domain area, thin Server Actions that parse `FormData` with zod and call the DAL, and client components built from existing (plus one new) primitives using `useActionState`. The organizer's reads/writes go straight to `public.events` / `public.items` under RLS (no RPC — that's only for claims/reveal). Two pieces of shared infrastructure land before any feature UI: relocating `FormState` out of `src/lib/auth/schemas.ts` into a feature-agnostic `src/lib/forms/` module (exactly as that file's own comment anticipates), and a new `Combobox` design-system primitive for the timezone picker.

## Critical Implementation Details

**Trigger-computed `events` columns get real DEFAULTs instead of an app-layer cast (plan-review decision, 2026-09-12 — scope deviation from this plan's original no-new-migration decision, accepted).** `events.share_token`, `unlockable_at`, and `auto_reveal_at` have no column DEFAULT today — `events_guard`'s `BEFORE INSERT` branch (`supabase/migrations/20260911211956_surprise_rule_schema.sql:126-129`) sets all three unconditionally on every row, which `supabase gen types` cannot see: it derives Insert-optionality purely from `information_schema`/`pg_attrdef` column defaults, never from trigger bodies, so there is no CLI flag or config setting that fixes this — the generated `Insert` type marks all three required even though the column GRANT forbids supplying them.

Rather than repeat the `as unknown as Database["public"]["Tables"]["events"]["Insert"]` cast from `claim-race.integration.test.ts:81-90`, Phase 1 adds a new migration (e.g. via `supabase migration new events_insert_defaults`) giving each column a harmless placeholder `DEFAULT`: `default now()` for `unlockable_at`/`auto_reveal_at`, `default ''` for `share_token`. This is safe because Postgres applies column defaults while building the row *before* `BEFORE INSERT` triggers run, and `events_guard` overwrites `NEW.unlockable_at`/`NEW.auto_reveal_at`/`NEW.share_token` unconditionally — not conditioned on the incoming value — so the placeholder is never observably stored; only the trigger-computed value reaches the constraint checks and the final row. This flips all three columns to optional (`?`) in the regenerated `Insert` type, so `createEvent`'s insert payload (`{ name, event_date, timezone }`) type-checks directly against the real generated type with **no cast at all**. Do not hand-edit `database.types.ts` itself — regenerate it with `pnpm db:types` after the migration lands.

This is accepted as a deliberate scope deviation (see What We're NOT Doing / Migration Notes) because the cast, while functionally fine, permanently mis-documents these three columns as required to every future reader of `events`' generated type; the migration changes no RLS, grant, or trigger behavior — only what value Postgres would use in the (unreachable) case where `events_guard` didn't run, which cannot happen outside a deliberately disabled trigger.

**Consequential cleanup**: once `database.types.ts` is regenerated, the cast and its explanatory comment in `src/lib/lists/claim-race.integration.test.ts:81-90` are no longer accurate (the comment states "the generated Insert type can't see past the trigger, hence the cast") — Phase 5 removes them.

**No new pgTAP case needed for the defaults themselves**: `supabase/tests/02_events_items.test.sql:31-35` (`share_token is 22 URL-safe characters`) and `:93-97` (`unlockable_at`/`auto_reveal_at` match the worked example) already assert the *actual stored values*, which would fail if a placeholder default ever leaked through undetected. Phase 1 only needs to confirm these two existing assertions still pass after the migration lands (`pnpm test:db`).

**`getOwnedEvent` has three outcomes, not two.** Mirror `SharedListResult`'s discrimination (`context/foundation/lessons.md` pattern, already applied in `shared-list.ts`): a failed query is not the same as "no such event." Collapsing both into `notFound()` would render a database outage as "this event doesn't exist." Only an empty result (RLS returned zero rows — indistinguishable between "doesn't exist" and "not yours," which is the point) should trigger `notFound()`; a query error should render an inline `Alert`.

**Timezone capture is client-only auto-detect + optional override, not server-validated shape.** `Intl.DateTimeFormat().resolvedOptions().timeZone` gives the initial value; the "Change timezone" button reveals the new `Combobox` populated from `Intl.supportedValuesOf("timeZone")`. Feature-detect `supportedValuesOf` (not available in all browsers) and hide the override button when it's missing, falling back to the auto-detected value only. The zod schema for this field only checks "non-empty string" — actual IANA validity is the database trigger's job (`invalid_timezone`), since duplicating the full IANA list client-side would drift from what Postgres actually accepts.

**The `Combobox` primitive needs a real ARIA combobox contract, not a styled `<select>`.** Because it's genuinely new (no prior art in this codebase), get the accessibility wiring right up front: the filter `<input>` carries `role="combobox"`, `aria-expanded`, and `aria-controls` pointing at the popup's id; the popup carries `role="listbox"`; each row carries `role="option"` and a stable `id` referenced by `aria-activedescendant` on the input as the highlighted index changes. Arrow Up/Down move the highlighted option, Enter commits it, Escape closes the popup without changing the committed value, and a click outside (or blur that isn't moving focus into the popup) closes it. The committed value is mirrored into a hidden `<input type="hidden" name={name}>` so a surrounding `<form>` submits the selected IANA string, not the filter text currently typed. No new design token is needed for the popover — reuse `bg-surface`/`border-edge`/`rounded-control` plus Tailwind's built-in (uncustomized) `shadow-lg` utility for elevation.

**The home page needs a cheap, not-a-second-round-trip auth check.** `src/app/page.tsx` must render different content for signed-in vs. signed-out visitors. Use `supabase.auth.getClaims()`, not `supabase.auth.getUser()` — the layout's `AuthStatus` already pays one `getUser()` round trip per request, and this check only needs a boolean, which `getClaims()` answers by verifying the JWT locally against the (cached) project JWKS.

**The organizer's own manage-page link is built the same way as the guest share link — from configuration, not the request.** Both `{site origin}/lists/<share_token>` and `{site origin}/events/<id>` are built server-side from `NEXT_PUBLIC_SITE_URL`, mirroring `buildConfirmUrl` in `src/app/actions/auth.ts` — never from a request header, for the same reason that function documents (an attacker-influenced `Host` header must never end up in a link the app treats as canonical).

## Phase 1: Migration, data layer — events-insert-defaults, form-state relocation, schemas, and the owned-events DAL

### Overview

Everything downstream (Server Actions, forms) depends on this phase. No UI yet.

### Changes Required:

#### 1. Migration — harmless DEFAULTs on trigger-computed `events` columns

**File**: `supabase/migrations/<new-timestamp>_events_insert_defaults.sql` (new — create via `supabase migration new events_insert_defaults`)

**Intent**: See Critical Implementation Details for the full rationale. Fixes the generated `Insert` type's requiredness for three columns that are actually always trigger-computed, so `createEvent` (§4 below) needs no cast. Scope deviation from this plan's original "no new migration" decision — accepted in plan review, 2026-09-12.

**Contract**:
```sql
alter table public.events
  alter column unlockable_at set default now(),
  alter column auto_reveal_at set default now(),
  alter column share_token set default '';
```
No RLS, grant, or trigger change. After this migration is applied locally, run `pnpm db:types` to regenerate `src/utils/supabase/database.types.ts` — `Insert.share_token` / `Insert.unlockable_at` / `Insert.auto_reveal_at` should each gain a `?`.

#### 2. Relocate `FormState` to a feature-agnostic module

**File**: `src/lib/forms/form-state.ts` (new)

**Intent**: `src/lib/auth/schemas.ts` already documents that this move should happen when a second feature needs the same Server-Action-result shape — this slice is that feature. Keep it generic over the field-error shape so both auth and event/item forms can parametrize it.

**Contract**: Export a generic `FormState<TFieldErrors>` (`{ status: "idle" } | { status: "error"; errors?: TFieldErrors; message?: string }`) and `initialFormState`. `src/lib/auth/schemas.ts` re-exports `AuthFieldErrors` and its own `FormState = FormState<AuthFieldErrors>` alias from this module instead of defining the union locally, so `src/app/actions/auth.ts` and the two auth forms need no changes beyond the import source. No barrel `index.ts` for `src/lib/forms/` — same reasoning as `src/lib/auth/` (keep zod out of any Edge-imported path); import the module directly.

#### 3. Event/item validation schemas

**File**: `src/lib/lists/schemas.ts` (new)

**Intent**: Mirror the DB CHECK constraints so the common-case validation error is a fast, specific client-visible message rather than a round trip to Postgres. The DB stays authoritative — these schemas narrow, they don't replace, `mapRpcError`.

**Contract**: `CreateEventSchema` — `name` (trim, 1–120 chars, matching `events_name_length`), `eventDate` (non-empty string; the actual "today or later" rule is enforced by the `events_guard` trigger and surfaced via `event_date_in_past`), `timezone` (non-empty string). `AddItemSchema` — `title` (trim, 1–200 chars, matching `items_title_length`), `notes` (optional, ≤2000 chars), `link` (optional, must match `^https?://`, ≤2048 chars), `priceRange` (optional, ≤50 chars). Export a `FieldErrors` type per schema for use with the relocated `FormState<T>`.

#### 4. Owned-events data-access module

**File**: `src/lib/lists/owned-events.ts` (new)

**Intent**: The organizer-side sibling of `shared-list.ts` — the only place that reads/writes `public.events`/`public.items` for their owning organizer. Same `server-only` + no-cache posture as `shared-list.ts` (this reads live data an organizer just wrote; staleness would be confusing, not a security issue, but there's no reason to diverge from the established pattern).

**Contract**: Three exports.
- `createEvent(input: { name: string; eventDate: string; timezone: string }): Promise<{ ok: true; eventId: string } | { ok: false; code: ListErrorCode }>` — inserts `{ name, eventDate, timezone }` into `public.events` directly (no cast — see Critical Implementation Details and §1 above), selects back the new row's `id`.
- `addItem(eventId: string, input: { title: string; notes?: string; link?: string; priceRange?: string }): Promise<ListResult>` (reuse the existing `ListResult` type from `src/lib/lists/types.ts`) — inserts into `public.items`.
- `getOwnedEvent(eventId: string): Promise<{ kind: "ok"; event: OwnedEvent; items: OwnedItem[] } | { kind: "not_found" } | { kind: "error"; code: ListErrorCode }>` — selects the event by `id` (RLS scopes it to the caller's own rows; a stranger's id or a nonexistent id both come back empty) plus its items ordered by `created_at, id` (same ordering as `get_shared_items`, for consistency). Add `OwnedEvent`/`OwnedItem` types to `src/lib/lists/types.ts` alongside the existing `SharedEvent`/`SharedItem` — they carry the same shape as their DB rows (including `shareToken`, unlike `SharedEvent`, since only the owner's own view needs to render the link) but never a claim `status` field, since the owner's own direct read has no concept of one.

All three route Postgrest/Postgres errors through the existing `mapRpcError` from `src/lib/lists/errors.ts` — no new error-mapping logic.

#### 5. Unit tests

**File**: `src/lib/lists/schemas.test.ts`, `src/lib/lists/owned-events.test.ts` (new)

**Intent**: Same style as `src/lib/lists/shared-list.test.ts` — mock `@/utils/supabase/server`'s `createClient`, assert the three-outcome discrimination on `getOwnedEvent`, and assert the schemas accept/reject their boundary values (120/121 char name, 200/201 char title, a `javascript:` link, etc.).

### Success Criteria:

#### Automated Verification:
- pgTAP suite passes: `pnpm test:db` (confirms the §1 migration applies cleanly and the existing `share_token`/`unlockable_at`/`auto_reveal_at` assertions in `02_events_items.test.sql:31-35,93-97` still pass against the new column defaults)
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`

#### Manual Verification:
- None — this phase has no UI.

---

## Phase 2: Design system — searchable Combobox primitive

### Overview

A new reusable dropdown primitive for the timezone override control, following the ARIA contract in Critical Implementation Details. Built before the forms that need it.

### Changes Required:

#### 1. Combobox component

**File**: `src/components/combobox/combobox.tsx`, extend `src/components/index.ts`

**Intent**: A single-select, type-to-filter dropdown for a long option list (~400 IANA zone names), matching `Input`'s `label`/`error`/`hint` contract so it drops into a form identically. Hand-rolled, per the "no new UI-library dependency" decision — every existing primitive already follows this approach.

**Contract**: `Combobox({ id, label, name, options, value, onChange, error?, hint?, placeholder? }: { id: string; label: string; name: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void; error?: string; hint?: string; placeholder?: string })`. See Critical Implementation Details for the full ARIA/keyboard/hidden-input contract.

#### 2. Design-system showcase demo

**File**: `src/app/design-system/components/combobox-demo/combobox-demo.tsx`, extend `src/app/design-system/components/index.ts` and add a "Combobox" section to `src/app/design-system/page.tsx`

**Intent**: Exercise the new primitive the same way `ControlledFieldDemo` exercises `Input`, per CLAUDE.md's design-system convention of every primitive having a showcase entry.

**Contract**: A controlled demo (`useState`) with a small fixed option list — no need to enumerate all ~400 timezones here.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`

#### Manual Verification:
- On `/design-system` (dev only), typing into the Combobox filters the option list.
- Arrow Up/Down move the highlighted option; Enter commits it; Escape closes the popup without changing the committed value.
- Clicking outside the popup closes it without changing the committed value.
- The control is fully operable via keyboard alone (tab in, filter, arrow/enter, tab out).
- `/design-system` still 404s when `NODE_ENV=production`.

---

## Phase 3: Create-event flow on the home page

### Overview

The organizer's entry point lives at `/` rather than a dedicated route, since nothing links to a standalone "create event" page without a dashboard.

### Changes Required:

#### 1. Server Action

**File**: `src/app/actions/events.ts` (new)

**Intent**: `createEvent` Server Action shaped for `useActionState`, following `src/app/actions/auth.ts`'s exact contract (parse `FormData` with the zod schema, call the DAL, redirect outside any try/catch on success).

**Contract**: `createEvent(prevState: FormState<CreateEventFieldErrors>, formData: FormData): Promise<FormState<CreateEventFieldErrors>>`. On `CreateEventSchema` failure, return field errors. On a DAL failure, map `ListErrorCode` to a user-facing message (`invalid_timezone` → "That doesn't look like a valid timezone.", `event_date_in_past` → "Pick today or a later date.", everything else → a generic message, matching the auth Server Action's copy policy). On success, `redirect(`/events/${eventId}`)`.

#### 2. Home page

**File**: `src/app/page.tsx` (replace placeholder body)

**Intent**: Branch on session state so signed-out visitors keep today's marketing copy unchanged, and signed-in visitors see the create-event form in its place. Use `getClaims()`, not `getUser()`, per Critical Implementation Details.

**Contract**: Server Component. No session → render the existing `Heading`/`Text` marketing copy unchanged. Session present → render `CreateEventForm` instead.

#### 3. Form component

**File**: `src/app/components/create-event-form/create-event-form.tsx`, extend `src/app/components/index.ts`

**Intent**: Lives under `src/app/components/` — not a route-scoped `components/` dir — because its only consumer is `src/app/page.tsx` itself, mirroring why `AuthStatus` lives there for `src/app/layout.tsx` (CLAUDE.md's child-component rule: co-locate with the sole consumer). Follows `sign-up-form.tsx`'s exact structure — controlled inputs, `useActionState`, `Alert` for the form-level message, `Input` for name and date.

**Contract**: On mount, `useState` seeds the timezone from `Intl.DateTimeFormat().resolvedOptions().timeZone` (guarded — fall back to `"UTC"` if unavailable). Renders the detected zone as static text with a "Change timezone" `Button` (`variant="secondary"`) that swaps it for the new `Combobox` listing `Intl.supportedValuesOf("timeZone")`, hidden entirely when that API is unavailable (falls back to the auto-detected value only). The date `Input` uses `type="date"` with `min` set to today's local date string (client-side convenience only — the trigger is the authority). Submits `name`, `eventDate`, `timezone` as plain form fields.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`

#### Manual Verification:
- Signed-out `/` shows the existing marketing copy, unchanged.
- Signed-in `/` shows the create-event form instead.
- Creating an event with a valid name/date redirects to `/events/<id>`.
- Submitting a name over 120 characters, or a past date, shows the corresponding inline/field error without losing the entered values.
- The detected timezone matches the browser's actual zone; "Change timezone" reveals the Combobox and the chosen value is what gets submitted.

---

## Phase 4: Manage page — items, share link, and the organizer's own link

### Overview

The organizer's durable per-event page: item-adding, the running list, the guest share link, and a second private link back to this page.

### Changes Required:

#### 1. Server Action

**File**: `src/app/actions/events.ts` (extend Phase 3's file)

**Intent**: `addItem` Server Action, same shape as `createEvent`.

**Contract**: `addItem(eventId: string, prevState: FormState<AddItemFieldErrors>, formData: FormData): Promise<FormState<AddItemFieldErrors>>` — bound to `eventId` via `.bind(null, eventId)` where the form is rendered (the standard Next.js pattern for a parameterized Server Action used with `useActionState`). On success, returns to idle state rather than redirecting — the organizer stays on the page to add more items; Next.js's default Server Action revalidation re-renders the page with the new item included.

#### 2. Page

**File**: `src/app/events/[id]/page.tsx` (new)

**Intent**: Load the event via `getOwnedEvent`; distinguish "not found" from "error" per Critical Implementation Details.

**Contract**: Server Component. `kind: "not_found"` → `notFound()`. `kind: "error"` → render an `Alert` explaining the load failed, no further content. `kind: "ok"` → render the event's name/date/timezone as plain text (immutable — no edit affordance exists yet, that's S-04), two `CopyableLinkCard`s (share link, organizer link), the item list, and the `AddItemForm`. Build both links server-side from `NEXT_PUBLIC_SITE_URL` per Critical Implementation Details: `{site origin}/lists/${event.shareToken}` and `{site origin}/events/${event.id}`.

#### 3. Copyable-link component

**File**: `src/app/events/[id]/components/copyable-link-card/copyable-link-card.tsx`, `src/app/events/[id]/components/index.ts` (new)

**Intent**: One reusable card for both links, since the copy interaction is identical — only the label, description, and URL differ. Client component for the copy interaction: `navigator.clipboard.writeText`, a transient inline text change (e.g., the button's own label flips to "Copied!" for a couple of seconds) plus a `notify` toast — per CLAUDE.md's design-system rule that a toast supplements, never replaces, an inline confirmation.

**Contract**: `CopyableLinkCard({ label, description, href }: { label: string; description: string; href: string })`. Rendered twice on the manage page: once labeled for guests ("Share with your guests"), once labeled for the organizer ("Your link back to this page — there's no dashboard yet, so save this to return here").

#### 4. Item list + add-item form components

**File**: `src/app/events/[id]/components/item-list/item-list.tsx`, `src/app/events/[id]/components/add-item-form/add-item-form.tsx`, folded into the same `components/index.ts`

**Intent**: `ItemList` renders each item's title/notes/link/price as plain text — no `StatusBadge`, since the organizer's own items carry no claim status by definition. `AddItemForm` follows the same controlled-`useActionState` shape as `CreateEventForm`, clearing its fields after a successful submission. The new item appearing in the list needs no separate handling — Next.js's default Server Action revalidation (Phase 4 §1) already re-renders the page, and with it `ItemList`, once `addItem` resolves.

**Field-clearing mechanism (plan-review F2)**: no precedent for "return to idle" exists in this codebase — both existing `useActionState` consumers (`sign-up-form.tsx`, `sign-in-form.tsx`) always `redirect()` on success and never re-render idle. Rather than distinguishing "never submitted" from "just succeeded" (both are `{status:"idle"}` and otherwise indistinguishable), rely on the fact that the *action to take* — reset every field to its initial value — is identical in both cases, so no such distinction is needed. Define `INITIAL_ITEM_FIELDS = { title: "", notes: "", link: "", priceRange: "" }` as a module-level const (mirroring the `INITIAL_STATE` const pattern in `sign-up-form.tsx`), seed each field's `useState` from it, and add `useEffect(() => { if (state.status !== "error") { setTitle(INITIAL_ITEM_FIELDS.title); /* …and the rest */ } }, [state])`. `useActionState` returns a new `state` object reference on every action resolution (including the initial mount, where fields are already at their initial values, making that first firing a harmless no-op), so the effect fires exactly on mount and on every successful `addItem` call, and never on error (the guard skips it, preserving the user's input to fix and resubmit).

**Contract**: `ItemList({ items: OwnedItem[] })`; `AddItemForm({ eventId: string })`.

### Success Criteria:

#### Automated Verification:
- Type checking passes: `pnpm typecheck`
- Linting passes: `pnpm lint`
- Unit tests pass: `pnpm test`

#### Manual Verification:
- Adding an item appends it to the visible list without a full page navigation.
- Submitting an item with a title over 200 characters, or a `javascript:` link, shows the corresponding field error.
- The guest-link copy button copies the exact `{site origin}/lists/<share_token>` URL and shows both the inline label change and a toast.
- The organizer-link copy button copies the exact `{site origin}/events/<id>` URL and shows the same feedback.
- Opening the copied organizer link while signed in as the owner returns to this same page.
- Opening `/events/<id>` for someone else's event (or a random UUID), signed in as a different user, renders Next's not-found page.
- Opening `/events/<id>` while signed out redirects to `/login` (middleware default), then returns here after sign-in.
- Revisiting the same `/events/<id>` URL later still shows the event and all previously-added items.

**Implementation Note**: After this phase's automated verification passes, pause for manual confirmation before proceeding to Phase 5.

---

## Phase 5: DB test coverage and doc hygiene

### Overview

Closes the one real gap in F-02's pgTAP coverage that this slice's item form depends on, and cleans up a stale comment now that S-01 has landed.

### Changes Required:

#### 1. Item field-length pgTAP coverage

**File**: `supabase/tests/02_events_items.test.sql`

**Intent**: `items_title_length`, `items_notes_length`, and `items_price_range_length` (all defined in the F-02 schema migration) currently have no test coverage — only `items_link_format` does. This slice's `AddItemForm` is the first thing that makes these constraints user-facing, so lock them the same way the existing link-format case does.

**Contract**: Add three `throws_ok(..., '23514', ...)` cases (empty-string title, a title/notes/price string one character over its limit) following the existing `items_link_format` case's exact style — pinned SQLSTATE and constraint name, not a bare `throws_ok`. Bump `select plan(16)` to the new total.

**Isolation from the reveal fixture (plan-review F1)**: the file's existing reveal fixture (`revealed_at := now()`, just before the two post-reveal `42501` cases) permanently closes every subsequent item insert once it runs — `items_insert_owner`'s `with check` rejects them before Postgres ever reaches a CHECK constraint. A `23514` assertion placed after that point would fail with `42501` instead. Rather than threading the new cases in earlier and relying on staying above that line forever, isolate the reveal fixture in its own pgTAP-compatible savepoint — the SQL-file analogue of a fresh Vitest `describe` setup: take `savepoint pre_reveal;` immediately before the reveal fixture, and `rollback to savepoint pre_reveal;` immediately after the two existing post-reveal `42501` assertions, before the three new length-constraint cases. That restores `revealed_at` to null so the new group runs against an unrevealed event independent of where it sits in the file.

#### 2. Routes comment cleanup

**File**: `src/lib/auth/routes.ts`

**Intent**: The `/lists/` prefix comment currently reads as a forward declaration ("does not exist yet... S-01 must either adopt this URL prefix or change this line"). S-01 has now adopted it (the share link points here), but the page itself still doesn't exist until S-02. Update the comment so it doesn't read as an open question.

**Contract**: Replace the "FORWARD DECLARATION" wording with a note that `create-and-share-event-list` (S-01) generates links under this prefix and that `browse-shared-list` (S-02) is what will serve them.

#### 3. Remove the now-unnecessary insert cast in `claim-race.integration.test.ts`

**File**: `src/lib/lists/claim-race.integration.test.ts`

**Intent**: Phase 1 §1's migration makes `share_token`/`unlockable_at`/`auto_reveal_at` optional on `events`' generated `Insert` type. The `as unknown as Database["public"]["Tables"]["events"]["Insert"]` cast at lines 81-90 (and its comment explaining "the generated Insert type can't see past the trigger, hence the cast") is no longer accurate and would otherwise go stale — this is exactly the kind of doc-hygiene cleanup this phase already does for `routes.ts`.

**Contract**: Replace the cast block with a plain `{ name: "Race test", event_date: eventDateStr, timezone: "UTC" }` object literal passed directly to `.insert(...)`; remove the comment describing the cast (or replace it with a one-line note pointing at the Phase 1 §1 migration if future context is useful).

### Success Criteria:

#### Automated Verification:
- pgTAP suite passes: `pnpm test:db`
- Integration test passes: `pnpm test:integration`
- Linting passes: `pnpm lint`

#### Manual Verification:
- None — this phase is test/doc only.

---

## Testing Strategy

### Unit Tests:
- `CreateEventSchema` / `AddItemSchema` boundary values (min/max length, malformed link, empty required fields).
- `owned-events.ts`: the three-outcome discrimination on `getOwnedEvent` (ok / not_found / error), and that `createEvent`/`addItem` map DAL errors through `mapRpcError` correctly (mocked client, no real DB).

### Integration Tests:
- None new. The existing `claim-race.integration.test.ts` already exercises the organizer's `events`/`items` insert path as fixture setup — no separate integration test is needed for this slice's own writes, which are simple RLS-scoped inserts with no concurrency dimension.

### Manual Testing Steps:
1. Sign in, go to `/` (now showing the create-event form), and create an event with a future date.
2. Confirm redirect to `/events/<id>` and that the event's details are shown correctly.
3. Add two or three items with varying optional fields filled in/omitted; confirm each appears in the list.
4. Copy the guest share link and the organizer link; confirm each is the expected URL.
5. Sign in as a second account and attempt to visit the first account's `/events/<id>` — confirm not-found.
6. Sign out and attempt `/events/<id>` — confirm it redirects to `/login`; confirm `/` still shows marketing copy, not the form.

## Performance Considerations

None new beyond what's already established — this is low-volume, low-QPS CRUD on indexed columns (`events_owner_id_idx`, `items_event_id_idx` already exist from F-02). The one deliberate choice is using `getClaims()` rather than `getUser()` on the home page (Critical Implementation Details) to avoid doubling the per-request Supabase auth round trip `AuthStatus` already pays in the root layout.

## Migration Notes

One narrow migration, in Phase 1 §1: adds harmless `DEFAULT`s to `events.share_token`/`unlockable_at`/`auto_reveal_at` so the generated TypeScript `Insert` type matches what callers must actually supply. No RLS, grant, or trigger-behavior change — `events_guard` already unconditionally overwrites these columns on every INSERT, so the defaults are never observably stored. This is a scope deviation from this plan's original "no new migration" decision, accepted in plan review (2026-09-12) — see Critical Implementation Details for the full rationale. Phase 5 additionally removes the now-unnecessary insert cast this fix makes obsolete in `claim-race.integration.test.ts`.

## References

- Related roadmap entry: `context/foundation/roadmap.md` S-01
- Data contract: `context/changes/surprise-rule-data-contract/plan.md`, `context/changes/surprise-rule-data-contract/plan-brief.md`
- Pattern to follow (Server Action + form): `src/app/actions/auth.ts`, `src/app/(auth)/signup/components/sign-up-form/sign-up-form.tsx`
- Pattern to follow (DAL module): `src/lib/lists/shared-list.ts`
- Pattern to follow (co-located single-consumer component): `src/app/components/auth-status/auth-status.tsx`
- Insert-type-cast precedent (superseded by Phase 1 §1's migration; removed in Phase 5 §3): `src/lib/lists/claim-race.integration.test.ts:81-90`
- Trigger body proving unconditional overwrite: `supabase/migrations/20260911211956_surprise_rule_schema.sql:116-129`
- FormState relocation note: `src/lib/auth/schemas.ts:43-45`
- Routes forward declaration: `src/lib/auth/routes.ts:55-61`
- Design-system showcase pattern: `src/app/design-system/page.tsx`, `src/app/design-system/components/controlled-field-demo/controlled-field-demo.tsx`

## Progress

> Convention: `- [ ]` pending, `- [x]` done. Append ` — <commit sha>` when a step lands. Do not rename step titles. See `references/progress-format.md`.

### Phase 1: Migration, data layer — events-insert-defaults, form-state relocation, schemas, and the owned-events DAL

#### Automated

- [x] 1.1 pgTAP suite passes: `pnpm test:db` — 432dd0d
- [x] 1.2 Type checking passes: `pnpm typecheck` — 432dd0d
- [x] 1.3 Linting passes: `pnpm lint` — 432dd0d
- [x] 1.4 Unit tests pass: `pnpm test` — 432dd0d

### Phase 2: Design system — searchable Combobox primitive

#### Automated

- [x] 2.1 Type checking passes: `pnpm typecheck` — f5e50b9
- [x] 2.2 Linting passes: `pnpm lint` — f5e50b9

#### Manual

- [x] 2.3 Typing into the Combobox filters the option list — f5e50b9
- [x] 2.4 Arrow keys highlight, Enter commits, Escape closes without changing the value — f5e50b9
- [x] 2.5 Clicking outside closes the popup without changing the value — f5e50b9
- [x] 2.6 Fully operable via keyboard alone — f5e50b9
- [x] 2.7 `/design-system` still 404s when `NODE_ENV=production` — f5e50b9

### Phase 3: Create-event flow on the home page

#### Automated

- [x] 3.1 Type checking passes: `pnpm typecheck` — 04ce00d
- [x] 3.2 Linting passes: `pnpm lint` — 04ce00d
- [x] 3.3 Unit tests pass: `pnpm test` — 04ce00d

#### Manual

- [x] 3.4 Signed-out `/` shows the existing marketing copy, unchanged — 04ce00d
- [x] 3.5 Signed-in `/` shows the create-event form instead — 04ce00d
- [x] 3.6 Creating an event with a valid name/date redirects to `/events/<id>` — 04ce00d
- [x] 3.7 Invalid name/date shows the corresponding field error without losing entered values — 04ce00d
- [x] 3.8 Detected timezone matches the browser's zone; override Combobox works and its value is submitted — 04ce00d

### Phase 4: Manage page — items, share link, and the organizer's own link

#### Automated

- [x] 4.1 Type checking passes: `pnpm typecheck` — e349cd2
- [x] 4.2 Linting passes: `pnpm lint` — e349cd2
- [x] 4.3 Unit tests pass: `pnpm test` — e349cd2

#### Manual

- [x] 4.4 Adding an item appends it to the visible list without a full page navigation — e349cd2
- [x] 4.5 Invalid item fields (title >200 chars, `javascript:` link) show field errors — e349cd2
- [x] 4.6 Guest-link copy button copies the correct URL and shows both inline label change and toast — e349cd2
- [x] 4.7 Organizer-link copy button copies the correct URL and shows the same feedback — e349cd2
- [x] 4.8 Opening the copied organizer link while signed in as the owner returns to this page — e349cd2
- [x] 4.9 A non-owner (or a random id) visiting `/events/<id>` gets not-found — e349cd2
- [x] 4.10 Signed-out visit to `/events/<id>` redirects to `/login` — e349cd2
- [x] 4.11 Revisiting `/events/<id>` later still shows the event and its items — e349cd2

### Phase 5: DB test coverage and doc hygiene

#### Automated

- [x] 5.1 pgTAP suite passes: `pnpm test:db` — 7f9c400
- [x] 5.2 Integration test passes: `pnpm test:integration` — 7f9c400
- [x] 5.3 Linting passes: `pnpm lint` — 7f9c400
