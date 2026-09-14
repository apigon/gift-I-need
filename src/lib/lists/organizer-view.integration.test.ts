import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import type { Database } from "@/utils/supabase/database.types";

// The one guarantee `organizer-view.test.ts`'s mocked unit tests can't give:
// that the *actual* getOrganizerView, wired to the *actual*
// getOwnedEvent/getSharedList/createClient() chain, never carries claim
// status pre-reveal after a real guest claim against the real local stack.
// See plan.md Phase 2 Overview — the unit tests already pin every branch in
// isolation; this proves the composition holds against live data, closing
// the exact gap research named ("the RPC nulling status is sufficient" must
// not be the only proof).
//
// Unlike claim-race.integration.test.ts, getOrganizerView cannot be called
// from a plain script: it transitively calls `connection()` (next/server)
// and, via @/utils/supabase/server's createClient(), `cookies()`
// (next/headers) — both throw "`x` was called outside a request scope"
// (confirmed against node_modules/next/dist/server/request/{cookies,
// connection}.js's throwForMissingRequestStore) when there is no live
// Next.js request, which a Vitest run never has. Neither primitive does
// anything meaningful outside an actual request, so both are stubbed here —
// the same spirit as vitest.config.mts's existing `server-only` alias stub.
// Real Supabase auth/RLS is never mocked; only Next's own request-scope
// enforcement is bypassed.
vi.mock("next/server", () => ({ connection: async () => undefined }));

// In-memory stand-in for the request's cookie jar. Populated for real below
// by @supabase/ssr's own createServerClient sign-in flow (signInOrganizer),
// so the exact chunked/base64url session encoding the app's real
// createClient() (server.ts) expects is produced by the library itself, not
// reverse-engineered by hand.
const cookieJar = new Map<string, string>();

vi.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => Array.from(cookieJar, ([name, value]) => ({ name, value })),
    set: (name: string, value: string) => {
      if (value) {
        cookieJar.set(name, value);
      } else {
        cookieJar.delete(name);
      }
    },
  }),
}));

const { getOrganizerView } = await import("./organizer-view");

// Requires the local stack (`colima start && supabase start`) and
// NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY, loaded from
// `.env.localdb` by `pnpm test:integration` (`dotenv -e .env.localdb`).
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const ENV_READY = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

if (!ENV_READY) {
  console.warn(
    "[organizer-view] Skipping: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY " +
      "not set. Run `supabase start` and fill in .env.localdb, then use " +
      "`pnpm test:integration`.",
  );
}

function uniqueEmail(label: string): string {
  return `${label}-${crypto.randomUUID()}@example.com`;
}

// Signs a fresh organizer in through @supabase/ssr's own createServerClient
// (not the plain supabase-js client claim-race uses), bound to `jar`. Every
// call the returned client makes — including the events/items inserts below
// — carries this session, and the SIGNED_IN write lands the real session
// cookie(s) in `jar` via the library's own setAll, so getOrganizerView's
// internal createClient() (reading the same jar through the mocked
// cookies() above) authenticates as this exact user.
async function signInOrganizer(
  email: string,
  jar: Map<string, string>,
): Promise<SupabaseClient<Database>> {
  const client = createServerClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    cookies: {
      getAll: () => Array.from(jar, ([name, value]) => ({ name, value })),
      setAll: (cookiesToSet) => {
        cookiesToSet.forEach(({ name, value }) => {
          if (value) {
            jar.set(name, value);
          } else {
            jar.delete(name);
          }
        });
      },
    },
  });

  const { data, error } = await client.auth.signUp({
    email,
    password: "password1234",
  });
  if (error) {
    throw error;
  }
  // signUp has three outcomes, not two (context/foundation/lessons.md): with
  // confirmations on it returns no session AND no error. Without this check
  // getOrganizerView would silently read as an unauthenticated caller.
  if (!data.session) {
    throw new Error(
      `signUp returned no session for ${email} — is enable_confirmations on in supabase/config.toml?`,
    );
  }

  return client;
}

async function signedInGuest(email: string) {
  const client = createClient<Database>(SUPABASE_URL!, SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });

  const { data, error } = await client.auth.signUp({
    email,
    password: "password1234",
  });
  if (error) {
    throw error;
  }
  if (!data.session) {
    throw new Error(
      `signUp returned no session for ${email} — is enable_confirmations on in supabase/config.toml?`,
    );
  }

  return client;
}

describe("getOrganizerView", () => {
  it.skipIf(!ENV_READY)(
    "never carries claim status pre-reveal after a real guest claim",
    async () => {
      const organizer = await signInOrganizer(
        uniqueEmail("organizer"),
        cookieJar,
      );
      const guest = await signedInGuest(uniqueEmail("guest"));

      // event_date 7 days out keeps auto_reveal_at (and so revealOpen) in
      // the future for the whole test — this is a pre-reveal proof, not a
      // reveal-clock one (plan.md "What We're NOT Doing").
      const eventDate = new Date();
      eventDate.setUTCDate(eventDate.getUTCDate() + 7);
      const eventDateStr = eventDate.toISOString().slice(0, 10);

      const { data: event, error: eventError } = await organizer
        .from("events")
        .insert({ name: "Pre-reveal test", event_date: eventDateStr, timezone: "UTC" })
        .select()
        .single();
      if (eventError) throw eventError;

      const { data: item, error: itemError } = await organizer
        .from("items")
        .insert({ event_id: event.id, title: "Contested gift" })
        .select()
        .single();
      if (itemError) throw itemError;

      const { error: claimError } = await guest.rpc("claim_item", {
        p_item_id: item.id,
      });
      if (claimError) throw claimError;

      const view = await getOrganizerView(event.id);

      expect(view.kind).toBe("ok");
      if (view.kind !== "ok") return;

      expect(view.statusUnavailable).toBe(false);
      expect(view.items.find((row) => row.id === item.id)?.status).toBeNull();
    },
    30_000,
  );
});
