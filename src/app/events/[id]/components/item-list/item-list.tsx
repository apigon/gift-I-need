import { Text } from "@/components";
import type { OwnedItem } from "@/lib/lists/types";

// Plain text, no StatusBadge — the organizer's own items carry no claim
// status by definition (the organizer-blindness rule applies to the guest
// side, not to this direct read).
export function ItemList({ items }: { items: OwnedItem[] }) {
  if (items.length === 0) {
    return <Text tone="muted">No gift ideas yet — add the first one below.</Text>;
  }

  return (
    <ul className="flex flex-col gap-3">
      {items.map((item) => (
        <li
          key={item.id}
          className="flex flex-col gap-1 rounded-card border border-edge bg-surface p-4"
        >
          <Text as="span">{item.title}</Text>
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
