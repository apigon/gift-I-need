"use client";

import { useActionState, useEffect, useState } from "react";

import { addItem } from "@/app/actions/events";
import { Alert, Button, Input } from "@/components";
// TYPE-ONLY on purpose — see the note in the auth forms: a value import from
// `schemas.ts` would drag zod into the client bundle.
import type { FormState } from "@/lib/forms/form-state";
import type { AddItemFieldErrors } from "@/lib/lists/schemas";

const INITIAL_STATE: FormState<AddItemFieldErrors> = { status: "idle" };

const INITIAL_ITEM_FIELDS = { title: "", notes: "", link: "", priceRange: "" };

export function AddItemForm({ eventId }: { eventId: string }) {
  const addItemForEvent = addItem.bind(null, eventId);
  const [state, formAction, pending] = useActionState(
    addItemForEvent,
    INITIAL_STATE,
  );

  const [title, setTitle] = useState(INITIAL_ITEM_FIELDS.title);
  const [notes, setNotes] = useState(INITIAL_ITEM_FIELDS.notes);
  const [link, setLink] = useState(INITIAL_ITEM_FIELDS.link);
  const [priceRange, setPriceRange] = useState(INITIAL_ITEM_FIELDS.priceRange);

  // `useActionState` returns a new `state` reference on every resolution,
  // including the initial mount (a harmless no-op there, since fields are
  // already at their initial values) and every successful `addItem` call —
  // "just succeeded" and "never submitted" both want the same reset, so no
  // separate success state is needed. The error guard skips the reset,
  // preserving the user's input to fix and resubmit.
  useEffect(() => {
    if (state.status !== "error") {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- resets the form to its initial values on mount and after a successful submit; see the comment above.
      setTitle(INITIAL_ITEM_FIELDS.title);
      setNotes(INITIAL_ITEM_FIELDS.notes);
      setLink(INITIAL_ITEM_FIELDS.link);
      setPriceRange(INITIAL_ITEM_FIELDS.priceRange);
    }
  }, [state]);

  const errors = state.status === "error" ? state.errors : undefined;
  const message = state.status === "error" ? state.message : undefined;

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {message ? <Alert tone="danger">{message}</Alert> : null}

      <Input
        id="title"
        name="title"
        label="Title"
        required
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        error={errors?.title?.[0]}
        hint="Up to 200 characters."
      />

      <Input
        id="notes"
        name="notes"
        label="Notes"
        value={notes}
        onChange={(event) => setNotes(event.target.value)}
        error={errors?.notes?.[0]}
        hint="Optional. Up to 2000 characters."
      />

      <Input
        id="link"
        name="link"
        label="Link"
        value={link}
        onChange={(event) => setLink(event.target.value)}
        error={errors?.link?.[0]}
        hint="Optional. Must start with http:// or https://."
      />

      <Input
        id="priceRange"
        name="priceRange"
        label="Price range"
        value={priceRange}
        onChange={(event) => setPriceRange(event.target.value)}
        error={errors?.priceRange?.[0]}
        hint="Optional. Up to 50 characters."
      />

      <Button
        type="submit"
        variant="primary"
        pending={pending}
        pendingLabel="Adding…"
      >
        Add item
      </Button>
    </form>
  );
}
