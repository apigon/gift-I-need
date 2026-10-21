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
 * opposed to answering "no". supabase-js already raises
 * `AuthRetryableFetchError` for network failures, 500-504 and 520-530; the
 * `status >= 500` check is a safety net for any other 5xx (e.g. 505-519) that
 * would otherwise surface as an ordinary API error and read as a bad password.
 */
export function isAuthUnavailableError(
  error: AuthError | null | undefined,
): boolean {
  if (!error) return false;
  if (isAuthRetryableFetchError(error)) return true;
  return typeof error.status === "number" && error.status >= 500;
}
