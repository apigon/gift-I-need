import type { BadgeStatus } from "@/components";

import type { ListErrorCode } from "./errors";

// The shared-list contract. `status: null` is the organizer-blindness state —
// see CLAUDE.md "Key business logic" — and is intentionally NOT part of
// `BadgeStatus`, which has no "hidden" variant (research.md).
export type ItemStatus = "available" | "taken" | "mine" | "given";

// Type-level assertion: every ItemStatus must render through StatusBadge.
type AssertItemStatusIsBadgeStatus = ItemStatus extends BadgeStatus
  ? true
  : never;
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _AssertItemStatusIsBadgeStatus = AssertItemStatusIsBadgeStatus;

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

export type ListResult = { ok: true } | { ok: false; code: ListErrorCode };
