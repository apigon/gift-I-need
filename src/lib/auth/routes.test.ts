import { describe, expect, it } from "vitest";

import { isPublicRoute } from "./routes";

describe("isPublicRoute", () => {
  it.each(["/", "/login", "/signup", "/auth/confirm", "/api/health", "/lists/abc"])(
    "returns true for %s",
    (pathname) => {
      expect(isPublicRoute(pathname)).toBe(true);
    },
  );

  it.each(["/events", "/events/new", "/auth/other", "/listsx", "/anything"])(
    "returns false for %s",
    (pathname) => {
      expect(isPublicRoute(pathname)).toBe(false);
    },
  );

  it("is public for /design-system under NODE_ENV=test", () => {
    expect(process.env.NODE_ENV).toBe("test");
    expect(isPublicRoute("/design-system")).toBe(true);
  });
});
