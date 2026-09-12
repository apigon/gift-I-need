// The contract every Server Action shaped for `useActionState` returns.
// Generic over the field-error shape so both auth and event/item forms can
// parametrize it — relocated here from `src/lib/auth/schemas.ts` once a
// second feature (S-01) needed the same shape.
//
// `status` discriminates so a form can tell "not submitted yet" from
// "submitted and came back clean" — without it, an idle form and a
// successful one are indistinguishable, and success normally ends in a
// redirect anyway.
export type FormState<TFieldErrors> =
  | { status: "idle" }
  | {
      status: "error";
      errors?: TFieldErrors;
      message?: string;
    };

export const initialFormState: FormState<never> = { status: "idle" };
