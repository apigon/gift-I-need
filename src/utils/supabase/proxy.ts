import { createServerClient } from "@supabase/ssr";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

// EDGE RUNTIME: this module runs as Edge middleware under OpenNext. `routes` is
// pure and import-safe here. Never import `@/lib/auth/schemas` — it pulls zod
// into the Edge bundle, which is why `src/lib/auth/` has no barrel index.
import { safeReturnTo } from "@/lib/auth/redirect";
import { isAuthEntryRoute, isPublicRoute } from "@/lib/auth/routes";

// Headers @supabase/ssr hands to `setAll` whenever it writes auth cookies, so a
// CDN never caches a Set-Cookie. Carried onto every response we return.
const CACHE_HEADERS = ["Cache-Control", "Expires", "Pragma"] as const;

/**
 * Carry the rotated auth cookies — and the no-store cache headers that come
 * with them — from the Supabase response onto a different response object.
 *
 * MUST be called for every response this function returns that is not
 * `supabaseResponse` itself. `NextResponse.redirect()` and `.json()` build NEW
 * responses that do not inherit those cookies — omitting this drops the session
 * mid-rotation, signing the user out on the very request meant to send them to
 * login, and can leave a half-rotated refresh token. It fails silently.
 */
function copyCookies(from: NextResponse, to: NextResponse) {
  from.cookies.getAll().forEach((cookie) => {
    to.cookies.set(cookie);
  });
  CACHE_HEADERS.forEach((name) => {
    const value = from.headers.get(name);
    if (value) to.headers.set(name, value);
  });
}

// Session-refresh helper invoked from `src/middleware.ts` (the deprecated
// convention, kept because OpenNext rejects Next 16's Node-runtime `proxy.ts`).
// Refreshes the Supabase auth token and writes the rotated cookies AND
// @supabase/ssr's no-store cache headers back onto the response — without the
// headers, Cloudflare could cache a Set-Cookie and sign users in as each other.
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
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
          Object.entries(headers).forEach(([name, value]) =>
            supabaseResponse.headers.set(name, value),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser() — it
  // refreshes the session and any logic in between can desync request/response
  // cookies. The route-protection check below therefore sits strictly AFTER
  // this call, which is also the only point where `user` is available.
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  // A failed getUser still fails closed below (`user` is null). But a network
  // failure or a Supabase 5xx is an OUTAGE, not a signed-out visitor — log it,
  // or it shows up only as a wave of unexplained redirects to /login.
  // Missing sessions and stale JWTs are normal and deliberately not logged.
  if (isAuthRetryableFetchError(error)) {
    console.error("[proxy] supabase getUser failed", error);
  }

  // Fail-closed route protection: everything not named in `isPublicRoute` needs
  // a session. This is a UX layer, not the security boundary — RLS remains the
  // real guarantee for data access.
  if (!user && !isPublicRoute(request.nextUrl.pathname)) {
    // Non-page requests must not be redirected. `NextResponse.redirect` defaults
    // to 307, which PRESERVES THE METHOD — a webhook POST or an expired-session
    // Server Action POST would be replayed against /login. API callers get a
    // 401 here: CLAUDE.md reserves app/api/ for webhooks and external clients,
    // and those callers cannot follow a redirect to an HTML login page anyway.
    // Page POSTs (Server Actions post to the page path, not /api/) are handled
    // below with a 303.
    if (request.nextUrl.pathname.startsWith("/api/")) {
      const unauthorized = NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
      copyCookies(supabaseResponse, unauthorized);
      return unauthorized;
    }

    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set(
      "next",
      request.nextUrl.pathname + request.nextUrl.search,
    );

    // 307 for navigations; 303 for anything else so a Server Action POST is
    // downgraded to a GET of /login instead of being replayed against it.
    const status =
      request.method === "GET" || request.method === "HEAD" ? 307 : 303;
    const redirectResponse = NextResponse.redirect(url, status);
    copyCookies(supabaseResponse, redirectResponse);
    return redirectResponse;
  }

  // Mirror image of the check above: someone who already has a session has no
  // use for the sign-in / sign-up forms. Send them where they were headed, or
  // home. `safeReturnTo` guarantees a same-origin path, so resolving it against
  // the request origin cannot escape the site.
  if (user && isAuthEntryRoute(request.nextUrl.pathname)) {
    const target = safeReturnTo(request.nextUrl.searchParams.get("next"));
    const redirectResponse = NextResponse.redirect(
      new URL(target, request.nextUrl.origin),
    );
    copyCookies(supabaseResponse, redirectResponse);
    return redirectResponse;
  }

  // IMPORTANT: return the supabaseResponse object as-is. If you build a new
  // response, copy over supabaseResponse.cookies first or sessions will break.
  return supabaseResponse;
}
