import { createBrowserClient } from "@supabase/ssr";

// Browser (Client Component) Supabase client. Both values are public
// NEXT_PUBLIC_* vars inlined at build time; the anon key is safe in the bundle
// because all access is gated by RLS with the user's session (v1 decision:
// anon-key + RLS only, no service_role).
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
