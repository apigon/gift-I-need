"use client";

import { useState } from "react";

import { Button, Modal, Text } from "@/components";

export function ModalDemo() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        Open modal
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Sample modal">
        <div className="flex flex-col gap-4">
          <Text tone="muted">
            Tab cycles only within this dialog. Escape, a backdrop click, or
            the button below all close it.
          </Text>
          <Button
            variant="secondary"
            className="self-start"
            onClick={() => setOpen(false)}
          >
            Close
          </Button>
        </div>
      </Modal>
    </>
  );
}
