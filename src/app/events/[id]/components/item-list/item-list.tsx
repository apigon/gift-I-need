"use client";

import { useState } from "react";

import { Button, MarkGivenButton, StatusBadge, Text } from "@/components";
import type { OwnedItemWithStatus } from "@/lib/lists/reveal-status";

import { EditItemModal } from "..";

// Once revealed, the Edit button is replaced by the real claim status
// (StatusBadge) plus a "Mark as given" control on `taken` items — `mine`
// never occurs here (owner_cannot_claim blocks self-claims), and `available`
// items get only the badge, nothing to act on.
export function ItemList({
  items,
  revealOpen,
  statusUnavailable,
}: {
  items: OwnedItemWithStatus[];
  revealOpen: boolean;
  statusUnavailable: boolean;
}) {
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
              {revealOpen ? (
                statusUnavailable ? (
                  <Text variant="small" tone="muted">
                    Couldn&apos;t load claim status — try refreshing
                  </Text>
                ) : (
                  <div className="flex items-center gap-2">
                    {item.status !== null ? (
                      <StatusBadge status={item.status} />
                    ) : null}
                    {item.status === "taken" ? (
                      <MarkGivenButton itemId={item.id} />
                    ) : null}
                  </div>
                )
              ) : (
                <Button
                  variant="secondary"
                  onClick={() => setEditingItemId(item.id)}
                >
                  Edit
                </Button>
              )}
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
