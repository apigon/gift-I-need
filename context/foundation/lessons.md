# Lessons Learned

> Append-only register of recurring rules and patterns. Re-read at start by /10x-frame, /10x-research, /10x-plan, /10x-plan-review, /10x-implement, /10x-impl-review.

## Treat Supabase redirect-URL rejection as a silent fallback, not an error

- **Context**: Any auth flow passing `emailRedirectTo` / `redirect_to` to Supabase.
- **Problem**: Supabase matches `additional_redirect_urls` **including the query string**. An entry for `/auth/confirm` does not match `/auth/confirm?next=/x`. On mismatch it does not error — it silently substitutes `site_url`, so users land somewhere plausible holding an unusable token and nothing logs a failure. Cost most of a debugging session on F-01 (`email-password-auth`), where the symptom looked like a broken route handler.
- **Rule**: Whenever a redirect URL is constructed with a query string, verify the **emitted link** (capture the real email) rather than assuming the config matched. Prefer `/**` wildcard entries over exact paths.
- **Applies to**: plan, implement, impl-review

## Supabase email callbacks are PKCE (`?code=`), not `token_hash`

- **Context**: Any route handling a Supabase email link with `@supabase/ssr`.
- **Problem**: `@supabase/ssr` hardcodes `flowType: "pkce"` in both `createServerClient` and `createBrowserClient`, so callbacks arrive as `?code=` for `exchangeCodeForSession`. Supabase's own documentation shows a `token_hash`/`verifyOtp` handler, which this stack never produces — so a handler written from the docs is silently dead code that fails only when a real user clicks a real link.
- **Rule**: Write the `code`/`exchangeCodeForSession` branch first. Treat any `token_hash`/`verifyOtp` handler as a fallback, and note that `verifyOtp` needs no `code_verifier`, which makes it a login-CSRF vector if an email template ever emits one.
- **Applies to**: plan, implement, impl-review

## Supabase auth methods return errors; they do not throw

- **Context**: Any call to `supabase.auth.*` (`getUser`, `signUp`, `signInWithPassword`).
- **Problem**: Failures arrive in the returned `error` field, not as exceptions. `try/catch` around them is near-dead code, and destructuring only `{ error }` or only `{ data }` hides real states. Two instances on F-01: `/api/health` reported `ok:true` while Supabase was unreachable because it only caught throws; and `signUp` returns `data.session === null` with **no error** once confirmations are on, which would silently redirect a newly-registered user into a protected path.
- **Rule**: Destructure and check **both** `data` and `error`. Never rely on `try/catch` to detect a Supabase auth failure.
- **Applies to**: plan, implement, impl-review

## `NextResponse.redirect` is 307 and preserves the method

- **Context**: Any middleware/proxy redirect in a Next.js App Router app.
- **Problem**: 307 preserves the request method, so a POST to a protected path is replayed against the redirect target. A webhook POST or an expired-session Server Action POST gets re-issued at `/login`, whose module graph cannot handle it — the user sees an opaque failure rather than a login form.
- **Rule**: When redirecting non-GET requests, choose the status deliberately: `401` + JSON for API callers, `303` to downgrade a POST to GET for pages. Never let the 307 default apply to a path that accepts POST.
- **Applies to**: plan, implement, impl-review

## Order zod transforms before the format check

- **Context**: Any zod schema combining a format validator with a transform.
- **Problem**: `z.email().trim()` applies the trim **after** the email rule, so a padded value is rejected outright and the trim never runs. The schema silently fails to honour its own stated contract, and the bug is invisible through a browser because `type="email"` inputs pre-sanitise.
- **Rule**: Put transforms first and pipe into the format check: `z.string().trim().pipe(z.email())`. Verify with a deliberately padded input.
- **Applies to**: implement, impl-review

## signUp has three outcomes, not two

