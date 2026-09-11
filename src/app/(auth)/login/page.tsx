import { Alert, Heading, Link, Text } from "@/components";

import { SignInForm } from "./components";

// The `(auth)` route group keeps the auth pages together without affecting the
// URL — this renders at `/login`, not `/auth/login`.

// Next supplies `string | string[] | undefined` — a repeated param (?next=/a&next=/b)
// arrives as an array. Typing it as a bare string silently produced "/a,/b",
// which safeReturnTo then rejected, losing the destination.
type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  const params = await searchParams;
  const next = first(params.next);
  // Set by /auth/confirm when a confirmation link fails. Without reading it
  // here, a failed confirmation rendered an ordinary login form with no
  // explanation of what went wrong.
  const failedConfirmation = first(params.error) === "confirmation_failed";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6 rounded-card bg-surface p-8">
        <Heading level={1}>Sign in</Heading>

        {failedConfirmation ? (
          <Alert tone="danger">
            That confirmation link didn&apos;t work — it may have expired or
            already been used. Sign in below, or create a new account.
          </Alert>
        ) : null}

        <SignInForm next={next} />

        <Text variant="small">
          Don&apos;t have an account?{" "}
          <Link
            href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
          >
            Create one
          </Link>
        </Text>
      </div>
    </main>
  );
}
