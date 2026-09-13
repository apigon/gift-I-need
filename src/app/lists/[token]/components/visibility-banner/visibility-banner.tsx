import { Alert, Link } from "@/components";
import type { getVisibilityBanner } from "@/lib/lists/visibility";

export function VisibilityBanner({
  kind,
  eventId,
  token,
}: {
  kind: ReturnType<typeof getVisibilityBanner>;
  eventId: string;
  token: string;
}) {
  if (kind === "organizer_hidden") {
    return (
      <Alert tone="info">
        Hidden from you, this list&apos;s claims are. Until the reveal opens,
        surprised you must stay.{" "}
        <Link href={`/events/${eventId}`}>Back to your event, return you may.</Link>
      </Alert>
    );
  }

  if (kind === "guest_signed_out") {
    return (
      <Alert tone="info">
        <Link href={`/login?next=/lists/${token}`}>Sign in</Link> to see
        what&apos;s still available to claim.
      </Alert>
    );
  }

  return null;
}
