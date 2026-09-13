import { beforeEach, describe, expect, it, vi } from "vitest";

// `getOwnedEvent` has three outcomes and they must stay distinguishable — same
// discipline as `shared-list.test.ts`'s `getSharedList` tests: a failed query
// is not the same as "no such event," which would otherwise render a
// database outage as "this event doesn't exist."

const fromMock = vi.fn();

vi.mock("next/server", () => ({ connection: vi.fn(async () => undefined) }));
vi.mock("@/utils/supabase/server", () => ({
  createClient: vi.fn(async () => ({ from: fromMock })),
}));

const { createEvent, addItem, updateItem, getOwnedEvent } = await import(
  "./owned-events"
);

type Response = { data: unknown; error: unknown };

/** A chainable Postgrest-query-builder stand-in that resolves to `response`
 * whichever method the code under test happens to await on last. */
function makeBuilder(response: Response) {
  const builder: Record<string, unknown> = {};
  const returnsBuilder = () => builder;
  builder.insert = vi.fn(returnsBuilder);
  builder.update = vi.fn(returnsBuilder);
  builder.select = vi.fn(returnsBuilder);
  builder.eq = vi.fn(returnsBuilder);
  builder.order = vi.fn(returnsBuilder);
  builder.single = vi.fn(() => Promise.resolve(response));
  builder.then = (
    resolve: (value: Response) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return builder;
}

beforeEach(() => {
  fromMock.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("createEvent", () => {
  it("returns the new event id on success", async () => {
    fromMock.mockReturnValue(
      makeBuilder({ data: { id: "e1" }, error: null }),
    );

    const result = await createEvent({
      name: "Birthday",
      eventDate: "2026-12-24",
      timezone: "Europe/Warsaw",
    });

    expect(result).toEqual({ ok: true, eventId: "e1" });
    expect(fromMock).toHaveBeenCalledWith("events");
  });

  it("maps a DAL error through mapRpcError", async () => {
    fromMock.mockReturnValue(
      makeBuilder({
        data: null,
        error: { code: "P0001", message: "invalid_timezone" },
      }),
    );

    const result = await createEvent({
      name: "Birthday",
      eventDate: "2026-12-24",
      timezone: "Mars/Olympus",
    });

    expect(result).toEqual({ ok: false, code: "invalid_timezone" });
  });
});

describe("addItem", () => {
  it("returns ok on success", async () => {
    fromMock.mockReturnValue(makeBuilder({ data: null, error: null }));

    const result = await addItem("e1", { title: "Ceramic mug" });

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith("items");
  });

  it("maps a DAL error through mapRpcError", async () => {
    fromMock.mockReturnValue(
      makeBuilder({ data: null, error: { code: "23514", message: "check" } }),
    );

    const result = await addItem("e1", { title: "Ceramic mug" });

    expect(result).toEqual({ ok: false, code: "unknown" });
  });
});

describe("updateItem", () => {
  it("returns ok on success", async () => {
    fromMock.mockReturnValue(
      makeBuilder({ data: { id: "i1" }, error: null }),
    );

    const result = await updateItem("i1", { title: "Ceramic mug" });

    expect(result).toEqual({ ok: true });
    expect(fromMock).toHaveBeenCalledWith("items");
  });

  it("maps a DAL error through mapRpcError", async () => {
    fromMock.mockReturnValue(
      makeBuilder({ data: null, error: { code: "23514", message: "check" } }),
    );

    const result = await updateItem("i1", { title: "Ceramic mug" });

    expect(result).toEqual({ ok: false, code: "unknown" });
  });
});

describe("getOwnedEvent", () => {
  function mockFrom(responses: { events: Response; items: Response }) {
    fromMock.mockImplementation((table: string) =>
      makeBuilder(responses[table as "events" | "items"]),
    );
  }

  it("returns not_found when both queries succeed but the event is absent", async () => {
    mockFrom({
      events: { data: [], error: null },
      items: { data: [], error: null },
    });

    expect(await getOwnedEvent("missing")).toEqual({ kind: "not_found" });
  });

  it("returns error — not not_found — when the event query fails", async () => {
    mockFrom({
      events: { data: null, error: { code: "08006", message: "down" } },
      items: { data: [], error: null },
    });

    expect(await getOwnedEvent("e1")).toEqual({
      kind: "error",
      code: "unknown",
    });
    expect(console.error).toHaveBeenCalled();
  });

  it("returns error when only the items query fails, even though the event resolved", async () => {
    mockFrom({
      events: {
        data: [
          {
            id: "e1",
            name: "Birthday",
            event_date: "2026-12-24",
            timezone: "Europe/Warsaw",
            share_token: "a".repeat(22),
            revealed_at: null,
            auto_reveal_at: "2099-01-01T00:00:00Z",
            unlockable_at: "2020-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
      items: { data: null, error: { code: "08006", message: "down" } },
    });

    expect(await getOwnedEvent("e1")).toEqual({
      kind: "error",
      code: "unknown",
    });
  });

  it("maps the event and items on success", async () => {
    mockFrom({
      events: {
        data: [
          {
            id: "e1",
            name: "Birthday",
            event_date: "2026-12-24",
            timezone: "Europe/Warsaw",
            share_token: "a".repeat(22),
            revealed_at: null,
            auto_reveal_at: "2099-01-01T00:00:00Z",
            unlockable_at: "2020-01-01T00:00:00Z",
          },
        ],
        error: null,
      },
      items: {
        data: [
          {
            id: "i1",
            title: "Ceramic mug",
            notes: null,
            link: null,
            price_range: null,
          },
        ],
        error: null,
      },
    });

    expect(await getOwnedEvent("e1")).toEqual({
      kind: "ok",
      event: {
        id: "e1",
        name: "Birthday",
        eventDate: "2026-12-24",
        timezone: "Europe/Warsaw",
        shareToken: "a".repeat(22),
        revealOpen: false,
        unlockable: true,
      },
      items: [
        {
          id: "i1",
          title: "Ceramic mug",
          notes: null,
          link: null,
          priceRange: null,
        },
      ],
    });
  });

  function eventWith(revealFields: {
    revealed_at: string | null;
    auto_reveal_at: string;
    unlockable_at?: string;
  }) {
    return {
      events: {
        data: [
          {
            id: "e1",
            name: "Birthday",
            event_date: "2026-12-24",
            timezone: "Europe/Warsaw",
            share_token: "a".repeat(22),
            unlockable_at: "2020-01-01T00:00:00Z",
            ...revealFields,
          },
        ],
        error: null,
      },
      items: { data: [], error: null },
    };
  }

  it("revealOpen is false when neither revealed_at nor auto_reveal_at has passed", async () => {
    mockFrom(
      eventWith({ revealed_at: null, auto_reveal_at: "2099-01-01T00:00:00Z" }),
    );

    const result = await getOwnedEvent("e1");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.revealOpen).toBe(false);
  });

  it("revealOpen is true when revealed_at is set", async () => {
    mockFrom(
      eventWith({
        revealed_at: "2020-01-01T00:00:00Z",
        auto_reveal_at: "2099-01-01T00:00:00Z",
      }),
    );

    const result = await getOwnedEvent("e1");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.revealOpen).toBe(true);
  });

  it("revealOpen is true when auto_reveal_at has passed", async () => {
    mockFrom(
      eventWith({ revealed_at: null, auto_reveal_at: "2020-01-01T00:00:00Z" }),
    );

    const result = await getOwnedEvent("e1");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.revealOpen).toBe(true);
  });

  // Pins agreement with private.reveal_open's `now() >= e.auto_reveal_at`
  // (inclusive) — a `>` here would silently disagree with the DB at the
  // exact reveal instant.
  it("revealOpen is true when auto_reveal_at exactly equals now", async () => {
    const now = "2026-06-01T12:00:00.000Z";
    vi.useFakeTimers().setSystemTime(new Date(now));
    mockFrom(eventWith({ revealed_at: null, auto_reveal_at: now }));

    const result = await getOwnedEvent("e1");
    vi.useRealTimers();

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.revealOpen).toBe(true);
  });

  it("unlockable is false before unlockable_at", async () => {
    mockFrom(
      eventWith({
        revealed_at: null,
        auto_reveal_at: "2099-01-01T00:00:00Z",
        unlockable_at: "2099-01-01T00:00:00Z",
      }),
    );

    const result = await getOwnedEvent("e1");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.unlockable).toBe(false);
  });

  it("unlockable is true after unlockable_at", async () => {
    mockFrom(
      eventWith({
        revealed_at: null,
        auto_reveal_at: "2099-01-01T00:00:00Z",
        unlockable_at: "2020-01-01T00:00:00Z",
      }),
    );

    const result = await getOwnedEvent("e1");
    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.unlockable).toBe(true);
  });

  // Pins agreement with private.unlock_event's `now() < v_unlockable_at`
  // (so `>=` is the unlockable instant) — a `>` here would silently disagree
  // with the DB at the exact boundary.
  it("unlockable is true when unlockable_at exactly equals now", async () => {
    const now = "2026-06-01T12:00:00.000Z";
    vi.useFakeTimers().setSystemTime(new Date(now));
    mockFrom(
      eventWith({
        revealed_at: null,
        auto_reveal_at: "2099-01-01T00:00:00Z",
        unlockable_at: now,
      }),
    );

    const result = await getOwnedEvent("e1");
    vi.useRealTimers();

    expect(result.kind).toBe("ok");
    expect(result.kind === "ok" && result.event.unlockable).toBe(true);
  });
});
