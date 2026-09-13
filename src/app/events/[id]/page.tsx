import { notFound } from "next/navigation";

import { Alert, Heading, Text } from "@/components";
import { getOwnedEvent } from "@/lib/lists/owned-events";
import { mergeOwnedItemsWithStatus } from "@/lib/lists/reveal-status";
import { getSharedList } from "@/lib/lists/shared-list";
import type { SharedItem } from "@/lib/lists/types";

import {
  AddItemForm,
  CopyableLinkCard,
  ItemList,
  RevealControl,
} from "./components";

// Both links are built server-side from NEXT_PUBLIC_SITE_URL, never from a
// request header — mirrors `buildConfirmUrl` in `src/app/actions/auth.ts`,
// for the same reason: an attacker-influenced Host header must never end up
// in a link the app treats as canonical. Falls back to a relative path (no
// origin) rather than throwing when the env var is unset or malformed.
function buildSiteUrl(path: string): string {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return path;

  try {
    return new URL(path, siteUrl).toString();
  } catch {
    console.error(
      "[events] NEXT_PUBLIC_SITE_URL is not an absolute URL; falling back to a relative link",
      { siteUrl },
    );
    return path;
  }
}

export default async function EventPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const result = await getOwnedEvent(id);

  // A failed query is not the same as "no such event" — see
  // `getOwnedEvent`'s own note. Only an empty result (RLS-scoped, so a
  // stranger's id and a nonexistent one both come back empty) is a 404.
  if (result.kind === "not_found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
        <Alert tone="danger">
          Something went wrong loading this event. Try refreshing the page.
        </Alert>
      </main>
    );
  }

  const { event, items } = result;
  const shareUrl = buildSiteUrl(`/lists/${event.shareToken}`);
  const organizerUrl = buildSiteUrl(`/events/${event.id}`);

  // Pre-reveal, status would only ever come back null anyway (see
  // private.get_shared_items's owner branch) — skip the RPC round trip
  // entirely rather than issue a call whose result is thrown away.
  let statusUnavailable = false;
  let sharedItems: SharedItem[] | null = null;

  if (event.revealOpen) {
    const sharedResult = await getSharedList(event.shareToken);
    if (sharedResult.kind === "ok") {
      sharedItems = sharedResult.items;
    } else {
      // Both "error" and the structurally-unreachable "not_found" (the
      // owner is reading their own already-validated share_token) degrade
      // the same way: render titles with a "couldn't load status" note
      // instead of failing the whole page.
      statusUnavailable = true;
    }
  }

  const itemsWithStatus = mergeOwnedItemsWithStatus(items, sharedItems);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Heading level={1}>{event.name}</Heading>
        <Text tone="muted">
          {event.eventDate} · {event.timezone}
        </Text>
      </div>

      <div className="flex flex-col gap-4">
        <CopyableLinkCard
          label="Share with your guests"
          description="Guests can browse and claim items here — no sign-in required."
          href={shareUrl}
        />
        <CopyableLinkCard
          label="Your link back to this page"
          description="There's no dashboard yet, so save this to return here."
          href={organizerUrl}
        />
      </div>

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-2">
          <Heading level={2}>Gift ideas</Heading>
          {event.unlockable && !event.revealOpen ? (
            <RevealControl eventId={event.id} />
          ) : null}
        </div>
        <ItemList
          items={itemsWithStatus}
          revealOpen={event.revealOpen}
          statusUnavailable={statusUnavailable}
        />
        {!event.revealOpen && <AddItemForm eventId={event.id} />}
      </div>
    </main>
  );
}
