"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

import { Heading } from "../typography/typography";

// A controlled modal dialog built on the native <dialog> element —
// showModal() gives top-layer rendering, a built-in focus trap, and native
// Escape-to-close for free. <dialog>'s modal state is imperative, not a
// reactive attribute, so this component reconciles the `open` prop against
// showModal()/close() itself. Backdrop click and Escape both route through
// the dialog's own close() call, which fires the native `close` event below.
// A Cancel button inside `children` may instead call `onClose` directly
// (there's no ref exposed to reach the dialog from outside) — `onClose` can
// therefore fire twice for that path once the `open` prop catches up and
// this component's own close() call re-fires the native event. Keep
// `onClose` idempotent.
export function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.addEventListener("close", onClose);
    return () => dialog.removeEventListener("close", onClose);
  }, [onClose]);

  // `pointerdown` on `document`, not a `click` handler on the dialog itself —
  // unifies mouse, touch and pen the same way Combobox's outside-click
  // listener does. `event.target === dialogRef.current` still detects a
  // backdrop click specifically (a click inside the dialog's rendered content
  // box targets a child element instead), and still routes through the
  // dialog's own close() so the native `close` event stays the single place
  // `onClose` fires from.
  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (event.target === dialogRef.current) {
        dialogRef.current?.close();
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      className="m-auto max-w-md rounded-card border border-edge bg-surface p-6 backdrop:bg-overlay"
    >
      <Heading level={2} id={titleId} className="mb-4">
        {title}
      </Heading>
      {children}
    </dialog>
  );
}
