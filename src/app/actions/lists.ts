"use server";

import { refresh } from "next/cache";

import { claimItem } from "@/lib/lists/shared-list";
import type { ListErrorCode } from "@/lib/lists/errors";

// Server Actions for the shared-list page (S-03). Unlike src/app/actions/events.ts,
// these wrap RPCs with no form fields to parse — formData is accepted only to
// satisfy the useActionState signature.

export type ClaimFormState =
  | { status: "idle" }
  | { status: "error"; code: ListErrorCode; message: string };

const GENERIC_ERROR = "Something went wrong. Please try again.";

// Copy policy mirrors src/app/actions/events.ts: specific messages only for
// codes the guest can actually act on, generic for everything else. `code`
// (absent from the shared FormState<T>) is what lets ClaimButton distinguish
// "redirect to sign-in" (not_authenticated) from "toast and stay" (everything
// else).
const CLAIM_ERROR_MESSAGES: Partial<Record<ListErrorCode, string>> = {
  already_taken: "Someone else already claimed this gift.",
  claims_closed: "Claiming has closed for this event.",
  owner_cannot_claim: "You can't claim items on your own list.",
  not_authenticated: "Please sign in to claim this gift.",
};

export async function claimItemAction(
  itemId: string,
  _prevState: ClaimFormState,
  _formData: FormData,
): Promise<ClaimFormState> {
  const result = await claimItem(itemId);

  // refresh() runs on every outcome, not only success — the item's real
  // status (taken by someone else, still available, etc.) must come back
  // regardless of why this claim attempt failed.
  refresh();

  if (!result.ok) {
    return {
      status: "error",
      code: result.code,
      message: CLAIM_ERROR_MESSAGES[result.code] ?? GENERIC_ERROR,
    };
  }

  return { status: "idle" };
}
