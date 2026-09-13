import { StatusBadge, Text } from "@/components";
import type { SharedItem } from "@/lib/lists/types";

// The page-level VisibilityBanner already explains a hidden status — no
// per-item explanation here, just omit the badge.
export function SharedItemList({ items }: { items: SharedItem[] }) {
  if (items.length === 0) {
    return <Text tone="muted">No gift ideas here yet.</Text>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-1 rounded-card border border-edge bg-surface p-4"
        >
          <div className="flex items-center justify-between gap-2">
            <Text as="span">{item.title}</Text>
            {item.status !== null ? <StatusBadge status={item.status} /> : null}
          </div>
          {item.notes ? (
            <Text variant="small" tone="muted">
              {item.notes}
            </Text>
          ) : null}
          {item.link ? (
            <Text variant="small" tone="muted">
              {item.link}
            </Text>
          ) : null}
          {item.priceRange ? (
            <Text variant="small" tone="muted">
              {item.priceRange}
            </Text>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
