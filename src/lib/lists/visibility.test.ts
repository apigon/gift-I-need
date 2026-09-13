import { describe, expect, it } from "vitest";

import { getVisibilityBanner } from "./visibility";

describe("getVisibilityBanner", () => {
  it("returns organizer_hidden when the owner has at least one hidden item", () => {
    expect(
      getVisibilityBanner({ isOwner: true }, [{ status: null }]),
    ).toEqual("organizer_hidden");
  });

  it("returns guest_signed_out when a non-owner has at least one hidden item", () => {
    expect(
      getVisibilityBanner({ isOwner: false }, [{ status: null }]),
    ).toEqual("guest_signed_out");
  });

  it("returns null when every item already has a real status", () => {
    expect(
      getVisibilityBanner({ isOwner: false }, [{ status: "available" }]),
    ).toEqual(null);
  });

  it("returns null for the organizer once the reveal has opened (no hidden items)", () => {
    expect(
      getVisibilityBanner({ isOwner: true }, [
        { status: "taken" },
        { status: "given" },
      ]),
    ).toEqual(null);
  });

  it("returns null for a zero-item list regardless of ownership", () => {
    expect(getVisibilityBanner({ isOwner: true }, [])).toEqual(null);
    expect(getVisibilityBanner({ isOwner: false }, [])).toEqual(null);
  });
});
