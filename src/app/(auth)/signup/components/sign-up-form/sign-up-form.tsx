"use client";

import { useActionState, useState } from "react";

import { signUp } from "@/app/actions/auth";
// TYPE-ONLY on purpose — see the note in the sibling sign-in form: a value
// import from `schemas.ts` would drag zod into the client bundle.
import type { FormState } from "@/lib/auth/schemas";

const INITIAL_STATE: FormState = { status: "idle" };

export function SignUpForm({ next }: { next?: string }) {
  // React 19: `useActionState` comes from `react`, not `react-dom`.
  const [state, formAction, pending] = useActionState(signUp, INITIAL_STATE);

  // CONTROLLED ON PURPOSE — see the note in the sibling sign-in form. React 19
  // resets an uncontrolled form after its action completes, which wiped the
  // user's input on every validation error. Client state survives the round
  // trip without echoing the password back from the server.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const errors = state.status === "error" ? state.errors : undefined;
  const message = state.status === "error" ? state.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {message ? (
        <p role="alert" className="text-sm text-red-600">
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
          className="border px-2 py-1"
        />
        {errors?.email ? (
          <p id="email-error" className="text-sm text-red-600">
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
          autoComplete="new-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          aria-invalid={errors?.password ? true : undefined}
          aria-describedby={errors?.password ? "password-error" : undefined}
          className="border px-2 py-1"
        />
        {errors?.password ? (
          <p id="password-error" className="text-sm text-red-600">
            {errors.password[0]}
          </p>
        ) : null}
      </div>

      <button type="submit" disabled={pending} className="border px-3 py-1">
        {pending ? "Creating account…" : "Create account"}
      </button>
    </form>
  );
}
