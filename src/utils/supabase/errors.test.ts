import { describe, expect, it } from "vitest";

import { isAuthUnavailableError } from "./errors";
import { apiAuthError, retryableAuthError } from "./test-errors";

// Oracle: an error is "unavailable" when Auth could not answer (network, 5xx),
// never when it answered "no" (4xx) — a wrong password must not read as an outage.
describe("isAuthUnavailableError", () => {
  it.each([
    ["network failure (status 0)", retryableAuthError(0)],
    ["502", retryableAuthError(502)],
    ["503", retryableAuthError(503)],
    ["504 gateway timeout", retryableAuthError(504)],
    ["5xx outside supabase-js's retryable list (safety net)", apiAuthError(505, "unexpected_failure")],
  ])("is true for %s", (_label, error) => {
    expect(isAuthUnavailableError(error)).toBe(true);
  });

  it.each([
    ["invalid credentials", apiAuthError(400, "invalid_credentials")],
    ["rate limit", apiAuthError(429, "over_request_rate_limit")],
    ["user already exists", apiAuthError(422, "user_already_exists")],
    ["forbidden", apiAuthError(403, "session_not_found")],
    ["null", null],
    ["undefined", undefined],
  ])("is false for %s", (_label, error) => {
    expect(isAuthUnavailableError(error)).toBe(false);
  });
});
