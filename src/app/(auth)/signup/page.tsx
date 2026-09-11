import { Heading, Link, Text } from "@/components";

import { SignUpForm } from "./components";

// Renders at `/signup` — see the route-group note in the sibling login page.

// Next supplies `string | string[] | undefined`; see the note in login/page.tsx.
type SearchParamValue = string | string[] | undefined;

function first(value: SearchParamValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function SignUpPage({
  searchParams,
}: {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<Record<string, SearchParamValue>>;
}) {
  const params = await searchParams;
  const next = first(params.next);

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <div className="flex flex-col gap-6 rounded-card bg-surface p-8">
        <Heading level={1}>Create an account</Heading>

        <SignUpForm next={next} />

        <Text variant="small">
          Already have an account?{" "}
          <Link href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}>
            Sign in
          </Link>
        </Text>
      </div>
    </main>
  );
}
