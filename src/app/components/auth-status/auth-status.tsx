import { Button, Link, Text } from "@/components";

import { signOut } from "@/app/actions/auth";
import { createClient } from "@/utils/supabase/server";

// Server Component. No "use client" on purpose: the sign-out control is a plain
// form submit bound to a Server Action, so it works with JavaScript disabled.
//
// Lives here rather than in src/components/ because its only consumer is
// src/app/layout.tsx — the child-component rule in CLAUDE.md. `src/app/components/`
// is not a route: the App Router only treats page/route/layout files as routable,
// so this directory is inert.
//
// COST: getClaims() verifies the session JWT locally against the cached project
// JWKS (ES256), so this adds no /auth/v1/user round trip. The middleware
// (`src/utils/supabase/proxy.ts`) already runs the one getUser() per request —
// it validates the session server-side and refreshes the cookies before this
// renders — so a second getUser() here only doubled the load on Auth, which
// multiplied timeouts during the 2026-10-19 outage. Caveat: with a symmetric
// (HS256) JWT secret getClaims() falls back to a /user call, and the saving
// disappears. Mounting this in the root layout still opts the whole app out of
// static rendering; accepted deliberately, see the plan's Performance
// Considerations.

export async function AuthStatus() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (!claims) {
    return (
      <nav className="flex items-center gap-4 text-small">
        <Link href="/login">Sign in</Link>
        <Link href="/signup">Create account</Link>
      </nav>
    );
  }

  return (
    <div className="flex items-center gap-4">
      <Text variant="small" tone="muted">
        {claims.email}
      </Text>
      <form action={signOut}>
        <Button type="submit" variant="secondary">
          Sign out
        </Button>
      </form>
    </div>
  );
}
