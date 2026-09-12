// Re-exports the `@supabase/supabase-js` value imports this project needs
// outside `src/utils/supabase/**`, so callers never import the package
// directly — see the "no-restricted-imports" guard in eslint.config.mjs.
export { isAuthRetryableFetchError } from "@supabase/supabase-js";
