"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/lib/forms/form-state";
import { createEvent as insertEvent } from "@/lib/lists/owned-events";
import {
  CreateEventSchema,
  type CreateEventFieldErrors,
} from "@/lib/lists/schemas";

// Event/item Server Actions, shaped for `useActionState` — same contract as
// `src/app/actions/auth.ts`: parse `FormData` with zod, call the DAL, and
// `redirect()` outside any try/catch on success (see that module's note on
// why — `redirect()` throws NEXT_REDIRECT and a catch block would swallow
// it).

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Copy policy mirrors src/app/actions/auth.ts: specific messages only for
// codes the user can actually act on, generic for everything else.
const EVENT_ERROR_MESSAGES: Partial<Record<string, string>> = {
  invalid_timezone: "That doesn't look like a valid timezone.",
  event_date_in_past: "Pick today or a later date.",
};

export async function createEvent(
  _prevState: FormState<CreateEventFieldErrors>,
  formData: FormData,
): Promise<FormState<CreateEventFieldErrors>> {
  const parsed = CreateEventSchema.safeParse({
    name: formData.get("name"),
    eventDate: formData.get("eventDate"),
    timezone: formData.get("timezone"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      errors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const result = await insertEvent(parsed.data);

  if (!result.ok) {
    return {
      status: "error",
      message: EVENT_ERROR_MESSAGES[result.code] ?? GENERIC_ERROR,
    };
  }

  // Outside try/catch — see the note above.
  redirect(`/events/${result.eventId}`);
}
