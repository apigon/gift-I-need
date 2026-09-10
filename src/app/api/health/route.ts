import { NextResponse } from "next/server";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import { createClient } from "@/utils/supabase/server";

// Smoke endpoint for the Phase 4 Workers preview + Phase 5 prod verify: proves
// the per-request Supabase server client and the cookie/session path round-trip
// under `workerd`. `authenticated` reflects whether a valid session is present;
// `ok` is false (503) when Supabase cannot be reached or answers with a 5xx.
// A missing or stale session is not a failure — it is `authenticated: false`.
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();

    // getUser reports failures in `error`; it does not throw (lessons.md).
    if (isAuthRetryableFetchError(error)) {
      console.error("[health] supabase unreachable", error);
      return NextResponse.json({ ok: false }, { status: 503 });
    }

    return NextResponse.json({ ok: true, authenticated: Boolean(user) });
  } catch (error) {
    // This route is on the public allowlist (`src/lib/auth/routes.ts`), so this
    // body is readable by anyone, signed in or not. Never return the raw error:
    // a Supabase misconfiguration surfaces internal hostnames and config detail
    // to an anonymous caller. Log it instead — `wrangler tail` and the Workers
    // Observability tab are how this project reads production errors
    // (`context/changes/deployment/deployment-plan.md:203`).
    console.error("[health] supabase getUser failed", error);

    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
