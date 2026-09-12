"use client";

import { useActionState, useEffect, useState } from "react";

import { createEvent } from "@/app/actions/events";
import { Alert, Button, Combobox, Input, type ComboboxOption } from "@/components";
// TYPE-ONLY on purpose — see the note in the auth forms: a value import from
// `schemas.ts` would drag zod into the client bundle.
import type { FormState } from "@/lib/forms/form-state";
import type { CreateEventFieldErrors } from "@/lib/lists/schemas";

const INITIAL_STATE: FormState<CreateEventFieldErrors> = { status: "idle" };

// The IANA zone list is static — the same on every server and every visitor
// (unlike the visitor's OWN detected zone below), so it's computed once at
// module load with no hydration concern and no need to re-derive per render.
const TIMEZONE_OPTIONS: ComboboxOption[] =
  typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone").map((zone) => ({
        value: zone,
        label: zone,
      }))
    : [];

function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return "UTC";
  }
}

function todayLocalDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function CreateEventForm() {
  const [state, formAction, pending] = useActionState(
    createEvent,
    INITIAL_STATE,
  );

  const [name, setName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [showTimezonePicker, setShowTimezonePicker] = useState(false);

  // The visitor's OWN timezone/local date genuinely differ between the
  // server render and this browser, so they can only be read after mount —
  // seeded to a safe default for the first (server-matching) render, then
  // corrected once the client knows better.
  const [timezone, setTimezone] = useState("UTC");
  const [today, setToday] = useState<string | undefined>(undefined);

  useEffect(() => {
    // Client-only detection: the real timezone/local date are only
    // knowable after mount, and only need to be read once.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimezone(detectTimezone());
    setToday(todayLocalDateString());
  }, []);

  const errors = state.status === "error" ? state.errors : undefined;
  const message = state.status === "error" ? state.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Input
        id="name"
        name="name"
        label="Event name"
        required
        value={name}
        onChange={(event) => setName(event.target.value)}
        error={errors?.name?.[0]}
        hint="Up to 120 characters."
      />

      <Input
        id="eventDate"
        name="eventDate"
        label="Event date"
        type="date"
        min={today}
        required
        value={eventDate}
        onChange={(event) => setEventDate(event.target.value)}
        error={errors?.eventDate?.[0]}
      />

      {showTimezonePicker && TIMEZONE_OPTIONS.length > 0 ? (
        <Combobox
          id="timezone"
          name="timezone"
          label="Timezone"
          options={TIMEZONE_OPTIONS}
          value={timezone}
          onChange={setTimezone}
          error={errors?.timezone?.[0]}
        />
      ) : (
        <div className="flex flex-col gap-1">
          <span className="text-small text-fg">Timezone</span>
          <div className="flex items-center gap-3">
            <span className="text-body text-fg">{timezone}</span>
            {TIMEZONE_OPTIONS.length > 0 ? (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setShowTimezonePicker(true)}
              >
                Change timezone
              </Button>
            ) : null}
          </div>
          <input type="hidden" name="timezone" value={timezone} />
          {errors?.timezone?.[0] ? (
            <span className="text-small text-danger">
              {errors.timezone[0]}
            </span>
          ) : null}
        </div>
      )}

      <Button
        type="submit"
        variant="primary"
        pending={pending}
        pendingLabel="Creating event…"
      >
        Create event
      </Button>
    </form>
  );
}
