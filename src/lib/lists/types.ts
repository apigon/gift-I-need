import type { BadgeStatus } from "@/components";

import type { ListErrorCode } from "./errors";

// The shared-list contract. `status: null` is the organizer-blindness state —
// see CLAUDE.md "Key business logic" — and is intentionally NOT part of
// `BadgeStatus`, which has no "hidden" variant (research.md).
export type ItemStatus = "available" | "taken" | "mine" | "given";

// Type-level assertion: every ItemStatus must render through StatusBadge.
// Written as an assignment, not as `ItemStatus extends BadgeStatus ? true :
// never` — that form is inert, because on divergence it simply evaluates to
// `never` and assigning `never` to a type alias is legal, so tsc stays silent.
// This form fails to compile the moment ItemStatus gains a member BadgeStatus
// does not have.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const _assertItemStatusIsBadgeStatus: BadgeStatus =
  null as unknown as ItemStatus;

export type SharedEvent = {
  id: string;
  name: string;
  eventDate: string;
  timezone: string;
  revealOpen: boolean;
  isOwner: boolean;
};

export type SharedItem = {
  id: string;
  title: string;
  notes: string | null;
  link: string | null;
  priceRange: string | null;
  status: ItemStatus | null;
};

// The owner's own direct read of an event/its items (owned-events.ts). Unlike
// SharedEvent/SharedItem, these carry the same shape as the underlying DB
// rows — including shareToken, since only the owner's own view needs to
// render the share link — but never a claim `status`, since the owner's own
// read has no concept of one (that's the organizer-blindness rule).
export type OwnedEvent = {
  id: string;
  name: string;
  eventDate: string;
  timezone: string;
  shareToken: string;
};

export type OwnedItem = {
  id: string;
  title: string;
  notes: string | null;
  link: string | null;
  priceRange: string | null;
};

export type ListResult = { ok: true } | { ok: false; code: ListErrorCode };

// A shared-list read has three outcomes, not two. Collapsing them into
// `null` would render "list not found" during a database outage — the same
// thing a deleted list shows, with nothing logged. `not_found` is reserved
// for the case where both RPCs SUCCEEDED and returned no event.
export type SharedListResult =
  | { kind: "ok"; event: SharedEvent; items: SharedItem[] }
  | { kind: "not_found" }
  | { kind: "error"; code: ListErrorCode };
