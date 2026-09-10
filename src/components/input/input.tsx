import type { InputHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export function Input({
  id,
  label,
  error,
  hint,
  className,
  ...props
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  className?: string;
} & InputHTMLAttributes<HTMLInputElement>) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className={cn("text-small", error ? "text-danger" : "text-fg")}>
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          "rounded-control border bg-surface px-2 py-1 text-body text-fg",
          error ? "border-danger" : "border-edge",
        )}
        {...props}
      />
      {hint ? (
        <span id={hintId} className="text-small text-fg-muted">
          {hint}
        </span>
      ) : null}
      {error ? (
        <span id={errorId} className="text-small text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
