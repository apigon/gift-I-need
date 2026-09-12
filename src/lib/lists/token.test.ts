import { describe, expect, it } from "vitest";

import { isShareToken } from "./token";

describe("isShareToken", () => {
  it("accepts a real 22-character token", () => {
    expect(isShareToken("A1b2C3d4E5f6G7h8I9j0-_")).toBe(true);
  });

  it("rejects 21 characters", () => {
    expect(isShareToken("A1b2C3d4E5f6G7h8I9j0-")).toBe(false);
  });

  it("rejects 23 characters", () => {
    expect(isShareToken("A1b2C3d4E5f6G7h8I9j0-_x")).toBe(false);
  });

  it.each(["+", "/", "="])("rejects a token containing %s", (char) => {
    // 22 characters total, so the rejection is due to the illegal character,
    // not the length.
    expect(isShareToken(`A1b2C3d4E5f6G7h8I9j0-${char}`)).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isShareToken("")).toBe(false);
  });
});
