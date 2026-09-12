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

const { createEvent, addItem, getOwnedEvent } = await import("./owned-events");

type Response = { data: unknown; error: unknown };

/** A chainable Postgrest-query-builder stand-in that resolves to `response`
 * whichever method the code under test happens to await on last. */
function makeBuilder(response: Response) {
  const builder: Record<string, unknown> = {};
  const returnsBuilder = () => builder;
  builder.insert = vi.fn(returnsBuilder);
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
});
