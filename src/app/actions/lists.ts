"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/lib/forms/form-state";
import type { ListErrorCode } from "@/lib/lists/errors";
import {
  claimItem,
  markGiven as markGivenRpc,
  unlockEvent as unlockEventRpc,
} from "@/lib/lists/shared-list";

// Server Actions for the shared-list page (S-03) and post-event reveal
// (S-05). Unlike src/app/actions/events.ts, these wrap RPCs with no form
// fields to parse — formData is accepted only to satisfy the useActionState
// signature.

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
  // regardless of why this claim attempt failed. A throw here must not
  // reject this action's promise: the write already committed (or the
  // error result is already known), so losing the return value would be
  // strictly worse than a stale client view.
  try {
    refresh();
  } catch (error) {
    console.error(
      "[actions/lists] refresh() failed after claimItem",
      error,
    );
  }

  if (!result.ok) {
    return {
      status: "error",
      code: result.code,
      message: CLAIM_ERROR_MESSAGES[result.code] ?? GENERIC_ERROR,
    };
  }

  return { status: "idle" };
}

// Copy policy mirrors src/app/actions/events.ts: specific messages only for
// codes the user can act on, generic for everything else. `not_claimed` /
// `not_permitted` / `not_revealed` on markGiven, and a repeat `unlock_event`
// call, all collapse to the generic message — a no-op success (second mark
// by the same allowed party) is not an error at the RPC level, so no
// special-casing is needed here.
const UNLOCK_ERROR_MESSAGES: Partial<Record<ListErrorCode, string>> = {
  unlock_too_early: "Try again after it opens.",
};

export async function markGivenAction(
  itemId: string,
  _prevState: FormState<never>,
  _formData: FormData,
): Promise<FormState<never>> {
  const result = await markGivenRpc(itemId);

  if (!result.ok) {
    // Unlike claimItemAction, refresh() is skipped here: a failed mark
    // genuinely changed nothing, so there's no new status to re-fetch.
    return { status: "error", message: GENERIC_ERROR };
  }

  try {
    refresh();
  } catch (error) {
    console.error(
      "[actions/lists] refresh() failed after markGiven",
      error,
    );
  }
  return { status: "idle" };
}

export async function unlockEventAction(
  eventId: string,
  _prevState: FormState<never>,
  _formData: FormData,
): Promise<FormState<never>> {
  const result = await unlockEventRpc(eventId);

  if (!result.ok) {
    // Unlike claimItemAction, refresh() is skipped here: a failed unlock
    // genuinely changed nothing, so there's no new status to re-fetch.
    return {
      status: "error",
      message: UNLOCK_ERROR_MESSAGES[result.code] ?? GENERIC_ERROR,
    };
  }

  try {
    refresh();
  } catch (error) {
    console.error(
      "[actions/lists] refresh() failed after unlockEvent",
      error,
    );
  }
  return { status: "idle" };
}
