// The public-route allowlist: every path an unauthenticated visitor may reach.
//
// The policy is FAIL-CLOSED — anything not named here is protected. That is the
// right default for a product whose whole point is a visibility guarantee, but
// it means this file is the single place where unauthenticated access widens.
//
// SECURITY: adding an entry here exposes that path to anonymous visitors. Treat
// every edit to this file as a security-relevant change and review it as one.
//
// NOT COVERED YET: well-known files served from the app root — `/robots.txt`,
// `/sitemap.xml`, `/manifest.webmanifest`, `/opengraph-image` — are not excluded
// by the middleware matcher (`src/middleware.ts:26`), which skips only
// `_next/static`, `_next/image`, `favicon.ico` and common image extensions.
// Whoever adds one of those files must allowlist it here, or signed-out
// visitors AND crawlers will be 307'd to `/login`.
//
// ALSO NOT GATED: that matcher skips ANY path ending in .svg/.png/.jpg/.jpeg/
// .gif/.webp — not only files in /public. A dynamic route requested as
// `/events/abc.png` never reaches `isPublicRoute` at all. Harmless while no
// route serves user data under an image-like URL (and RLS is the data boundary
// regardless); whoever adds such a route must narrow the matcher first.
//
// EDGE RUNTIME: imported by middleware, which runs on the Edge under OpenNext.
// Keep this module pure TypeScript — no Node built-ins, no `next/headers`, no
// Supabase imports, and in particular no zod (that is why `src/lib/auth/` has
// no barrel `index.ts`).

// Dev-only routes, allowlisted only outside production. `process.env.NODE_ENV`
// is inlined at build time (this module still ships no Node built-ins), so
// the production bundle never carries "/design-system" in the public set at
// all — defense in depth on top of that page's own `notFound()` call.
const DEV_ONLY_EXACT_PATHS: string[] =
  process.env.NODE_ENV === "production"
    ? []
    : [
        // Design-system showcase (F-03 Phase 3). Exact, not a prefix.
        "/design-system",
      ];

// Paths that are public only as an exact match.
const PUBLIC_EXACT_PATHS = new Set([
  "/",
  "/login",
  "/signup",
  "/api/health",
  // Supabase confirmation callback (Phase 5), reached by users who are by
  // definition not yet signed in. Exact, not an `/auth/` prefix, so a future
  // `/auth/*` route cannot become public without an edit here.
  "/auth/confirm",
  ...DEV_ONLY_EXACT_PATHS,
]);

// Prefixes whose entire subtree is public.
const PUBLIC_PREFIXES = [
  // FR-007: `create-and-share-event-list` (S-01) generates guest share links
  // under this prefix (`{site origin}/lists/<share_token>`); `browse-shared-list`
  // (S-02) is what will serve them. Guests must browse a shared list without
  // signing in, so this stays public.
  "/lists/",
];

// The credential entry points. A visitor who already has a session has no use
// for these, so the middleware bounces them away — the mirror image of the
// protection policy. Deliberately NOT the whole `/auth/` subtree: `/auth/confirm`
// must stay reachable while signed in, since a confirmation link can be followed
// by someone whose session is already established.
const AUTH_ENTRY_PATHS = new Set(["/login", "/signup"]);

/**
 * True when `pathname` is a sign-in / sign-up form that an already-authenticated
 * visitor should be redirected away from.
 */
export function isAuthEntryRoute(pathname: string): boolean {
  return AUTH_ENTRY_PATHS.has(pathname);
}

/**
 * True when `pathname` may be served to an unauthenticated visitor.
 *
 * Everything not matched here is protected by the middleware.
 */
export function isPublicRoute(pathname: string): boolean {
  if (PUBLIC_EXACT_PATHS.has(pathname)) {
    return true;
  }

  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}
