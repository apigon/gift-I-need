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

/**
 * Client-only. This module is `"use client"`, so importing `notify` into a Server
 * Component or Server Action compiles, then throws at runtime. Server Actions return
 * state; call `notify` from the client form that receives it.
 */
export const notify = {
  success(title: string, description?: string) {
    toast.success(title, { description });
  },
  error(title: string, description?: string) {
    toast.error(title, { description });
  },
};
