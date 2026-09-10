"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { safeReturnTo } from "@/lib/auth/redirect";
import { SignInSchema, SignUpSchema, type FormState } from "@/lib/auth/schemas";
import { createClient } from "@/utils/supabase/server";

// Auth Server Actions, shaped for `useActionState`:
//   (prevState: FormState, formData: FormData) => Promise<FormState>
//
// Grouped by technical role rather than by feature — a deliberate exception to
// CLAUDE.md's feature-first rule, because `signOut` (Phase 3) is consumed by the
// header outside the `(auth)` group, and this is the Next-conventional location
// a reader looks in first. Revisit if this directory grows past a few files.

// Copy policy (planning decision):
//   - Sign-in failure is ALWAYS generic, whichever half was wrong. Telling an
//     attacker "wrong password" confirms the email exists.
//   - Sign-up with an existing email IS specific — a returning user needs that
//     signal, and v1 has no password reset to fall back on.
//   - Everything else is a generic form-level message. Raw Supabase strings are
//     diagnostics, not user-facing copy.
const GENERIC_SIGN_IN_ERROR = "Invalid email or password.";
const ALREADY_REGISTERED_ERROR =
  "That email is already registered. Try signing in instead.";
const GENERIC_ERROR = "Something went wrong. Please try again.";

// `formData.get` returns `FormDataEntryValue | null`, which includes File.
// Narrow to a string before it reaches `safeReturnTo`.
function readNext(formData: FormData): string | null {
  const value = formData.get("next");
  return typeof value === "string" ? value : null;
}

// Absolute URL of the confirmation handler, carrying the validated return path.
// Returns undefined when NEXT_PUBLIC_SITE_URL is unset, in which case Supabase
// falls back to the project's configured Site URL — the safe default, and why
// this does not throw. Dormant while confirmations are off.
function buildConfirmUrl(next: string | null): string | undefined {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return undefined;

  const url = new URL("/auth/confirm", siteUrl);
  url.searchParams.set("next", safeReturnTo(next));
  return url.toString();
}

export async function signIn(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = SignInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      errors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: GENERIC_SIGN_IN_ERROR };
  }

  // NOTE: `redirect()` throws NEXT_REDIRECT and must never sit inside a
  // try/catch — a catch block swallows it and the redirect silently does not
  // happen. That is why this module uses no try/catch at all.
  redirect(safeReturnTo(readNext(formData)));
}

export async function signUp(
  _prevState: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = SignUpSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      errors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      // Where a confirmation link points if confirmations are ever enabled.
      // Unused while they are off, but wrong-by-default otherwise: Supabase
      // would send people to the site root instead of the handler that
      // establishes their session.
      //
      // The origin comes from CONFIGURATION, never from the request. A Server
      // Action has no request object, and the alternative — reading the Host
      // header via await headers() — would let a caller influence the origin of
      // a link that gets emailed. Supabase's redirect allowlist limits the blast
      // radius but does not remove the class of problem.
      emailRedirectTo: buildConfirmUrl(readNext(formData)),
    },
  });

  if (error) {
    // COUPLED TO CONFIRMATIONS BEING OFF. With `enable_confirmations = false`,
    // Supabase returns an explicit already-exists error. Turn confirmations ON
    // and it deliberately obfuscates this to prevent account enumeration —
    // returning a fake user object and no error — so this branch stops firing
    // and sign-up silently "succeeds" for an existing email. Whoever enables
    // confirmations must revert this message to GENERIC_ERROR at the same time.
    const isAlreadyRegistered =
      error.code === "user_already_exists" ||
      error.code === "email_exists" ||
      /already registered/i.test(error.message);

    return {
      status: "error",
      message: isAlreadyRegistered ? ALREADY_REGISTERED_ERROR : GENERIC_ERROR,
    };
  }

  // Outside try/catch — see the note in `signIn`.
  redirect(safeReturnTo(readNext(formData)));
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();

  // Clear the session server-side — the same place middleware reads it. Signing
  // out from the browser client instead would leave the server cookies intact
  // until the next refresh, the client/server desync `proxy.ts` warns about.
  await supabase.auth.signOut();

  // Outside try/catch — see the note in `signIn`.
  redirect("/");
}
