import type { EmailOtpType } from "@supabase/supabase-js";
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
// ⚠️ SECOND ITEM ON THAT CHECKLIST — the OTP branch below is a latent login-CSRF
// vector. Unlike PKCE, `verifyOtp({token_hash, type})` needs no code_verifier, so
// it will establish a session for ANYONE holding a valid token_hash. If an email
// template is ever switched to `{{ .TokenHash }}`, an attacker could lure a victim
// to `/auth/confirm?token_hash=<attacker's>&type=signup` and silently sign them
// into the ATTACKER's account — everything the victim then does lands in it.
// Not reachable today: confirmations are off, and the PKCE clients produce
// `?code=` links, never `token_hash`. Whoever enables confirmations must either
// keep the PKCE template or add CSRF protection (e.g. a state/nonce cookie set
// at sign-up and required here) before relying on the OTP branch.
//
// This is an HTTP surface rather than a Server Action because Supabase's email
// links are external clients that need a real URL to hit.

// Fixed destination for a failed confirmation. Not user-controlled: a bad or
// expired token must never steer where the visitor lands.
const CONFIRM_ERROR_REDIRECT = "/login?error=confirmation_failed";

// EmailOtpType is `'signup' | ... | (string & {})`, so TypeScript accepts ANY
// string and a bare cast would pass attacker-supplied junk straight into
// verifyOtp. Validate against the real set instead.
const EMAIL_OTP_TYPES = new Set<EmailOtpType>([
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
]);

function parseOtpType(value: string | null): EmailOtpType | null {
  return value !== null && EMAIL_OTP_TYPES.has(value) ? value : null;
}

export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const tokenHash = searchParams.get("token_hash");
  const type = parseOtpType(searchParams.get("type"));

  // The onward destination is attacker-influenceable (it rides in the emailed
  // link), so it goes through the same validator as every other return path.
  const next = safeReturnTo(searchParams.get("next"));

  // Generic on purpose — never echo Supabase's message, which distinguishes
  // "expired" from "invalid" and so leaks whether a token ever existed.
  const failure = NextResponse.redirect(new URL(CONFIRM_ERROR_REDIRECT, origin));

  const supabase = await createClient();

  // PKCE — THIS is the branch that actually fires for this stack. @supabase/ssr
  // 0.12.0 hardcodes `flowType: "pkce"` in both createServerClient and
  // createBrowserClient, so Supabase's /auth/v1/verify endpoint redirects here
  // with `?code=<uuid>` to be exchanged for a session. Checked first because a
  // PKCE link never carries token_hash.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      // The response body stays generic; the reason goes to the server log.
      // Without this a failed confirmation is undiagnosable — the user just
      // lands on /login with no indication of why.
      console.error("[auth/confirm] code exchange failed", {
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return failure;
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  // OTP fallback — `?token_hash=&type=`. Not produced while the clients use
  // PKCE, but this is the shape Supabase's own docs hand out, and an email
  // template switched to `{{ .TokenHash }}` would land here instead. Cheap to
  // support, and its absence would be a silent failure rather than an error.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (error) {
      // Mirrors the PKCE branch: generic to the caller, diagnosable in the log.
      console.error("[auth/confirm] otp verification failed", {
        type,
        code: error.code,
        status: error.status,
        message: error.message,
      });
      return failure;
    }
    return NextResponse.redirect(new URL(next, origin));
  }

  return failure;
}
