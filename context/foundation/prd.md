---
project: "GIN (Gift I Need)"
version: 1
status: draft
created: 2026-06-07
context_type: greenfield
product_type: web-app
target_scale:
  users: medium
  qps: low
  data_volume: small
timeline_budget:
  mvp_weeks: 4
  hard_deadline: null
  after_hours_only: true
---

## Vision & Problem Statement

When planning a gift for someone attending an event, both sides face friction: the recipient has no easy way to communicate what they want without individually answering every guest, and the guest has no way to know what would be welcome or what others are already planning to give.

Existing gift-list tools require the recipient to browse a retailer's catalogue — locking the list to a store and making it feel transactional. GIN decouples the gift list from purchasing: an organizer creates a curator list of ideas without linking to any retailer, shares a single link, and guests coordinate claims among themselves — without the organizer seeing who claimed what until after the event.

## User & Persona

### Primary persona

**The event organizer** — someone planning a birthday, wedding, or other celebration who wants to stop fielding "what should I get you?" messages one by one. They create a gift-idea list, share a link with guests, and step back — the product handles guest coordination without further involvement.

They reach for GIN when: an event is approaching and they want guests to arrive with wanted, non-duplicate gifts without repeated back-and-forth.

### Secondary persona

**The guest / gift-giver** — someone attending an event who opens the organizer's shared link, browses available gift ideas, claims one, and arrives knowing their gift is wanted and not duplicated.

Guests who create an account to claim a gift are the same user type as organizers — a guest who uses GIN at one event is a natural candidate to create their own list for the next.

## Success Criteria

### Primary
- 50% of invited guests for at least one real event chose a gift from the organizer's GIN list.

### Secondary
- At least one user who first entered the product as a guest (claimer) subsequently creates their own event list — demonstrating the guest-to-owner conversion the single-role model is designed to enable.

### Guardrails
- The organizer never sees claim status on any item before the post-event confirmation step — the surprise rule must hold end-to-end.
- No two guests can claim the same item — the duplicate-prevention mechanic must be reliable.

## User Stories

### US-01: Guest claims a gift from an event list

- **Given** an organizer has created an event with at least one unclaimed gift item and shared the list link
- **When** a guest opens the link, browses the list, signs in, and claims an unclaimed item
- **Then** the item is shown as "taken" to all other guests, the guest's claim is recorded against their account, and the organizer cannot see any claim status until the event date passes

#### Acceptance Criteria
- An unauthenticated visitor can see all items, without any claim status; seeing "taken"/"available" status requires signing in *(amended 2026-09-11, F-02)*
- Attempting to claim without being signed in surfaces the sign-up / sign-in prompt
- Once claimed, the item shows as "taken" to all other guests immediately
- The organizer's view does not reveal which items are claimed or unclaimed before the event date

### US-02: Post-event delivery confirmation

- **Given** an event's date has passed and at least one item was claimed
- **When** the organizer opens their event
- **Then** they can see the full claim status and which items have been marked as "given" by either the guest or themselves

#### Acceptance Criteria
- Before the event date, the organizer's view shows no claim information
- After the event date, claim status and "given" confirmations are visible to the organizer
- Either the guest who claimed an item or the organizer can mark it as "given" — a single irreversible mark set by whichever party acts first *(amended 2026-09-11, F-02, replaces "independently")*

## Functional Requirements

### Authentication

- FR-001: User can create an account with email + password. Priority: must-have
  > Socrates: Counter-argument considered: "account creation before any value causes bounce." Resolution: browsing is unauthenticated (FR-007); sign-up wall appears only at the claim action. OAuth deferred to v2 to reduce v1 scope.

- FR-002: User can sign in and sign out. Priority: must-have
  > Socrates: Counter-argument considered: "sign-out is rarely used." Resolution: kept — simple to implement and necessary for shared-device scenarios.

- FR-015: New accounts must confirm their email address before the account is treated as verified. Priority: v2
  > Socrates: Counter-argument considered: "confirmation adds a step to the one flow that must not bounce (FR-001), and the claim wall already gates the only write a guest performs." Resolution: deferred to v2, not dropped — v1 accepts unverified addresses because a typo'd or someone else's address currently yields a working account, which becomes a real problem once FR-014's dashboard or any notification exists.
  >
  > Implementation constraints already discovered (F-01, `email-password-auth`):
  > - The `/auth/confirm` route handler already exists and works; it is dormant only because `enable_confirmations = false`. Verified end to end against the local stack.
  > - **Not a pure config flip.** Turning confirmations on requires simultaneously reverting the sign-up "already registered" copy in `src/app/actions/auth.ts` to a generic message, because Supabase deliberately obfuscates existing-user sign-up once confirmations are on — it returns a fake user object and no error, so the specific branch stops firing and sign-up silently reports success for an address that already exists.
  > - **Needs a real SMTP provider.** Hosted Supabase's built-in SMTP is capped at ~2 emails/hour, which is why confirmations were disabled for v1 in the first place. This FR is blocked on choosing and wiring one.
  > - Requires `NEXT_PUBLIC_SITE_URL` to be correct per environment, and the hosted project's Auth → URL Configuration to list every origin. Cloudflare preview URLs are per-deployment, so a single static value cannot be right for all previews.

