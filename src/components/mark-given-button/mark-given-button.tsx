"use client";

import { useActionState, useEffect } from "react";

import { markGivenAction } from "@/app/actions/lists";
import { initialFormState } from "@/lib/forms/form-state";

import { Alert } from "../alert/alert";
import { Button } from "../button/button";
import { notify } from "../toaster/toaster";

// Shared between the claiming guest's own 'mine' item (/lists/[token]) and
// the organizer's 'taken' item (/events/[id]) once the reveal is open — same
// action, same UI. Whichever party clicks first wins: mark_given is a single
// `UPDATE ... WHERE given_at IS NULL` statement, so the loser's click is a
// no-op success, not an error.
export function MarkGivenButton({ itemId }: { itemId: string }) {
  const markGivenForItem = markGivenAction.bind(null, itemId);
  const [state, formAction, pending] = useActionState(
    markGivenForItem,
    initialFormState,
  );

  // `state !== initialFormState` distinguishes "just resolved after a
  // submit" from the initial mount — useActionState returns a fresh object
  // reference on every resolution.
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
