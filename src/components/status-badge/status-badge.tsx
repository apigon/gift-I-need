import { cn } from "@/lib/cn";

export type BadgeStatus = "available" | "taken" | "mine" | "given";

const DEFAULT_LABEL: Record<BadgeStatus, string> = {
  available: "Available",
  taken: "Taken",
  mine: "Claimed by you",
  given: "Given",
};

const STATUS_CLASS: Record<BadgeStatus, string> = {
  available: "bg-status-available-surface text-status-available",
  taken: "bg-status-taken-surface text-status-taken",
  mine: "bg-status-mine-surface text-status-mine",
  given: "bg-status-given-surface text-status-given",
};

export function StatusBadge({
  status,
  children,
}: {
  status: BadgeStatus;
  children?: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-small outline outline-1 outline-current",
        STATUS_CLASS[status],
      )}
    >
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {children ?? DEFAULT_LABEL[status]}
    </span>
  );
}
