import "server-only";
import { getOwnedEvent } from "./owned-events";
import { mergeOwnedItemsWithStatus, type OwnedItemWithStatus } from "./reveal-status";
import { getSharedList } from "./shared-list";
import type { ListErrorCode } from "./errors";
import type { OwnedEvent, SharedItem } from "./types";

// Owns the fetch-skip/merge/degrade orchestration `page.tsx` used to inline —
// see plan.md Phase 1.1. Calls no Supabase client / connection() of its own;
// those already live in getOwnedEvent/getSharedList.

export type OrganizerView =
  | {
      kind: "ok";
      event: OwnedEvent;
      items: OwnedItemWithStatus[];
      statusUnavailable: boolean;
    }
  | { kind: "not_found" }
  | { kind: "error"; code: ListErrorCode };

export async function getOrganizerView(eventId: string): Promise<OrganizerView> {
  const result = await getOwnedEvent(eventId);

  if (result.kind !== "ok") {
    return result;
  }

  const { event, items } = result;

  // Pre-reveal, status would only ever come back null anyway (see
  // private.get_shared_items's owner branch) — skip the RPC round trip
  // entirely rather than issue a call whose result is thrown away.
  let statusUnavailable = false;
  let sharedItems: SharedItem[] | null = null;

  if (event.revealOpen) {
    const sharedResult = await getSharedList(event.shareToken);
    if (sharedResult.kind === "ok") {
      sharedItems = sharedResult.items;
    } else {
      // Both "error" and the structurally-unreachable "not_found" (the
      // owner is reading their own already-validated share_token) degrade
      // the same way: render titles with a "couldn't load status" note
      // instead of failing the whole page.
      statusUnavailable = true;
    }
  }

  return {
    kind: "ok",
    event,
    items: mergeOwnedItemsWithStatus(items, sharedItems),
    statusUnavailable,
  };
}
