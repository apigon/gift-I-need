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
