// A share token is 16 random bytes, base64url-encoded with the trailing `=`
// stripped by `translate` — always exactly 22 characters of
// `[A-Za-z0-9_-]` (supabase/migrations/20260911211956_surprise_rule_schema.sql,
// `private.events_guard`). Validating the shape client-side lets
// `getSharedList` skip the round trip for an obviously-bad token.
const SHARE_TOKEN_PATTERN = /^[A-Za-z0-9_-]{22}$/;

export function isShareToken(value: string): boolean {
  return SHARE_TOKEN_PATTERN.test(value);
}
