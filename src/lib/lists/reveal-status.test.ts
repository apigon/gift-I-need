import { describe, expect, it } from "vitest";

import { mergeOwnedItemsWithStatus } from "./reveal-status";
import type { OwnedItem, SharedItem } from "./types";

function ownedItem(overrides: Partial<OwnedItem> = {}): OwnedItem {
  return {
    id: "i1",
    title: "Ceramic mug",
    notes: null,
    link: null,
    priceRange: null,
    ...overrides,
  };
}

function sharedItem(overrides: Partial<SharedItem> = {}): SharedItem {
  return {
    id: "i1",
    title: "Ceramic mug",
    notes: null,
    link: null,
    priceRange: null,
    status: "available",
    ...overrides,
  };
}

describe("mergeOwnedItemsWithStatus", () => {
  it("gives every item a null status when the overlay is null", () => {
    const result = mergeOwnedItemsWithStatus([ownedItem()], null);

    expect(result).toEqual([{ ...ownedItem(), status: null }]);
  });

  it("overlays status by matching id", () => {
    const result = mergeOwnedItemsWithStatus(
      [ownedItem({ id: "i1" }), ownedItem({ id: "i2" })],
      [
        sharedItem({ id: "i1", status: "taken" }),
        sharedItem({ id: "i2", status: "given" }),
      ],
    );

    expect(result).toEqual([
      { ...ownedItem({ id: "i1" }), status: "taken" },
      { ...ownedItem({ id: "i2" }), status: "given" },
    ]);
  });

  it("treats a missing match as null instead of throwing", () => {
    const result = mergeOwnedItemsWithStatus(
      [ownedItem({ id: "i1" }), ownedItem({ id: "orphan" })],
      [sharedItem({ id: "i1", status: "available" })],
    );

    expect(result).toEqual([
      { ...ownedItem({ id: "i1" }), status: "available" },
      { ...ownedItem({ id: "orphan" }), status: null },
    ]);
  });
});
