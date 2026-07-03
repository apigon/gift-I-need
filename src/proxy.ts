import { type NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

// Next.js 16 Proxy (formerly `middleware`). Lives beside `app/` in `src/`.
// Runs on the Node.js runtime by default in v16.
export async function proxy(request: NextRequest) {
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
