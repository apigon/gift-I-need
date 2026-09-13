import { notFound } from "next/navigation";

import { Alert, Heading, Text } from "@/components";
import { getSharedList } from "@/lib/lists/shared-list";
import { getVisibilityBanner } from "@/lib/lists/visibility";

import { SharedItemList, VisibilityBanner } from "./components";

export default async function SharedListPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const result = await getSharedList(token);

  if (result.kind === "not_found") {
    notFound();
  }

  if (result.kind === "error") {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 px-6 py-16">
        <Alert tone="danger">
          Something went wrong loading this list. Try refreshing the page.
        </Alert>
      </main>
    );
  }

  const { event, items } = result;
  const banner = getVisibilityBanner(event, items);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <div>
        <Heading level={1}>{event.name}</Heading>
        <Text tone="muted">
          {event.eventDate} · {event.timezone}
        </Text>
      </div>

      <VisibilityBanner kind={banner} eventId={event.id} token={token} />

      <div className="flex flex-col gap-4">
        <Heading level={2}>Gift ideas</Heading>
        <SharedItemList
          items={items}
          token={token}
          revealOpen={event.revealOpen}
        />
      </div>
    </main>
  );
}
