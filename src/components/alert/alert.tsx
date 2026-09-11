import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

type AlertTone = "danger" | "success" | "info";

const TONE_CONFIG: Record<
  AlertTone,
  { role: "alert" | "status"; className: string }
> = {
  danger: { role: "alert", className: "bg-danger-surface text-danger" },
  success: { role: "status", className: "bg-success-surface text-success" },
  info: { role: "status", className: "bg-surface-tint text-fg" },
};

export function Alert({
  tone,
  title,
  children,
}: {
  tone: AlertTone;
  title?: string;
  children: ReactNode;
}) {
  const { role, className } = TONE_CONFIG[tone];

  return (
    <div
      role={role}
      className={cn(
        "flex flex-col gap-1 rounded-control px-3 py-2 text-small",
        className,
      )}
    >
      {title ? <p className="font-bold">{title}</p> : null}
      <div>{children}</div>
    </div>
  );
}
