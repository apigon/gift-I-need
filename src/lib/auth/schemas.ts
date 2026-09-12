import { z } from "zod";

import {
  initialFormState as sharedInitialFormState,
  type FormState as GenericFormState,
} from "@/lib/forms/form-state";

// Form validation schemas and the shared Server Action result shape.
//
// NOTE: this module imports zod and must NOT be imported into the middleware
// path. `redirect.ts` and `routes.ts` are the Edge-safe siblings; keeping them
// in separate modules (and giving this directory no barrel `index.ts`) is what
// stops zod being dragged into the Edge bundle. See CLAUDE.md and the plan's
// "Edge-runtime purity" note.

export const PASSWORD_MIN_LENGTH = 8;

// NOTE the ordering: trim BEFORE the email check, via `.pipe()`. Written the
// other way round (`z.email().trim()`) the trim is dead code — the email rule
// runs first and rejects "  user@example.com  " outright, so a padded value
// never gets normalised, it just fails. Verified against zod 4.5.4.
const emailField = z
  .string()
  .trim()
  .pipe(z.email({ message: "Enter a valid email address." }));

export const SignUpSchema = z.object({
  email: emailField,
  password: z.string().min(PASSWORD_MIN_LENGTH, {
    message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  }),
});

// Sign-in validates SHAPE ONLY — deliberately no length rule. An account
// created before the policy changed must still be able to sign in; applying the
// sign-up strength rule here would lock those users out with a validation error
// rather than letting Supabase decide.
export const SignInSchema = z.object({
  email: emailField,
  password: z.string().min(1, { message: "Enter your password." }),
});

export type AuthFieldErrors = {
  email?: string[];
  password?: string[];
};

// The contract Server Actions return to `useActionState`. Relocated to
// `src/lib/forms/form-state.ts` now that S-01's event/item forms are a second
// consumer of the same shape (per that file's own forward-note) — this alias
// keeps every existing import (`src/app/actions/auth.ts`, the two auth forms)
// working unchanged.
export type FormState = GenericFormState<AuthFieldErrors>;

export const initialFormState: FormState = sharedInitialFormState;
