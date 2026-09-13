"use client";

import { useState } from "react";

import { StatusBadge, Text } from "@/components";
import type { SharedItem } from "@/lib/lists/types";

import { ClaimButton, ClaimModal } from "..";

// The page-level VisibilityBanner already explains a hidden status — no
// per-item explanation here, just omit the badge.
export function SharedItemList({
  items,
  token,
}: {
  items: SharedItem[];
  token: string;
}) {
  const [claimingItemId, setClaimingItemId] = useState<string | null>(null);
  const claimingItem = items.find((item) => item.id === claimingItemId);

  if (items.length === 0) {
    return <Text tone="muted">No gift ideas here yet.</Text>;
  }

  return (
    <>
      <ul className="flex flex-col gap-3">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex flex-col gap-1 rounded-card border border-edge bg-surface p-4"
          >
            <div className="flex items-center justify-between gap-2">
              <Text as="span">{item.title}</Text>
              <div className="flex items-center gap-2">
                {item.status !== null ? <StatusBadge status={item.status} /> : null}
                {item.status === "available" ? (
                  <ClaimButton onClick={() => setClaimingItemId(item.id)} />
                ) : null}
              </div>
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

      {claimingItem ? (
        <ClaimModal
          key={claimingItem.id}
          itemId={claimingItem.id}
          itemTitle={claimingItem.title}
          token={token}
          open={claimingItemId !== null}
          onClose={() => setClaimingItemId(null)}
        />
      ) : null}
    </>
  );
}
