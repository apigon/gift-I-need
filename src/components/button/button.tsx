import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

type ButtonVariant = "primary" | "secondary";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-on-primary hover:bg-primary-hover",
  secondary: "bg-surface text-fg border border-edge",
};

export function Button({
  variant = "primary",
  pending = false,
  pendingLabel,
  type = "button",
  className,
  disabled,
  children,
  ...props
}: {
  variant?: ButtonVariant;
  pending?: boolean;
  pendingLabel?: string;
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      disabled={disabled || pending}
      aria-busy={pending || undefined}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-control px-3 py-1.5 text-body disabled:opacity-60",
        VARIANT_CLASS[variant],
        className,
      )}
      {...props}
    >
      {pending ? (
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none rounded-full border-2 border-current border-t-transparent"
        />
      ) : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
