"use client";

import { Toaster as SonnerToaster, toast } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-center"
      closeButton
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex items-center gap-3 rounded-card bg-surface px-4 py-3 text-small text-fg shadow ring-1 ring-hairline",
          title: "text-fg",
          description: "text-fg-muted",
          closeButton: "text-fg-muted",
        },
      }}
    />
  );
}

export const notify = {
  success(title: string, description?: string) {
    toast.success(title, { description });
  },
  error(title: string, description?: string) {
    toast.error(title, { description });
  },
};
