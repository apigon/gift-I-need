"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { claimItemAction } from "@/app/actions/lists";
import { Button, Modal, Text, notify } from "@/components";
import type { ItemStatus } from "@/lib/lists/types";

const INITIAL_STATE: Awaited<ReturnType<typeof claimItemAction>> = {
  status: "idle",
};

export function ClaimButton({
  itemId,
  itemTitle,
  itemStatus,
  token,
}: {
  itemId: string;
  itemTitle: string;
  itemStatus: ItemStatus | null;
  token: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const claimItemForItem = claimItemAction.bind(null, itemId);
  const [state, formAction, pending] = useActionState(
    claimItemForItem,
    INITIAL_STATE,
  );

  // Same `state !== INITIAL_STATE` idiom as EditItemModal: useActionState
  // returns a fresh object reference on every resolution, so this
  // distinguishes "just resolved after a submit" from the initial mount.
  useEffect(() => {
    if (state === INITIAL_STATE) return;

    // Closing the modal here (rather than optimistically on click) is the
    // point: per the plan's "state sequencing" note, it must stay open and
    // pending for the full round trip to claimItemAction.
    if (state.status === "idle") {
      notify.success("Claimed!");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- closes the modal only once the server has actually resolved the claim; see the comment above.
      setOpen(false);
      return;
    }

    notify.error(state.message);
    if (state.code === "not_authenticated") {
      router.push(`/login?next=/lists/${token}`);
      return;
    }
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/token are stable for this mount; including them risks re-firing on unrelated re-renders, matching EditItemModal's rationale for omitting onClose.
  }, [state]);

  // This component stays mounted for every item regardless of status (see
  // SharedItemList) rather than being conditionally rendered by the parent.
  // claimItemAction's refresh() re-fetches the item's real status on every
  // outcome — including errors, e.g. a race loser's status flips to "taken"
  // or a lapsed session's flips to null — and that refresh lands in the same
  // commit as the action's resolved state. If the parent gated this
  // component's presence on itemStatus === "available", that commit would
  // unmount it before its pending useEffect above could run, silently
  // swallowing the error toast/redirect. Gating the *visible trigger* here
  // instead (and keeping `open` render-blocking) keeps the fiber alive so
  // the effect always fires.
  if (itemStatus !== "available" && !open) {
    return null;
  }

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Claim
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Claim "${itemTitle}"?`}>
        <form action={formAction} className="flex flex-col gap-4">
          <Text tone="muted">
            Claiming is final — you won&apos;t be able to undo it later.
          </Text>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              pending={pending}
              pendingLabel="Claiming…"
            >
              Confirm
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}
