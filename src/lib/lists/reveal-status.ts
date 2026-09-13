import type { ItemStatus, OwnedItem, SharedItem } from "./types";

// Pure data composition for the organizer's post-reveal status view. Depends
// on both owned-events.ts's and shared-list.ts's types but calls neither —
// see plan.md Phase 1.2 for why this lives apart from both modules.

export type OwnedItemWithStatus = OwnedItem & { status: ItemStatus | null };

export function mergeOwnedItemsWithStatus(
  ownedItems: OwnedItem[],
  sharedItems: SharedItem[] | null,
): OwnedItemWithStatus[] {
  const statusById = new Map(
    (sharedItems ?? []).map((item) => [item.id, item.status]),
  );

  return ownedItems.map((item) => ({
    ...item,
    // A missing match (should not happen once the item set is frozen
    // post-reveal — see plan.md's Key Discoveries) is treated as `null`
    // rather than thrown.
    status: statusById.get(item.id) ?? null,
  }));
}
