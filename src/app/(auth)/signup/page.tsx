import Link from "next/link";

import { SignUpForm } from "./components";

// Renders at `/signup` — see the route-group note in the sibling login page.

export default async function SignUpPage({
  searchParams,
}: {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold">Create an account</h1>

      <SignUpForm next={next} />

      <p className="text-sm">
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
