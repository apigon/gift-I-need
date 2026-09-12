// Maps a Postgres/PostgREST error into the fixed vocabulary the UI switches
// on. Deliberately no `@supabase/*` import — `RpcError` is a local structural
// type that a real `PostgrestError` satisfies, so this module stays safe to
// unit-test and to import from anywhere (unlike `shared-list.ts`).

// The `P0001` keys raised by the migrations' `private.*` function bodies
// (supabase/migrations/20260911211956_surprise_rule_schema.sql), plus
// `already_taken` for the unique-index race loser (`23505`) and `unknown` for
// anything else.
export type ListErrorCode =
  | "not_authenticated"
  | "item_not_found"
  | "event_not_found"
  | "owner_cannot_claim"
  | "claims_closed"
  | "not_revealed"
  | "not_claimed"
  | "not_permitted"
  | "unlock_too_early"
  | "invalid_timezone"
  | "event_date_in_past"
  | "event_date_immutable"
  | "already_taken"
  | "unknown";

const P0001_MESSAGES: Record<string, ListErrorCode> = {
  not_authenticated: "not_authenticated",
  item_not_found: "item_not_found",
  event_not_found: "event_not_found",
  owner_cannot_claim: "owner_cannot_claim",
  claims_closed: "claims_closed",
  not_revealed: "not_revealed",
  not_claimed: "not_claimed",
  not_permitted: "not_permitted",
  unlock_too_early: "unlock_too_early",
  invalid_timezone: "invalid_timezone",
  event_date_in_past: "event_date_in_past",
  event_date_immutable: "event_date_immutable",
};

export type RpcError = { code: string; message: string };

export function mapRpcError(error: RpcError): ListErrorCode {
  if (error.code === "23505") {
    return "already_taken";
  }

  if (error.code === "42501") {
    return "not_authenticated";
  }

  if (error.code === "P0001") {
    return P0001_MESSAGES[error.message] ?? "unknown";
  }

  return "unknown";
}
