import "server-only";

import { connection } from "next/server";

import { createClient } from "@/utils/supabase/server";

import { mapRpcError, type ListErrorCode } from "./errors";
import type { ListResult, OwnedEvent, OwnedItem } from "./types";

// The organizer-side sibling of `shared-list.ts` — the only place that
// reads/writes `public.events`/`public.items` for their owning organizer.
// Straight RLS-scoped reads/writes, not RPCs (unlike claims/reveal): the
// column-scoped grants from
// supabase/migrations/20260911211956_surprise_rule_schema.sql are what keep
// this safe. Same no-cache posture as `shared-list.ts` — this reads live
// data an organizer just wrote, so staleness would be confusing even though
// it's not a security issue. No barrel `index.ts`; import this module
// directly.

export async function createEvent(input: {
  name: string;
  eventDate: string;
  timezone: string;
}): Promise<{ ok: true; eventId: string } | { ok: false; code: ListErrorCode }> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .insert({
      name: input.name,
      event_date: input.eventDate,
      timezone: input.timezone,
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true, eventId: data.id };
}

export async function addItem(
  eventId: string,
  input: {
    title: string;
    notes?: string;
    link?: string;
    priceRange?: string;
  },
): Promise<ListResult> {
  const supabase = await createClient();

  const { error } = await supabase.from("items").insert({
    event_id: eventId,
    title: input.title,
    notes: input.notes ?? null,
    link: input.link ?? null,
    price_range: input.priceRange ?? null,
  });

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true };
}

export async function updateItem(
  itemId: string,
  input: {
    title: string;
    notes?: string;
    link?: string;
    priceRange?: string;
  },
): Promise<ListResult> {
  const supabase = await createClient();

  // `items_update_owner`'s USING clause scopes the match to
  // is_event_owner(event_id) with no error on a non-match — a non-owned or
  // stale itemId just matches 0 rows and Postgres reports success. .single()
  // is required (not just tidy) so a 0-row match surfaces as a PGRST116
  // error instead of a silent no-op false-positive.
  const { error } = await supabase
    .from("items")
    .update({
      title: input.title,
      notes: input.notes ?? null,
      link: input.link ?? null,
      price_range: input.priceRange ?? null,
    })
    .eq("id", itemId)
    .select("id")
    .single();

  if (error) {
    return { ok: false, code: mapRpcError(error) };
  }

  return { ok: true };
}

export async function getOwnedEvent(eventId: string): Promise<
  | { kind: "ok"; event: OwnedEvent; items: OwnedItem[] }
  | { kind: "not_found" }
  | { kind: "error"; code: ListErrorCode }
> {
  await connection();
  const supabase = await createClient();

  const [eventResult, itemsResult] = await Promise.all([
    supabase
      .from("events")
      .select("id, name, event_date, timezone, share_token, revealed_at, auto_reveal_at")
      .eq("id", eventId),
    supabase
      .from("items")
      .select("id, title, notes, link, price_range")
      .eq("event_id", eventId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
  ]);

  const { data: eventRows, error: eventError } = eventResult;
  const { data: itemRows, error: itemsError } = itemsResult;

  // A failed query is not the same as "no such event." Collapsing both into
  // not_found would render a database outage as "this event doesn't exist."
  const queryError = eventError ?? itemsError;
  if (queryError) {
    console.error("[owned-events] getOwnedEvent failed", queryError);
    return { kind: "error", code: mapRpcError(queryError) };
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
      shareToken: eventRow.share_token,
      // Mirrors private.reveal_open (supabase/migrations/20260911211956_surprise_rule_schema.sql:202-204:
      // `now() >= e.auto_reveal_at or e.revealed_at is not null`) — computed
      // here in JS against the already-fetched row rather than a second RPC
      // round trip. Keep the `>=` inclusive to match the SQL exactly; see the
      // boundary case in owned-events.test.ts. Only gates the Edit button's
      // visibility — the actual write is independently enforced by
      // items_update_owner's RLS check against the real private.reveal_open,
      // so drift here is cosmetic (button mismatch), never a claim-data leak.
      revealOpen:
        eventRow.revealed_at !== null ||
        Date.now() >= new Date(eventRow.auto_reveal_at).getTime(),
    },
    items: (itemRows ?? []).map((row) => ({
      id: row.id,
      title: row.title,
      notes: row.notes,
      link: row.link,
      priceRange: row.price_range,
    })),
  };
}
