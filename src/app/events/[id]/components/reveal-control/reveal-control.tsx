"use client";

import { useActionState, useEffect } from "react";

import { unlockEventAction } from "@/app/actions/lists";
import { Alert, Button, notify } from "@/components";
import { initialFormState } from "@/lib/forms/form-state";

// Visible only from event_date + 1 (event.unlockable) until the reveal opens
// (page.tsx gates rendering) — no confirmation dialog, per the plan
// interview; the button's presence is the only "you can open it early"
// signal. Label matches the guest-side banner's own wording ("Until the
// reveal opens…", visibility-banner.tsx) rather than the RPC's internal name
// (unlock_event) — "unlock" reads as a permissions action, not what this
// actually does (reveals claim status early).
export function RevealControl({ eventId }: { eventId: string }) {
  const unlockEventForEvent = unlockEventAction.bind(null, eventId);
  const [state, formAction, pending] = useActionState(
    unlockEventForEvent,
    initialFormState,
  );

  useEffect(() => {
    if (state === initialFormState) return;
    if (state.status === "idle") {
      notify.success("Reveal opened");
    }
  }, [state]);

  const message = state.status === "error" ? state.message : undefined;

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        variant="primary"
        pending={pending}
        pendingLabel="Opening…"
        onClick={() => formAction(new FormData())}
      >
        Open the reveal now
      </Button>
      {message ? <Alert tone="danger">{message}</Alert> : null}
    </div>
  );
}
