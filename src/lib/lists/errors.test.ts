import { describe, expect, it } from "vitest";

import { mapRpcError, type ListErrorCode } from "./errors";

const P0001_KEYS: ListErrorCode[] = [
  "not_authenticated",
  "item_not_found",
  "event_not_found",
  "owner_cannot_claim",
  "claims_closed",
  "not_revealed",
  "not_claimed",
  "not_permitted",
  "unlock_too_early",
  "invalid_timezone",
  "event_date_in_past",
  "event_date_immutable",
];

describe("mapRpcError", () => {
  it.each(P0001_KEYS)("round-trips P0001 message %s", (key) => {
    expect(mapRpcError({ code: "P0001", message: key })).toBe(key);
  });

  it("maps 23505 to already_taken", () => {
    expect(
      mapRpcError({ code: "23505", message: "duplicate key value" }),
    ).toBe("already_taken");
  });

  it("maps 42501 to not_authenticated", () => {
    expect(mapRpcError({ code: "42501", message: "permission denied" })).toBe(
      "not_authenticated",
    );
  });

  it("maps an unknown P0001 message to unknown", () => {
    expect(mapRpcError({ code: "P0001", message: "some_new_error" })).toBe(
      "unknown",
    );
  });

  it("maps an unknown code to unknown", () => {
    expect(mapRpcError({ code: "99999", message: "whatever" })).toBe(
      "unknown",
    );
  });
});
