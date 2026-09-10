"use client";

import { useActionState, useState } from "react";

import { signIn } from "@/app/actions/auth";
// TYPE-ONLY on purpose. `schemas.ts` creates zod schemas at module scope, so a
// value import here would pull zod into the client bundle for no benefit — the
// validation it powers runs on the server. `import type` is erased at compile
// time, so nothing ships. Keep the initial state local for the same reason.
import type { FormState } from "@/lib/auth/schemas";

const INITIAL_STATE: FormState = { status: "idle" };

export function SignInForm({ next }: { next?: string }) {
  // React 19: `useActionState` comes from `react`, not `react-dom`. The third
  // tuple element is the pending flag.
  const [state, formAction, pending] = useActionState(signIn, INITIAL_STATE);

  // CONTROLLED ON PURPOSE — do not "simplify" these back to uncontrolled.
  // React 19 resets an uncontrolled form once its action completes, so every
  // validation error wiped what the user had typed and made them start over.
  // Holding the values in client state survives the round trip.
  //
  // The alternative — returning the submitted values in FormState and using
  // defaultValue — would echo the plaintext password back in the server
  // response body and into the DOM. Keeping it client-side avoids that.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errors = state.status === "error" ? state.errors : undefined;
  const message = state.status === "error" ? state.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {/* Threaded through so the action can return the user where they were
          headed. Validated server-side by safeReturnTo — never trusted here. */}
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {message ? (
        <p role="alert" className="text-small text-danger">
          {message}
        </p>
      ) : null}

      <div className="flex flex-col gap-1">
        <label htmlFor="email">Email</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          aria-invalid={errors?.email ? true : undefined}
          aria-describedby={errors?.email ? "email-error" : undefined}
          className="border-edge px-2 py-1"
        />
        {errors?.email ? (
          <p id="email-error" className="text-small text-danger">
            {errors.email[0]}
          </p>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors?.password ? true : undefined}
          aria-describedby={errors?.password ? "password-error" : undefined}
          className="border-edge px-2 py-1"
        />
        {errors?.password ? (
          <p id="password-error" className="text-small text-danger">
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className="border-edge px-3 py-1">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
