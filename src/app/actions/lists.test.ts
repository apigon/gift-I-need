import { beforeEach, describe, expect, it, vi } from "vitest";

// The first Server Action in the codebase with direct unit test coverage
// (events.ts/auth.ts have none). Pins two things: every ListErrorCode maps to
// the right guest-facing copy, and refresh() fires on every outcome — not
// only success — since the item's real status must come back regardless of
// why a claim attempt failed.

const claimItem = vi.fn();
const markGiven = vi.fn();
const unlockEvent = vi.fn();
const refresh = vi.fn();

vi.mock("@/lib/lists/shared-list", () => ({ claimItem, markGiven, unlockEvent }));
vi.mock("next/cache", () => ({ refresh }));

const { claimItemAction, markGivenAction, unlockEventAction } = await import(
  "./lists"
);

beforeEach(() => {
  claimItem.mockReset();
  markGiven.mockReset();
  unlockEvent.mockReset();
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

  it("resolves with the normal result when refresh() throws after a committed claim", async () => {
    claimItem.mockResolvedValue({ ok: true });
    refresh.mockImplementation(() => {
      throw new Error("refresh failed");
    });

    const result = await claimItemAction(
      "i1",
      { status: "idle" },
      new FormData(),
    );

    expect(result).toEqual({ status: "idle" });
  });
});

describe("markGivenAction", () => {
  it("returns idle and calls refresh() on success", async () => {
    markGiven.mockResolvedValue({ ok: true });

    const result = await markGivenAction(
      "i1",
      { status: "idle" },
      new FormData(),
    );

    expect(markGiven).toHaveBeenCalledWith("i1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "idle" });
  });

  it.each([
    "not_claimed",
    "not_permitted",
    "not_revealed",
    "item_not_found",
  ] as const)(
    "maps %s to the generic error message and does not call refresh()",
    async (code) => {
      markGiven.mockResolvedValue({ ok: false, code });

      const result = await markGivenAction(
        "i1",
        { status: "idle" },
        new FormData(),
      );

      expect(refresh).not.toHaveBeenCalled();
      expect(result).toEqual({
        status: "error",
        message: "Something went wrong. Please try again.",
      });
    },
  );

  it("resolves with the normal result when refresh() throws after a committed mark-given", async () => {
    markGiven.mockResolvedValue({ ok: true });
    refresh.mockImplementation(() => {
      throw new Error("refresh failed");
    });

    const result = await markGivenAction(
      "i1",
      { status: "idle" },
      new FormData(),
    );

    expect(result).toEqual({ status: "idle" });
  });
});

describe("unlockEventAction", () => {
  it("returns idle and calls refresh() on success", async () => {
    unlockEvent.mockResolvedValue({ ok: true });

    const result = await unlockEventAction(
      "e1",
      { status: "idle" },
      new FormData(),
    );

    expect(unlockEvent).toHaveBeenCalledWith("e1");
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ status: "idle" });
  });

  it("maps unlock_too_early to a specific message and does not call refresh()", async () => {
    unlockEvent.mockResolvedValue({ ok: false, code: "unlock_too_early" });

    const result = await unlockEventAction(
      "e1",
      { status: "idle" },
      new FormData(),
    );

    expect(refresh).not.toHaveBeenCalled();
    expect(result).toEqual({
      status: "error",
      message: "Try again after it opens.",
    });
  });

  it("maps an unexpected repeat-unlock error to the generic message", async () => {
    unlockEvent.mockResolvedValue({ ok: false, code: "event_not_found" });

    const result = await unlockEventAction(
      "e1",
      { status: "idle" },
      new FormData(),
    );

    expect(result).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });

  it("resolves with the normal result when refresh() throws after a committed unlock", async () => {
    unlockEvent.mockResolvedValue({ ok: true });
    refresh.mockImplementation(() => {
      throw new Error("refresh failed");
    });

    const result = await unlockEventAction(
      "e1",
      { status: "idle" },
      new FormData(),
    );

    expect(result).toEqual({ status: "idle" });
  });
});
