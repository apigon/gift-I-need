import Link from "next/link";

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
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-title font-bold">Create an account</h1>

      <SignUpForm next={next} />

      <p className="text-small">
        Already have an account?{" "}
        <Link
          className="underline"
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
        >
          Sign in
        </Link>
      </p>
    </main>
  );
}
