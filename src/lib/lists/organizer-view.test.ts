import { beforeEach, describe, expect, it, vi } from "vitest";

// Proves the fetch-skip/merge/degrade orchestration page.tsx used to inline —
// see plan.md Phase 1.1. Mocks getOwnedEvent/getSharedList/
// mergeOwnedItemsWithStatus the way lists.test.ts mocks shared-list.ts (the
// module, not the Supabase client) — those three already have their own
// DB-facing coverage.

const getOwnedEvent = vi.fn();
const getSharedList = vi.fn();
const mergeOwnedItemsWithStatus = vi.fn();

vi.mock("./owned-events", () => ({ getOwnedEvent }));
vi.mock("./shared-list", () => ({ getSharedList }));
vi.mock("./reveal-status", async () => {
  const actual = await vi.importActual<typeof import("./reveal-status")>(
    "./reveal-status",
  );
  return { ...actual, mergeOwnedItemsWithStatus };
});

const { getOrganizerView } = await import("./organizer-view");
const { mergeOwnedItemsWithStatus: realMerge } = await vi.importActual<
  typeof import("./reveal-status")
>("./reveal-status");

const ownedEvent = {
  id: "e1",
  name: "Birthday",
  eventDate: "2026-12-24",
  timezone: "Europe/Warsaw",
  shareToken: "a".repeat(22),
  revealOpen: false,
  unlockable: false,
};

const ownedItem = {
  id: "i1",
  title: "Ceramic mug",
  notes: null,
  link: null,
  priceRange: null,
};

beforeEach(() => {
  getOwnedEvent.mockReset();
  getSharedList.mockReset();
  mergeOwnedItemsWithStatus.mockReset();
});

describe("getOrganizerView", () => {
  it("passes through not_found without calling getSharedList", async () => {
    getOwnedEvent.mockResolvedValue({ kind: "not_found" });

    const result = await getOrganizerView("missing");

    expect(result).toEqual({ kind: "not_found" });
    expect(getSharedList).not.toHaveBeenCalled();
  });

  it("passes through error without calling getSharedList", async () => {
    getOwnedEvent.mockResolvedValue({ kind: "error", code: "unknown" });

    const result = await getOrganizerView("e1");

    expect(result).toEqual({ kind: "error", code: "unknown" });
    expect(getSharedList).not.toHaveBeenCalled();
  });

  it("skips getSharedList and nulls every status when revealOpen is false", async () => {
    getOwnedEvent.mockResolvedValue({
      kind: "ok",
      event: { ...ownedEvent, revealOpen: false },
      items: [ownedItem],
    });
    // Real merge, not a mock — pins the "skip-fetch always nulls" invariant
    // end-to-end within the unit test, per plan.md Phase 1.3.
    mergeOwnedItemsWithStatus.mockImplementation(realMerge);

    const result = await getOrganizerView("e1");

    expect(getSharedList).not.toHaveBeenCalled();
    expect(mergeOwnedItemsWithStatus).toHaveBeenCalledWith([ownedItem], null);
    expect(result).toEqual({
      kind: "ok",
      event: { ...ownedEvent, revealOpen: false },
      items: [{ ...ownedItem, status: null }],
      statusUnavailable: false,
    });
  });

  it("merges real shared items when revealOpen is true and getSharedList succeeds", async () => {
    const openEvent = { ...ownedEvent, revealOpen: true };
    const sharedItems = [
      {
        id: "i1",
        title: "Ceramic mug",
        notes: null,
        link: null,
        priceRange: null,
        status: "taken" as const,
      },
    ];
    getOwnedEvent.mockResolvedValue({
      kind: "ok",
      event: openEvent,
      items: [ownedItem],
    });
    getSharedList.mockResolvedValue({
      kind: "ok",
      event: {
        id: "e1",
        name: "Birthday",
        eventDate: "2026-12-24",
        timezone: "Europe/Warsaw",
        revealOpen: true,
        isOwner: true,
      },
      items: sharedItems,
    });
    mergeOwnedItemsWithStatus.mockReturnValue([
      { ...ownedItem, status: "taken" },
    ]);

    const result = await getOrganizerView("e1");

    expect(getSharedList).toHaveBeenCalledWith(openEvent.shareToken);
    expect(mergeOwnedItemsWithStatus).toHaveBeenCalledWith(
      [ownedItem],
      sharedItems,
    );
    expect(result).toEqual({
      kind: "ok",
      event: openEvent,
      items: [{ ...ownedItem, status: "taken" }],
      statusUnavailable: false,
    });
  });

  it.each(["error", "not_found"] as const)(
    "degrades with statusUnavailable when getSharedList returns %s",
    async (sharedKind) => {
      const openEvent = { ...ownedEvent, revealOpen: true };
      getOwnedEvent.mockResolvedValue({
        kind: "ok",
        event: openEvent,
        items: [ownedItem],
      });
      getSharedList.mockResolvedValue(
        sharedKind === "error"
          ? { kind: "error", code: "unknown" }
          : { kind: "not_found" },
      );
      mergeOwnedItemsWithStatus.mockReturnValue([
        { ...ownedItem, status: null },
      ]);

      const result = await getOrganizerView("e1");

      expect(mergeOwnedItemsWithStatus).toHaveBeenCalledWith(
        [ownedItem],
        null,
      );
      expect(result).toEqual({
        kind: "ok",
        event: openEvent,
        items: [{ ...ownedItem, status: null }],
        statusUnavailable: true,
      });
    },
  );
});
