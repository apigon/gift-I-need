import {
  isAuthRetryableFetchError,
  type AuthError,
} from "@supabase/supabase-js";

// Re-exports the `@supabase/supabase-js` value imports this project needs
// outside `src/utils/supabase/**`, so callers never import the package
// directly — see the "no-restricted-imports" guard in eslint.config.mjs.
export { isAuthRetryableFetchError };

/**
 * True when an Auth call failed because the service could not answer, as
 * opposed to answering "no". Wider than `isAuthRetryableFetchError`, which
 * supabase-js limits to network failures and 502/503/504 — a plain 500 from
 * GoTrue arrives as an ordinary API error and would otherwise read as a bad
 * password.
 */
export function isAuthUnavailableError(
  error: AuthError | null | undefined,
): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  return typeof error.status === "number" && error.status >= 500;
}
