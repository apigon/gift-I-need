import "server-only";

import { connection } from "next/server";

import { createClient } from "@/utils/supabase/server";

import { mapRpcError } from "./errors";
import { isShareToken } from "./token";
import type { ItemStatus, ListResult, SharedListResult } from "./types";

// The single entry point S-02, S-03 and S-05 call for the shared list and its
// claim/given/unlock mutations. Never caches (both read RPCs are per-viewer —
// see supabase/migrations/20260911221653_shared_list_rpcs.sql) and never
// reads `public.claims` directly (there is no grant to; see the same file's
// header comment). No barrel `index.ts` — import this module directly.

export async function getSharedList(token: string): Promise<SharedListResult> {
  if (!isShareToken(token)) {
    return { kind: "not_found" };
  }

  await connection();
  const supabase = await createClient();

  const [eventResult, itemsResult] = await Promise.all([
    supabase.rpc("get_shared_event", { p_token: token }),
    supabase.rpc("get_shared_items", { p_token: token }),
  ]);

  const { data: eventRows, error: eventError } = eventResult;
  const { data: itemRows, error: itemsError } = itemsResult;

  // A failed RPC is not an absent list. Keep them apart so an outage can't
  // masquerade as a deleted list, and so the failure leaves a trace.
  const rpcError = eventError ?? itemsError;
  if (rpcError) {
    console.error("[shared-list] get_shared_* failed", rpcError);
    return { kind: "error", code: mapRpcError(rpcError) };
  }

  const eventRow = eventRows?.[0];
  if (!eventRow) {
    return { kind: "not_found" };
  }

  return {
    kind: "ok",
    event: {
      id: eventRow.id,
      name: eventRow.name,
      eventDate: eventRow.event_date,
      timezone: eventRow.timezone,
      revealOpen: eventRow.reveal_open,
      isOwner: eventRow.is_owner,
    },
    items: (itemRows ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      link: row.link,
      priceRange: row.price_range,
      status: row.status as ItemStatus | null,
    })),
  };
}

export async function claimItem(itemId: string): Promise<ListResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("claim_item", { p_item_id: itemId });

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true };
}

export async function markGiven(itemId: string): Promise<ListResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_given", { p_item_id: itemId });

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true };
}

export async function unlockEvent(eventId: string): Promise<ListResult> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("unlock_event", { p_event_id: eventId });

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true };
}