- FR-016: Password rules are strengthened beyond a bare minimum length. Priority: v2
  > Socrates: Counter-argument considered: "stricter rules increase lockout risk, and v1 has no password reset — a forgotten password is a dead account." Resolution: this is exactly why it is v2 and not v1, and why it should land **after** or **with** a password-reset flow. Tightening credentials while the recovery path is missing trades one security problem for a support problem.
  >
  > Current state (F-01): minimum length 8, enforced in three places that must stay in sync — `PASSWORD_MIN_LENGTH` in `src/lib/auth/schemas.ts`, `minimum_password_length` in `supabase/config.toml` (local stack), and the hosted project's Auth → Policies setting (manual). No complexity or breach checks.
  >
  > Options, cheapest first:
  > - `password_requirements` in `supabase/config.toml` — supports `letters_digits`, `lower_upper_letters_digits`, `lower_upper_letters_digits_symbols`. Currently `""`.
  > - Leaked-password protection (Supabase checks candidates against HaveIBeenPwned). Materially better than composition rules at stopping real account takeover, and it does not punish long passphrases.
  > - Mirror whichever rule is chosen into the zod schema so the client-side message matches what the server enforces; a divergence means a password the app rejects is still accepted by a direct API call.
  >
  > Note: composition rules are weaker than length or breach checks by modern guidance (NIST SP 800-63B discourages mandated composition). Prefer raising the minimum length and adding breach checks over requiring symbols.

### Event management