- **Context**: src/app/actions/auth.ts:112 (`signUp` Server Action)
- **Problem**: Only `{ error }` is read from `supabase.auth.signUp()`. With confirmations on, `signUp` returns `data.session === null` and no error, so the user is redirected to `next`, bounced back to `/login` by the proxy, and never told to check their email. It's latent while confirmations are off, and the "enable confirmations" checklist in `src/app/auth/confirm/route.ts:14-31` doesn't mention it.
- **Rule**: Treat `supabase.auth.signUp` as returning three outcomes (error / session / no session and no error), and give the no-session case its own UI state ("check your email") even while confirmations are off.
- **Applies to**: implement, impl-review

## Give trigger-computed NOT NULL columns a placeholder DEFAULT, not an app-layer cast

- **Context**: Any Postgres table where a BEFORE INSERT trigger unconditionally computes a NOT NULL column with no column-level DEFAULT (e.g. GIN's events.share_token/unlockable_at/auto_reveal_at, set by events_guard in supabase/migrations/20260911211956_surprise_rule_schema.sql:116-129).
- **Problem**: `supabase gen types` derives Insert-type optionality purely from information_schema/pg_attrdef column defaults — it has no visibility into trigger bodies. A column a trigger always overwrites still comes back required on the generated Insert type, even when the column GRANT forbids ever supplying it. The instinctive fix is an `as unknown as Database[...]["Insert"]` cast at each call site (as shipped in F-02's claim-race.integration.test.ts:81-90) — it works, but permanently mis-documents the column as required and must be repeated at every insert call site.
- **Rule**: Give the column a harmless placeholder DEFAULT instead of casting at each call site. Postgres applies column defaults before BEFORE INSERT triggers run, so if the trigger overwrites the column unconditionally (not an `if new.x is null` guard), the placeholder is never observably stored — this flips the column to optional in the regenerated type with zero behavior change. Verify the trigger's overwrite is unconditional first; existing tests asserting the real trigger-computed value already prove no placeholder leaks through, so no new test is needed for the default itself.
- **Applies to**: plan, implement, impl-review, plan-review

## Column-scoped grants only cover INSERT/UPDATE — don't credit them for SELECT safety

- **Context**: src/lib/lists/owned-events.ts:12-14 — any module-header comment explaining why an RLS-scoped read can't leak claim data.
- **Problem**: The comment credited "column-scoped grants" for keeping SELECT safe, but this codebase's column-scoped grants (supabase/migrations/20260911211956_surprise_rule_schema.sql) only restrict INSERT/UPDATE columns — SELECT on events/items is table-wide. The actual safety mechanism is RLS scoped to owner_id plus the fact that events/items carry no claim-bearing column at all (public.claims has zero grants to any API role).
- **Rule**: When documenting why a table read is safe, name the actual mechanism (RLS policy + absent/no-grant column), not grants that don't apply to SELECT.
- **Applies to**: plan, implement, impl-review

## Set NEXT_PUBLIC_* build-time vars in Workers Builds' Build variables, and expect no preview-URL value

- **Context**: Any time a new NEXT_PUBLIC_* env var is introduced, and any change to the Cloudflare Workers Builds / preview-deployment pipeline.
- **Problem**: NEXT_PUBLIC_* vars are inlined at `next build` time, not Worker runtime. .env (pnpm dev, hosted) was missing NEXT_PUBLIC_SITE_URL while .env.localdb had it — copy-link buttons silently produced relative-path links, caught only by manual testing, not typecheck/lint/unit tests. Separately, Cloudflare Workers Builds has no CF_PAGES_URL equivalent, so a preview deployment's own URL isn't knowable at build time by default.
- **Rule**: Set NEXT_PUBLIC_* values for Workers Builds in the dashboard's Build variables and secrets (Worker > Settings > Build) — never in runtime Variables & Secrets or wrangler.jsonc [vars], which only populate the Worker's runtime env after the client bundle is already compiled. When adding a new NEXT_PUBLIC_* var, verify it's set in every .env* file that's supposed to carry it, not just the one you're actively testing against. For preview deployments, accept the relative-path fallback as the default until a --preview-alias + WORKERS_CI_BRANCH-derived build script is deliberately set up — there is no auto-injected preview URL to read.
- **Applies to**: all
