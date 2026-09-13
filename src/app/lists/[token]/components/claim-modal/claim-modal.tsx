"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";

import { claimItemAction } from "@/app/actions/lists";
import { Button, Modal, Text, notify } from "@/components";

const INITIAL_STATE: Awaited<ReturnType<typeof claimItemAction>> = {
  status: "idle",
};

export function ClaimModal({
  itemId,
  itemTitle,
  token,
  open,
  onClose,
}: {
  itemId: string;
  itemTitle: string;
  token: string;
  open: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
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

    if (state.status === "idle") {
      notify.success("Claimed!");
      onClose();
      return;
    }

    notify.error(state.message);
    if (state.code === "not_authenticated") {
      router.push(`/login?next=/lists/${token}`);
      return;
    }
    onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- router/token/onClose are stable for this mount; see EditItemModal's rationale for omitting onClose from effect deps.
  }, [state]);

  return (
    <Modal open={open} onClose={onClose} title={`Claim "${itemTitle}"?`}>
      <form action={formAction} className="flex flex-col gap-4">
        <Text tone="muted">
          Claiming is final — you won&apos;t be able to undo it later.
        </Text>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
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
  );
}
