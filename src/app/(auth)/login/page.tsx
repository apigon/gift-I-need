import Link from "next/link";

import { SignInForm } from "./components/sign-in-form";

// The `(auth)` route group keeps the auth pages together without affecting the
// URL — this renders at `/login`, not `/auth/login`.
//
// Markup is deliberately plain: F-03 (design-system-baseline) owns the visual
// layer, and styling it now would only be thrown away.

export default async function LoginPage({
  searchParams,
}: {
  // Next.js 16: `searchParams` is a Promise and must be awaited.
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-bold">Sign in</h1>

      <SignInForm next={next} />

      <p className="text-sm">
        Don&apos;t have an account?{" "}
        <Link
          className="underline"
          href={next ? `/signup?next=${encodeURIComponent(next)}` : "/signup"}
        >
          Create one
        </Link>
      </p>
    </main>
  );
}
