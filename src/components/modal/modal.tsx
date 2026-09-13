"use client";

import type { ReactNode } from "react";
import { useEffect, useId, useRef } from "react";

import { Heading } from "../typography/typography";

// A controlled modal dialog built on the native <dialog> element —
// showModal() gives top-layer rendering, a built-in focus trap, and native
// Escape-to-close for free. <dialog>'s modal state is imperative, not a
// reactive attribute, so this component reconciles the `open` prop against
// showModal()/close() itself. Every close path (Cancel button inside
// `children`, backdrop click, Escape) routes through the dialog's own
// close() call, so the native `close` event is the single place `onClose`
// fires from — callers never call `onClose` directly.
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
