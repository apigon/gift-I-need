import Link from "next/link";

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
// COST: getUser() revalidates the JWT against Supabase's /auth/v1/user endpoint
// rather than decoding a cookie locally, so mounting this in the root layout puts
// an auth-server round trip on every route's render path — and opts the whole app
// out of static rendering. Both accepted deliberately; see the plan's Performance
// Considerations. The escape hatch, if latency ever matters, is getClaims().

export async function AuthStatus() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <nav className="flex items-center gap-4 text-sm">
        <Link className="underline" href="/login">
          Sign in
        </Link>
        <Link className="underline" href="/signup">
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <div className="flex items-center gap-4 text-sm">
      <span>{user.email}</span>
      <form action={signOut}>
        <button type="submit" className="border px-2 py-1">
          Sign out
        </button>
      </form>
    </div>
  );
}
