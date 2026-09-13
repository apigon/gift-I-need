"use client";

import { useActionState, useEffect } from "react";

import { markGivenAction } from "@/app/actions/lists";
import { Alert, Button, notify } from "@/components";
import { initialFormState } from "@/lib/forms/form-state";

export function MarkGivenButton({ itemId }: { itemId: string }) {
  const markGivenForItem = markGivenAction.bind(null, itemId);
  const [state, formAction, pending] = useActionState(
    markGivenForItem,
    initialFormState,
  );

  // `state !== initialFormState` is the same idiom ClaimModal/EditItemModal
  // use: useActionState returns a fresh object reference on every
  // resolution, so this distinguishes "just resolved after a submit" from
  // the initial mount.
  useEffect(() => {
    if (state === initialFormState) return;
    if (state.status === "idle") {
      notify.success("Marked as given");
    }
  }, [state]);

  const message = state.status === "error" ? state.message : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="secondary"
        pending={pending}
        pendingLabel="Marking…"
        onClick={() => formAction(new FormData())}
      >
        Mark as given
      </Button>
      {message ? <Alert tone="danger">{message}</Alert> : null}
    </div>
  );
}