- FR-003: Organizer can create an event with a name, a date, and an IANA timezone (defaulting to the organizer's browser timezone). The date must be today or later. Neither the date nor the timezone can change after creation. Priority: must-have *(amended 2026-09-11, F-02)*
  > Socrates: Counter-argument considered: "date is friction." Resolution: date is required because it is the automatic trigger for post-event mode (FR-011). Without it, a manual "close event" action would be needed. Required date is simpler. *(amended 2026-09-11, F-02)* The reveal instants (FR-011) are computed once from `event_date` and `timezone` at creation; letting either change afterward would let the organizer redefine the reveal after guests have already claimed under the original terms.

- FR-004: Organizer can add gift ideas to an event list (title; optional: notes, link, price range). The optional link must be an `http(s)` URL. Priority: must-have *(amended 2026-09-11, F-02)*
  > Socrates: Counter-argument considered: "title only for v1." Resolution: optional metadata kept — a product link and approximate price are the most useful signals for a gift-giver and worth the added form complexity.

- FR-005: Organizer can edit items on their event list. Priority: must-have
  > Socrates: Counter-argument considered: "removing items confuses guests." Resolution: deletion removed from v1 — edit only. Organizer can rename an item; deletion is v2.

- FR-006: Organizer can generate a shareable link for their event list. Priority: must-have

### Guest flow

- FR-007: Guest can browse an event's gift list via a shared link without signing in. Priority: must-have
  > Socrates: Resolution of FR-001 counter-argument — viewing is unauthenticated; auth is required only to claim.

- FR-008: Guest can claim one unclaimed item (requires sign-in). Claims close once the reveal opens (FR-011); the organizer cannot claim on their own event's items. Priority: must-have *(amended 2026-09-11, F-02)*
  > Socrates: Counter-argument considered: "unclaim is nice-to-have, so a claim is irreversible in v1." Resolution: accepted — organizer can edit the item as a workaround; irreversible claiming is acceptable for v1.

- FR-009: Guest can see which items are claimed (shown as "taken"; no claimer name visible to other guests). Priority: must-have

### Post-event confirmation

- FR-010: Either the guest who claimed an item or the organizer can mark it as "given" after the reveal opens (FR-011) — a single irreversible mark set by whichever party marks it first. Priority: must-have *(amended 2026-09-11, F-02, replaces "independently")*
  > Socrates: Counter-argument considered: "post-event engagement is low; guests won't return." Resolution: organizer can also confirm, so delivery tracking doesn't depend on the guest returning.

- FR-011: Organizer can see the full claim and "given" status for all items after the reveal opens; claim status, and claimer identity always, are hidden from the organizer before that. The reveal opens automatically at 00:00 on `event_date + 2` in the event's timezone, or the organizer can unlock it manually starting 00:00 on `event_date + 1`. Priority: must-have *(amended 2026-09-11, F-02)*
  > Socrates: Counter-argument considered: "organizer may want to peek early." Resolution: *(amended 2026-09-11, F-02, replaces "hard gate — no early unlock")* the organizer may unlock manually from `event_date + 1`, ahead of the automatic reveal at `event_date + 2`. Rationale (user): a determined organizer can already spoil the surprise with a second account, so a manual early unlock adds no new leak. The guarantee that actually matters — claimer identity is never revealed, before or after the reveal — is unaffected.

### Nice-to-have

- FR-012: Guest can unclaim their own item. Priority: nice-to-have
  > Socrates: Counter-argument considered: "unclaiming creates a coordination race condition." Resolution: risk accepted; kept as nice-to-have.

- FR-013: User claiming a second item in the same event is warned and must confirm. Priority: nice-to-have
  > Socrates: Counter-argument considered: "warning adds friction for legitimate multi-gift scenarios." Resolution: soft warning (not a block) is acceptable; kept as nice-to-have.

- FR-014: User can view a dashboard listing all events they organize and all events they attend, with direct access to each list. Priority: nice-to-have
  > Socrates: Counter-argument considered: "shared link is already the re-entry point." Resolution: link-only re-entry is acceptable for v1; dashboard is a UX convenience, kept as nice-to-have.

## Non-Functional Requirements

- A guest's claim action produces visible confirmation within 1 second as perceived by the user; no ambiguous pending state is left on screen.
- The organizer's view never exposes claim status, claimer identity, or claim counts before the event date — this guarantee holds under all conditions including concurrent updates, page refresh, and direct URL access.

## Business Logic

GIN enforces asymmetric visibility: guests coordinate gift-claiming openly among themselves, but the organizer is blind to all claim activity until the event date passes, at which point the full delivery picture is revealed.

The rule consumes two inputs the organizer provides: a list of gift ideas and an event date (with a timezone). Guests interact with the list in real time — seeing which items are available or taken — but that state is withheld from the organizer entirely. The gate lifts at the reveal: automatically at 00:00 on `event_date + 2` in the event's timezone, or earlier if the organizer unlocks manually from 00:00 on `event_date + 1`. From the reveal, the organizer sees the complete picture: what was claimed, and what was confirmed as given by the guest or by the organizer — but never who claimed what. *(amended 2026-09-11, F-02, replaces "On and after the event date")*

The rule is what separates GIN from a shared spreadsheet: the time-gated information asymmetry is enforced by the product, not by social convention.

## Access Control

Single user role: authenticated user. No permanent "guest" or "viewer" role.

- **Sign-up / sign-in**: email + password only for v1.
- **Browsing a shared list does not require an account**: an unauthenticated visitor who opens a shared link may view all items, but not their claimed/available status. Sign-in is required to see status, and to claim an item. *(amended 2026-09-11, F-02)*
- **All write interactions require authentication**: claiming gifts and confirming post-event delivery require a logged-in account.
- **No admin role in MVP**: every account has equal capabilities; there is no privileged operator or admin surface.

## Non-Goals

- **Personal idea-capture for others (Flow 3)**: building a running gift-idea profile for people in your life is explicitly out of v1 scope — the event coordination mechanic must prove value first.
- **Automatic gift suggestions**: no algorithm or AI generates gift ideas. All list content is manually curated by the organizer.
- **Online gift search / product catalogue integration**: organizers add ideas manually; a URL field is optional free-text, not a product-discovery feature.
- **OAuth login**: email + password only for v1. OAuth is a v2 enhancement once the core flow is proven.
- **Social graph / user connections**: no friend lists, no following, no ability to create lists for another user via an in-app relationship. Lists are shared via link only.
- **Collaborative list editing**: only the organizer who created the event can add or edit items. Sharing a link grants read + claim access to guests, not co-authoring rights.
- **Item deletion in v1**: organizers may edit items but not delete them — deletion is a v2 capability (Socratic resolution: prevents confusing guests who had an item in view).

## Open Questions

1. **What is the event lifecycle after post-event confirmation?** Can the organizer delete or archive an event once the post-event view has been seen? No FR or User Story covers event cleanup. Owner: user. Block: no (can be decided during implementation), but affects data retention expectations.

2. **Can a shared list link be revoked?** FR-006 covers generating a link but does not address whether the organizer can invalidate it (e.g. if shared by mistake). Owner: user. Block: no for v1 (links can be permanent for now), but a security-adjacent decision worth making explicitly before launch.
