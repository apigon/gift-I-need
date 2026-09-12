import type { SharedEvent, SharedItem } from "./types";

// Deliberately scans `items` for `status === null` rather than reading
// `event.revealOpen` directly: `revealOpen` alone can't tell "reveal hasn't
// happened" apart from "nothing to hide" on a zero-item list, which would
// show a stale organizer banner with nothing to explain. Do not "simplify"
// this to `!isOwner && !event.revealOpen` without re-adding an explicit
// `items.length > 0` guard.
export function getVisibilityBanner(
  event: Pick<SharedEvent, "isOwner">,
  items: Pick<SharedItem, "status">[],
): "organizer_hidden" | "guest_signed_out" | null {
  const hasHiddenItem = items.some((item) => item.status === null);

  if (!hasHiddenItem) {
    return null;
  }

  return event.isOwner ? "organizer_hidden" : "guest_signed_out";
}
