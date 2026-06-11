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
- An unauthenticated visitor can see all items and their "taken"/"available" status without signing in
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
- Both the guest who claimed an item and the organizer can independently mark it as "given"

## Functional Requirements

### Authentication

- FR-001: User can create an account with email + password. Priority: must-have
  > Socrates: Counter-argument considered: "account creation before any value causes bounce." Resolution: browsing is unauthenticated (FR-007); sign-up wall appears only at the claim action. OAuth deferred to v2 to reduce v1 scope.

- FR-002: User can sign in and sign out. Priority: must-have
  > Socrates: Counter-argument considered: "sign-out is rarely used." Resolution: kept — simple to implement and necessary for shared-device scenarios.

### Event management

- FR-003: Organizer can create an event with a name and date. Priority: must-have
  > Socrates: Counter-argument considered: "date is friction." Resolution: date is required because it is the automatic trigger for post-event mode (FR-011). Without it, a manual "close event" action would be needed. Required date is simpler.

- FR-004: Organizer can add gift ideas to an event list (title; optional: notes, link, price range). Priority: must-have
  > Socrates: Counter-argument considered: "title only for v1." Resolution: optional metadata kept — a product link and approximate price are the most useful signals for a gift-giver and worth the added form complexity.

- FR-005: Organizer can edit items on their event list. Priority: must-have
  > Socrates: Counter-argument considered: "removing items confuses guests." Resolution: deletion removed from v1 — edit only. Organizer can rename an item; deletion is v2.

- FR-006: Organizer can generate a shareable link for their event list. Priority: must-have

### Guest flow

- FR-007: Guest can browse an event's gift list via a shared link without signing in. Priority: must-have
  > Socrates: Resolution of FR-001 counter-argument — viewing is unauthenticated; auth is required only to claim.

- FR-008: Guest can claim one unclaimed item (requires sign-in). Priority: must-have
  > Socrates: Counter-argument considered: "unclaim is nice-to-have, so a claim is irreversible in v1." Resolution: accepted — organizer can edit the item as a workaround; irreversible claiming is acceptable for v1.

- FR-009: Guest can see which items are claimed (shown as "taken"; no claimer name visible to other guests). Priority: must-have

### Post-event confirmation

- FR-010: Both the guest who claimed an item and the organizer can mark it as "given" after the event date passes. Priority: must-have
  > Socrates: Counter-argument considered: "post-event engagement is low; guests won't return." Resolution: organizer can also confirm, so delivery tracking doesn't depend on the guest returning.

- FR-011: Organizer can see the full claim and "given" status for all items after the event date has passed; claim status is hidden from the organizer before that date. Priority: must-have
  > Socrates: Counter-argument considered: "organizer may want to peek early." Resolution: hard gate — no early unlock. Surprise is a core guarantee; an escape hatch would undermine it.

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

The rule consumes two inputs the organizer provides: a list of gift ideas and an event date. Guests interact with the list in real time — seeing which items are available or taken — but that state is withheld from the organizer entirely. On and after the event date, the gate lifts and the organizer sees the complete picture: what was claimed, and what was confirmed as given by the guest or by the organizer themselves.

The rule is what separates GIN from a shared spreadsheet: the time-gated information asymmetry is enforced by the product, not by social convention.

## Access Control

Single user role: authenticated user. No permanent "guest" or "viewer" role.

- **Sign-up / sign-in**: email + password only for v1.
- **Browsing a shared list does not require an account**: an unauthenticated visitor who opens a shared link may view all items and their claimed/available status. Sign-in is required only to claim an item.
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
