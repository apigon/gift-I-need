import { z } from "zod";

// Form validation schemas for the organizer's create-event and add-item
// forms. These mirror the DB CHECK constraints
// (supabase/migrations/20260911211956_surprise_rule_schema.sql) so the
// common-case validation error is a fast, specific client-visible message
// rather than a round trip to Postgres. The DB stays authoritative — these
// schemas narrow, they don't replace, `mapRpcError`.

export const CreateEventSchema = z.object({
  // Matches events_name_length: char_length(btrim(name)) between 1 and 120.
  name: z
    .string()
    .trim()
    .min(1, { message: "Enter a name for the event." })
    .max(120, { message: "Keep the name to 120 characters or fewer." }),
  // Non-empty only — "today or later" is enforced by the events_guard
  // trigger and surfaced via event_date_in_past.
  eventDate: z.string().min(1, { message: "Pick a date." }),
  // Non-empty only — actual IANA validity is the database trigger's job
  // (invalid_timezone); duplicating the full IANA list client-side would
  // drift from what Postgres actually accepts.
  timezone: z.string().min(1, { message: "Pick a timezone." }),
});

export type CreateEventInput = z.infer<typeof CreateEventSchema>;

export type CreateEventFieldErrors = {
  name?: string[];
  eventDate?: string[];
  timezone?: string[];
};

// An unfilled optional `<input>` submits "" via FormData, not undefined —
// preprocess it to undefined so the field's own `.optional()` schema is what
// actually decides whether it's allowed to be absent, and so the output type
// is `string | undefined` rather than leaking `""` through as a distinct value.
function emptyToUndefined(value: unknown) {
  return value === "" ? undefined : value;
}

export const AddItemSchema = z.object({
  // Matches items_title_length: char_length(btrim(title)) between 1 and 200.
  title: z
    .string()
    .trim()
    .min(1, { message: "Enter a title for the gift idea." })
    .max(200, { message: "Keep the title to 200 characters or fewer." }),
  // Matches items_notes_length: char_length(notes) <= 2000.
  notes: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2000, { message: "Keep notes to 2000 characters or fewer." })
      .optional(),
  ),
  // Matches items_link_format (http(s) only) and items_link_length (<= 2048).
  link: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(2048, { message: "Keep the link to 2048 characters or fewer." })
      .regex(/^https?:\/\//, {
        message: "Enter a link starting with http:// or https://.",
      })
      .optional(),
  ),
  // Matches items_price_range_length: char_length(price_range) <= 50.
  priceRange: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .max(50, { message: "Keep the price range to 50 characters or fewer." })
      .optional(),
  ),
});

export type AddItemInput = z.infer<typeof AddItemSchema>;

export type AddItemFieldErrors = {
  title?: string[];
  notes?: string[];
  link?: string[];
  priceRange?: string[];
};
