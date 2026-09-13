"use client";

import { useState } from "react";

import { Button, Text } from "@/components";
import type { OwnedItem } from "@/lib/lists/types";

import { EditItemModal } from "../edit-item-modal/edit-item-modal";

// Plain text, no StatusBadge — the organizer's own items carry no claim
// status by definition (the organizer-blindness rule applies to the guest
// side, not to this direct read).
export function ItemList({ items }: { items: OwnedItem[] }) {
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const editingItem = items.find((item) => item.id === editingItemId);

  if (items.length === 0) {
    return <Text tone="muted">No gift ideas yet — add the first one below.</Text>;
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 rounded-card border border-edge bg-surface p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <Text as="span">{item.title}</Text>
              <Button
                variant="secondary"
                onClick={() => setEditingItemId(item.id)}
              >
                Edit
              </Button>
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

      {editingItem ? (
        <EditItemModal
          key={editingItem.id}
          item={editingItem}
          open={editingItemId !== null}
          onClose={() => setEditingItemId(null)}
        />
      ) : null}
    </>
  );
}
