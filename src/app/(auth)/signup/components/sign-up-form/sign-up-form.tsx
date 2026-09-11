"use client";

import { useActionState, useState } from "react";

import { signUp } from "@/app/actions/auth";
// TYPE-ONLY on purpose — see the note in the sibling sign-in form: a value
// import from `schemas.ts` would drag zod into the client bundle.
import type { FormState } from "@/lib/auth/schemas";
import { Alert, Button, Input } from "@/components";

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

      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Input
        id="email"
        name="email"
        label="Email"
        type="email"
        autoComplete="email"
        required
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        error={errors?.email?.[0]}
      />

      <Input
        id="password"
        name="password"
        label="Password"
        type="password"
        autoComplete="new-password"
        required
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        error={errors?.password?.[0]}
      />

      <Button
        type="submit"
        variant="primary"
        pending={pending}
        pendingLabel="Creating account…"
      >
        Create account
      </Button>
    </form>
  );
}
