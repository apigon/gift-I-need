import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiAuthError, retryableAuthError } from "@/utils/supabase/test-errors";

// Pins the user-facing copy for each Auth failure class. The regression this
// guards: an Auth outage (2026-10-19, gateway 504s) rendered as "Invalid email
// or password.", sending people to reset a password that was never wrong.

const signInWithPassword = vi.fn();
const signUp = vi.fn();
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/utils/supabase/server", () => ({
  createClient: async () => ({ auth: { signInWithPassword, signUp } }),
}));
vi.mock("next/navigation", () => ({ redirect }));

const { signIn, signUp: signUpAction } = await import("./auth");

const IDLE = { status: "idle" } as const;
const SIGN_IN_UNAVAILABLE = {
  status: "error",
  message: "Unavailable, sign-in is. Try again in a few minutes, you must.",
};
const SIGN_UP_UNAVAILABLE = {
  status: "error",
  message: "Unavailable, account creation is. Try again in a few minutes, you must.",
};

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const credentials = form({ email: "a@example.com", password: "correct-horse" });

beforeEach(() => {
  signInWithPassword.mockReset();
  signUp.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("signIn", () => {
  it.each([
    ["504 gateway timeout", retryableAuthError(504)],
    ["network failure", retryableAuthError(0)],
    ["plain 500", apiAuthError(500, "unexpected_failure")],
  ])("reports service unavailable on %s", async (_label, error) => {
    signInWithPassword.mockResolvedValue({ data: {}, error });

    expect(await signIn(IDLE, credentials)).toEqual(SIGN_IN_UNAVAILABLE);
  });

  it("keeps the generic credentials message for invalid_credentials", async () => {
    signInWithPassword.mockResolvedValue({
      data: {},
      error: apiAuthError(400, "invalid_credentials"),
    });

    expect(await signIn(IDLE, credentials)).toEqual({
      status: "error",
      message: "Invalid email or password.",
    });
  });

  it("redirects on success", async () => {
    signInWithPassword.mockResolvedValue({ data: {}, error: null });

    await expect(signIn(IDLE, credentials)).rejects.toThrow("NEXT_REDIRECT");
  });
});

describe("signUp", () => {
  it.each([
    ["504 gateway timeout", retryableAuthError(504)],
    ["plain 500", apiAuthError(500, "unexpected_failure")],
  ])("reports service unavailable on %s", async (_label, error) => {
    signUp.mockResolvedValue({ data: {}, error });

    expect(await signUpAction(IDLE, credentials)).toEqual(SIGN_UP_UNAVAILABLE);
  });

  it("still reports an already-registered email specifically", async () => {
    signUp.mockResolvedValue({
      data: {},
      error: apiAuthError(422, "user_already_exists"),
    });

    expect(await signUpAction(IDLE, credentials)).toEqual({
      status: "error",
      message: "That email is already registered. Try signing in instead.",
    });
  });

  it("keeps the generic message for other 4xx errors", async () => {
    signUp.mockResolvedValue({
      data: {},
      error: apiAuthError(429, "over_request_rate_limit"),
    });

    expect(await signUpAction(IDLE, credentials)).toEqual({
      status: "error",
      message: "Something went wrong. Please try again.",
    });
  });
});
