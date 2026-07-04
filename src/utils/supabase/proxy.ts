import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Session-refresh helper invoked from the root `proxy.ts` (Next.js 16 renamed
// the `middleware` convention to `proxy`). Refreshes the Supabase auth token and
// writes the rotated cookies back onto the response so @supabase/ssr's CDN
// cache-control headers take effect — without this, Cloudflare could cache a
// Set-Cookie and sign users in as each other.
export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser() — it
  // refreshes the session and any logic in between can desync request/response
  // cookies. No route-protection redirects yet: the scaffold has no protected
  // routes, and auth is enforced at the data layer via RLS.
  await supabase.auth.getUser();

  // IMPORTANT: return the supabaseResponse object as-is. If you build a new
  // response, copy over supabaseResponse.cookies first or sessions will break.
  return supabaseResponse;
}
