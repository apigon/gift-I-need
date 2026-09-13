"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/lib/forms/form-state";
import {
  addItem as insertItem,
  createEvent as insertEvent,
  updateItem as updateItemRow,
} from "@/lib/lists/owned-events";
import {
  AddItemSchema,
  CreateEventSchema,
  EditItemSchema,
  type AddItemFieldErrors,
  type CreateEventFieldErrors,
  type EditItemFieldErrors,
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

export async function addItem(
  eventId: string,
  _prevState: FormState<AddItemFieldErrors>,
  formData: FormData,
): Promise<FormState<AddItemFieldErrors>> {
  const parsed = AddItemSchema.safeParse({
    title: formData.get("title"),
    notes: formData.get("notes"),
    link: formData.get("link"),
    priceRange: formData.get("priceRange"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      errors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const result = await insertItem(eventId, parsed.data);

  if (!result.ok) {
    return { status: "error", message: GENERIC_ERROR };
  }

  // No redirect: the organizer stays on the page to add more items. Server
  // Actions do NOT automatically re-render the invoking Server Component on
  // completion — `refresh()` (next/cache, Next.js 16) is what re-runs
  // `getOwnedEvent` and gets the new item into `ItemList`. Returning to idle
  // (rather than a distinct "success" state) is deliberate — see the
  // field-clearing note in AddItemForm, which treats idle and just-succeeded
  // as the same "reset every field" case.
  refresh();
  return { status: "idle" };
}

export async function updateItem(
  itemId: string,
  _prevState: FormState<EditItemFieldErrors>,
  formData: FormData,
): Promise<FormState<EditItemFieldErrors>> {
  const parsed = EditItemSchema.safeParse({
    title: formData.get("title"),
    notes: formData.get("notes"),
    link: formData.get("link"),
    priceRange: formData.get("priceRange"),
  });

  if (!parsed.success) {
    return {
      status: "error",
      errors: z.flattenError(parsed.error).fieldErrors,
    };
  }

  const result = await updateItemRow(itemId, parsed.data);

  if (!result.ok) {
    return { status: "error", message: GENERIC_ERROR };
  }

  // Same contract as addItem: refresh() re-runs getOwnedEvent, idle signals
  // "just succeeded" to the caller (EditItemModal closes on idle).
  refresh();
  return { status: "idle" };
}
