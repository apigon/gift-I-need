import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Per-request server Supabase client. Workers cannot reuse a connection across
// requests, so this MUST be created inside each call (never a module global).
// Uses the anon key + the user's cookie session, so RLS applies with auth.uid()
// — this is what enforces the organizer-blindness rule at the data layer.
// `cookies()` is async in Next.js 16.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Called from a Server Component, which cannot set cookies. Safe to
            // ignore: the proxy (updateSession) refreshes the session cookies.
          }
        },
      },
    },
  );
}
