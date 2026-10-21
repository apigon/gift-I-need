// Test-only factories for real supabase-js auth errors. They live here because
// only `src/utils/supabase/**` may import the package by value (eslint.config.mjs),
// and tests elsewhere need genuine instances: `isAuthRetryableFetchError` checks
// the error's brand, so a plain `{ status: 504 }` object would not exercise it.
import { AuthApiError, AuthRetryableFetchError } from "@supabase/supabase-js";

/** What supabase-js throws on a network failure (status 0) or 502/503/504. */
export function retryableAuthError(status = 504) {
  return new AuthRetryableFetchError("gateway timeout", status);
}

/** What supabase-js returns for any other HTTP error from GoTrue. */
export function apiAuthError(status: number, code: string) {
  return new AuthApiError(`error ${code}`, status, code);
}
