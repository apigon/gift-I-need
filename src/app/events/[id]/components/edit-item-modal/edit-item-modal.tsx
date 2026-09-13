"use client";

import { useActionState, useEffect, useState } from "react";

import { updateItem } from "@/app/actions/events";
import { Alert, Button, Input, Modal, notify } from "@/components";
// TYPE-ONLY on purpose — see the note in AddItemForm: a value import from
// `schemas.ts` would drag zod into the client bundle.
import type { FormState } from "@/lib/forms/form-state";
import type { EditItemFieldErrors } from "@/lib/lists/schemas";
import type { OwnedItem } from "@/lib/lists/types";

const INITIAL_STATE: FormState<EditItemFieldErrors> = { status: "idle" };

export function EditItemModal({
  item,
  open,
  onClose,
}: {
  item: OwnedItem;
  open: boolean;
  onClose: () => void;
}) {
  const updateItemForItem = updateItem.bind(null, item.id);
  const [state, formAction, pending] = useActionState(
    updateItemForItem,
    INITIAL_STATE,
  );

  const [title, setTitle] = useState(item.title);
  const [notes, setNotes] = useState(item.notes ?? "");
  const [link, setLink] = useState(item.link ?? "");
  const [priceRange, setPriceRange] = useState(item.priceRange ?? "");

  // Unlike AddItemForm, a successful save closes the modal instead of
  // resetting fields — there's no "add another" continuation here.
  // `useActionState` returns a fresh object reference on every resolution,
  // so `state !== INITIAL_STATE` distinguishes "just succeeded after a
  // submit" from the initial mount (which is also `status: "idle"` but must
  // not immediately close the modal the parent just opened).
  useEffect(() => {
    if (state.status === "idle" && state !== INITIAL_STATE) {
      notify.success("Item updated");
      onClose();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- onClose is intentionally omitted; it's a stable setter-derived callback and including it risks re-firing this effect on unrelated parent re-renders.
  }, [state]);

  const errors = state.status === "error" ? state.errors : undefined;
  const message = state.status === "error" ? state.message : undefined;

  return (
    <Modal open={open} onClose={onClose} title="Edit item">
      <form action={formAction} className="flex flex-col gap-4">
        {message ? <Alert tone="danger">{message}</Alert> : null}
        <Input
          id="edit-title"
          name="title"
          label="Title"
          required
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          error={errors?.title?.[0]}
          hint="Up to 200 characters."
        />
        <Input
          id="edit-notes"
          name="notes"
          label="Notes"
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
          error={errors?.notes?.[0]}
          hint="Optional. Up to 2000 characters."
        />
        <Input
          id="edit-link"
          name="link"
          label="Link"
          value={link}
          onChange={(event) => setLink(event.target.value)}
          error={errors?.link?.[0]}
          hint="Optional. Must start with http:// or https://."
        />
        <Input
          id="edit-priceRange"
          name="priceRange"
          label="Price range"
          value={priceRange}
          onChange={(event) => setPriceRange(event.target.value)}
          error={errors?.priceRange?.[0]}
          hint="Optional. Up to 50 characters."
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            pending={pending}
            pendingLabel="Saving…"
          >
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
