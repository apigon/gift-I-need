import { NextResponse } from "next/server";
import { createClient } from "@/utils/supabase/server";

// Smoke endpoint for the Phase 4 Workers preview + Phase 5 prod verify: proves
// the per-request Supabase server client and the cookie/session path round-trip
// under `workerd`. `authenticated` reflects whether a valid session is present;
// `ok` reports only that the Supabase call completed without throwing.
export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    return NextResponse.json({ ok: true, authenticated: Boolean(user) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
