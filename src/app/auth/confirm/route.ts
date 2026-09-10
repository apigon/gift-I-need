import { type EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { safeReturnTo } from "@/lib/auth/redirect";
import { createClient } from "@/utils/supabase/server";

// Exchanges the `token_hash` from a Supabase confirmation email for a session.
//
// DORMANT: `enable_confirmations = false`, so Supabase never sends the emails
// that link here. Shipped anyway so enabling confirmations in v2 is a config
// change rather than a code change. The path is already covered by the `/auth/`
// entry in the public allowlist.
//
// ⚠️ ENABLING CONFIRMATIONS IS NOT A PURE CONFIG FLIP. Whoever turns them on
// MUST simultaneously revert the sign-up "already registered" copy in
// `src/app/actions/auth.ts` back to the generic message. With confirmations ON,
// Supabase deliberately obfuscates an existing-user signup — returning a fake
// user object and no error, to prevent account enumeration — so that specific
// branch stops firing and sign-up silently reports success for an email that
// already exists.
//
// This is an HTTP surface rather than a Server Action because Supabase's email
// links are external clients that need a real URL to hit.

// Fixed destination for a failed confirmation. Not user-controlled: a bad or
// expired token must never steer where the visitor lands.
const CONFIRM_ERROR_REDIRECT = "/login?error=confirmation_failed";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;

  // The onward destination is attacker-influenceable (it rides in the emailed
  // link), so it goes through the same validator as every other return path.
  const next = safeReturnTo(searchParams.get("next"));

  if (!tokenHash || !type) {
    return NextResponse.redirect(
      new URL(CONFIRM_ERROR_REDIRECT, request.nextUrl.origin),
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Generic on purpose — do not echo Supabase's message, which distinguishes
    // "expired" from "invalid" and leaks whether a token ever existed.
    return NextResponse.redirect(
      new URL(CONFIRM_ERROR_REDIRECT, request.nextUrl.origin),
    );
  }

  return NextResponse.redirect(new URL(next, request.nextUrl.origin));
}
