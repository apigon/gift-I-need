import { describe, expect, it } from "vitest";

import { SignInSchema, SignUpSchema } from "./schemas";

describe("SignUpSchema", () => {
  it("trims and accepts a padded email", () => {
    const result = SignUpSchema.safeParse({
      email: "  user@example.com  ",
      password: "password1",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects a malformed email", () => {
    const result = SignUpSchema.safeParse({
      email: "not-an-email",
      password: "password1",
    });

    expect(result.success).toBe(false);
  });

  it("rejects a 7-character password", () => {
    const result = SignUpSchema.safeParse({
      email: "user@example.com",
      password: "1234567",
    });

    expect(result.success).toBe(false);
  });
});

describe("SignInSchema", () => {
  it("trims and accepts a padded email", () => {
    const result = SignInSchema.safeParse({
      email: "  user@example.com  ",
      password: "x",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.email).toBe("user@example.com");
    }
  });

  it("rejects a malformed email", () => {
    const result = SignInSchema.safeParse({
      email: "not-an-email",
      password: "x",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a 1-character password", () => {
    const result = SignInSchema.safeParse({
      email: "user@example.com",
      password: "x",
    });

    expect(result.success).toBe(true);
  });
});
