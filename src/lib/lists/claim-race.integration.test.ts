import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

import type { Database } from "@/utils/supabase/database.types";

import { mapRpcError } from "./errors";

// The one guarantee pgTAP can't express: a true multi-connection race on
// `claim_item`. pgTAP runs everything inside one transaction/session, so it
// can prove the unique index exists but not that concurrent HTTP callers
// actually collide on it. This hits the local Data API directly with 5 real
// connections (@supabase/supabase-js needs no service key — anon + RLS only,
// per CLAUDE.md's stack decision).
//
// Requires the local stack (`colima start && supabase start`) and
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, loaded from
// `.env.localdb` by `pnpm test:integration` (`dotenv -e .env.localdb`).

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ENV_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!ENV_READY) {
  console.warn(
    "[claim-race] Skipping: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "not set. Run `supabase start` and fill in .env.localdb, then use " +
      "`pnpm test:integration`.",
  );
}

const GUEST_COUNT = 5;

// Unique per run so repeated `pnpm test:integration` invocations against the
// same local stack (without an intervening `supabase db reset`) never collide
// on "already registered".
function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.com`;
}

async function signedInClient(email: string): Promise<SupabaseClient<Database>> {
  const client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

  const { error } = await client.auth.signUp({
    email,
    password: "password1234",
  });
  if (error) {
    throw error;
  }

  return client;
}

describe("claim_item concurrency", () => {
  it.skipIf(!ENV_READY)(
    "exactly one of 5 concurrent claims succeeds",
    async () => {
      const owner = await signedInClient(uniqueEmail("owner"));
      const guests = await Promise.all(
        Array.from({ length: GUEST_COUNT }, (_, index) =>
          signedInClient(uniqueEmail(`guest-${index}`)),
        ),
      );

      const eventDate = new Date();
      eventDate.setUTCDate(eventDate.getUTCDate() + 7);
      const eventDateStr = eventDate.toISOString().slice(0, 10);

      // `unlockable_at` / `auto_reveal_at` / `share_token` are NOT NULL with no
      // column DEFAULT — `private.events_guard` (the INSERT trigger) computes
      // them, and the column-level grant only covers (name, event_date,
      // timezone), so they must not appear in the payload. The generated
      // Insert type can't see past the trigger, hence the cast.
      const eventInsert = {
        name: "Race test",
        event_date: eventDateStr,
        timezone: "UTC",
      } as unknown as Database["public"]["Tables"]["events"]["Insert"];

      const { data: event, error: eventError } = await owner
        .from("events")
        .insert(eventInsert)
        .select()
        .single();
      if (eventError) throw eventError;

      const { data: item, error: itemError } = await owner
        .from("items")
        .insert({ event_id: event.id, title: "Contested gift" })
        .select()
        .single();
      if (itemError) throw itemError;

      const results = await Promise.all(
        guests.map((guest) =>
          guest.rpc("claim_item", { p_item_id: item.id }),
        ),
      );

      const winners = results.filter((result) => result.error === null);
      const losers = results.filter((result) => result.error !== null);

      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(GUEST_COUNT - 1);
      for (const loser of losers) {
        expect(mapRpcError(loser.error!)).toBe("already_taken");
      }

      const winnerIndex = results.findIndex((result) => result.error === null);
      const loserIndex = results.findIndex((result) => result.error !== null);
      const winnerGuest = guests[winnerIndex];
      const loserGuest = guests[loserIndex];

      const { data: ownerItems, error: ownerItemsError } = await owner.rpc(
        "get_shared_items",
        { p_token: event.share_token },
      );
      if (ownerItemsError) throw ownerItemsError;
      expect(ownerItems.find((row) => row.id === item.id)?.status).toBeNull();

      const { data: winnerItems, error: winnerItemsError } = await winnerGuest.rpc(
        "get_shared_items",
        { p_token: event.share_token },
      );
      if (winnerItemsError) throw winnerItemsError;
      expect(winnerItems.find((row) => row.id === item.id)?.status).toBe(
        "mine",
      );

      const { data: loserItems, error: loserItemsError } = await loserGuest.rpc(
        "get_shared_items",
        { p_token: event.share_token },
      );
      if (loserItemsError) throw loserItemsError;
      expect(loserItems.find((row) => row.id === item.id)?.status).toBe(
        "taken",
      );
    },
    30_000,
  );
});
