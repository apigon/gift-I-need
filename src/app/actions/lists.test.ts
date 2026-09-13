import { beforeEach, describe, expect, it, vi } from "vitest";

// The first Server Action in the codebase with direct unit test coverage
// (events.ts/auth.ts have none). Pins two things: every ListErrorCode maps to
// the right guest-facing copy, and refresh() fires on every outcome — not
// only success — since the item's real status must come back regardless of
// why a claim attempt failed.

const claimItem = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/lists/shared-list", () => ({ claimItem }));
vi.mock("next/cache", () => ({ refresh }));

const { claimItemAction } = await import("./lists");

beforeEach(() => {
  claimItem.mockReset();
  refresh.mockReset();
});

describe("claimItemAction", () => {
  it("returns idle and calls refresh() on success", async () => {
    claimItem.mockResolvedValue({ ok: true });

    const result = await claimItemAction(
      "i1",
      { status: "idle" },
      new FormData(),
    );

    expect(claimItem).toHaveBeenCalledWith("i1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "idle" });
  });

  it.each([
    ["already_taken", "Someone else already claimed this gift."],
    ["claims_closed", "Claiming has closed for this event."],
    ["owner_cannot_claim", "You can't claim items on your own list."],
    ["not_authenticated", "Please sign in to claim this gift."],
    ["item_not_found", "Something went wrong. Please try again."],
  ] as const)(
    "maps %s to the correct error state and still calls refresh()",
    async (code, message) => {
      claimItem.mockResolvedValue({ ok: false, code });

      const result = await claimItemAction(
        "i1",
        { status: "idle" },
        new FormData(),
      );

      expect(refresh).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "error", code, message });
    },
  );
});
