import { beforeEach, describe, expect, it, vi } from "vitest";

// `getSharedList` has three outcomes and they must stay distinguishable: an
// RPC failure previously returned the same `null` as an unknown token, so a
// database outage rendered "list not found" to every visitor with nothing
// logged. These tests pin the discrimination, not the mapping details.

const rpc = vi.fn();

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ rpc })),
}));

const { getSharedList } = await import("./shared-list");

const VALID_TOKEN = "abcdefghijklmnopqrstuv"; // 22 URL-safe chars

const eventRow = {
  id: "e1",
  name: "Birthday",
  event_date: "2026-12-01",
  timezone: "UTC",
  reveal_open: false,
  is_owner: true,
};

beforeEach(() => {
  rpc.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

/** Resolve `get_shared_event` and `get_shared_items` independently. */
function mockRpcs(event: unknown, items: unknown) {
  rpc.mockImplementation((fn: string) =>
    Promise.resolve(fn === "get_shared_event" ? event : items),
  );
}

describe("getSharedList", () => {
  it("returns not_found for a malformed token without touching the database", async () => {
    const result = await getSharedList("too-short");

    expect(result).toEqual({ kind: "not_found" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns not_found when both RPCs succeed but no event matches", async () => {
    mockRpcs({ data: [], error: null }, { data: [], error: null });

    expect(await getSharedList(VALID_TOKEN)).toEqual({ kind: "not_found" });
  });

  it("returns error — not not_found — when the event RPC fails", async () => {
    mockRpcs(
      { data: null, error: { code: "08006", message: "connection failure" } },
      { data: [], error: null },
    );

    const result = await getSharedList(VALID_TOKEN);

    expect(result).toEqual({ kind: "error", code: "unknown" });
    expect(console.error).toHaveBeenCalled();
  });

  it("returns error when only the items RPC fails, even though the event resolved", async () => {
    // Guards the subtler case: an items failure must never render as an
    // empty list, which reads to a guest as "everything is available".
    mockRpcs(
      { data: [eventRow], error: null },
      { data: null, error: { code: "08006", message: "connection failure" } },
    );

    expect(await getSharedList(VALID_TOKEN)).toEqual({
      kind: "error",
      code: "unknown",
    });
  });

  it("maps the event and items on success", async () => {
    mockRpcs(
      { data: [eventRow], error: null },
      {
        data: [
          {
            id: "i1",
            title: "Gift",
            notes: null,
            link: null,
            price_range: null,
            status: null,
          },
        ],
        error: null,
      },
    );

    expect(await getSharedList(VALID_TOKEN)).toEqual({
      kind: "ok",
      event: {
        id: "e1",
        name: "Birthday",
        eventDate: "2026-12-01",
        timezone: "UTC",
        revealOpen: false,
        isOwner: true,
      },
      items: [
        {
          id: "i1",
          title: "Gift",
          notes: null,
          link: null,
          priceRange: null,
          status: null,
        },
      ],
    });
  });
});
