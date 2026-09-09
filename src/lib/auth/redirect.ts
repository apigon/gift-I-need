// Safe return-path validation for the `next` query parameter.
//
// SECURITY: this is the open-redirect guard. Without it, `/login?next=https://evil.example`
// turns the sign-in flow into a redirector that sends users off-site with the
// app's own domain in the referring link. Every consumer of an untrusted `next`
// value MUST route it through `safeReturnTo` before redirecting.
//
// EDGE RUNTIME: imported (transitively) by middleware, which runs on the Edge
// under OpenNext. Keep this module pure TypeScript — no Node built-ins, no
// `next/headers`, no Supabase imports.

export const DEFAULT_REDIRECT = "/";

/**
 * Turn an untrusted `next` value into a same-origin path.
 *
 * Accepts only strings beginning with a single `/`. Returns DEFAULT_REDIRECT
 * for anything else, including:
 *   - absolute URLs        `https://evil.example`
 *   - protocol-relative    `//evil.example`
 *   - backslash-prefixed   `/\evil.example`  (browsers may normalise \ to /)
 *   - empty / null / undefined
 */
export function safeReturnTo(next: string | null | undefined): string {
  if (typeof next !== "string" || next.length === 0) {
    return DEFAULT_REDIRECT;
  }

  // Must be root-relative.
  if (!next.startsWith("/")) {
    return DEFAULT_REDIRECT;
  }

  // Reject `//host` and `/\host`. Several browsers treat a backslash in the
  // authority position as a forward slash, so `/\evil.example` can navigate
  // off-origin exactly like `//evil.example` would.
  if (next.startsWith("//") || next.startsWith("/\\")) {
    return DEFAULT_REDIRECT;
  }

  // Reject C0 controls and DEL. A legitimate in-app path never contains them,
  // and they can be used to smuggle a value past naive parsers (e.g. a raw CR
  // or LF landing in a header). Written as a char-code scan rather than a regex
  // so the range stays readable and no literal control byte ends up in source.
  for (let i = 0; i < next.length; i += 1) {
    const code = next.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return DEFAULT_REDIRECT;
    }
  }

  return next;
}
