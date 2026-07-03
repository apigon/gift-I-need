import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

// NOTE: This uses the deprecated `middleware` file convention (not Next.js 16's
// new `proxy.ts`) on purpose. `@opennextjs/cloudflare` (latest, 1.20.1) does not
// yet support Next.js 16 Node-runtime middleware: `proxy.ts` emits a Node
// middleware entry the adapter rejects ("Node.js middleware is not currently
// supported"), while the deprecated `middleware.ts` convention still emits an
// *Edge* middleware entry the adapter accepts — the only interim path to deploy
// on Workers while on Next 16. Tracked upstream: opennextjs-cloudflare#962.
// Revert to `proxy.ts` once the adapter supports Node middleware. Build-time
// cost is a single deprecation warning.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico and common image assets
     * Excluding these keeps auth/session logic from blocking asset loads.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
