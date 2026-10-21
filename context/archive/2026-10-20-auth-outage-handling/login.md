# Login investigation — gin.andrzej-pigon.workers.dev

**Date:** 2026-10-19
**Reported by:** user, while signing in on the deployed app
**Status:** root cause identified — Supabase Auth gateway 504s (not LastPass, not an app bug). Sign-in re-tested at 20:31 and 20:33Z and works. Code follow-ups (steps 2, 3, 403s) done in GIN-39; steps 4 and 6 remain as non-code follow-ups.

## Symptom

Sign-in on https://gin.andrzej-pigon.workers.dev/ failed with the form's generic login error. The user's first guess was LastPass autofill interfering with the inputs.

## Conclusion

Supabase Auth returned **504 at the gateway** for the sign-in and session calls. The app showed its generic login error. LastPass is not implicated: the requests never reached GoTrue, so no credentials were evaluated.

## Evidence (Supabase MCP `query_logs`, project `yszmpbngdvbnnlrapixv`)

- `edge_logs` bucketed in 5-minute windows for `/auth/v1/*`:
  - 11:10Z — 13 requests, 13 × 200
  - 11:25Z — 26 requests, 26 × 504, 0 × 200
  - 11:30Z — 42 requests, 23 × 504, 19 × 200 (recovering)
  - First 200 afterwards seen at 11:32:48Z
- Failing sign-in calls: `POST /auth/v1/token?grant_type=password → 504` at 11:30:00, 11:31:06 and 11:31:27Z.
- The reported error (requested at 2026-10-19T11:30:56.061Z, id `fdedebc2-782d-4ef8-9ae7-ee6eb435084a`) is one of four `GET /auth/v1/user → 504` within about 200 ms. The id is not stored in `event_message`, so it was matched by timestamp and status.
- `auth_logs` has no entries for the outage window, so the requests never reached GoTrue. GoTrue restarted at 11:12:32Z (before the outage). The last successful login was `POST /token → 200` at 11:11:13Z.
- pgbouncer shows only its own health checks, so the database does not look overloaded. The cause of the gateway 504s is not visible in these logs.
- `auth_logs` has no status ≥ 400 and no `error` level in the last 24h, which is why earlier queries looked clean. The 504s only appear in `edge_logs`.

## Ruled out / corrected along the way

- **LastPass / autofill:** the form uses native inputs with correct `autoComplete` attributes, and the submit goes through a React 19 Server Action reading live DOM `FormData`. No app-side autofill problem found.
- **`NEXT_PUBLIC_SITE_URL` pointing at localhost in production:** `.env` has `http://localhost:3000`, but the deployed share link is correct (`https://gin.andrzej-pigon.workers.dev/lists/...`). Production gets the right value from somewhere else. Not a bug.
- **Local dev server:** `lsof -i :3000` returned nothing.
- **Browser talking to Supabase directly:** the Network tab filtered on `supabase` showed no calls. The `/token` call is made by the Worker.

## Resolved: why `referer: http://localhost:3000` in Supabase auth logs

**It is not a real Referer header. It is the project's Site URL fallback.**

Research (Exa, 2026-10-19), all in `supabase/auth` (GoTrue):
- `internal/observability/request-logger.go`: the request log entry sets `"referer": utilities.GetReferrer(r, config)`. It does not log the raw header.
- `internal/utilities/request.go`, `GetReferrer`: (1) use `redirect_to` from header/query/form if valid; (2) else use the `Referer` header if it passes `IsRedirectURLValid`; (3) **else return `config.SiteURL`**.
- Supabase docs (Redirect URLs): the Site URL defaults to `http://localhost:3000` and should be changed to the production URL.

Why it applies here: sign-in is a Server Action, so the `/token` call is made by the Worker (server-side `fetch`), which sends no browser `Referer` and no `redirect_to`. GoTrue falls through to `config.SiteURL`. That explains every entry showing `http://localhost:3000` regardless of origin (11:11Z login, 20:31Z and 20:33Z deployed-app logins), and why no local process was involved. An unrelated report (answeroverflow, Jan 2026) shows the same `localhost:3000` referer in logs while the app was stopped.

**Confirmed 2026-10-20 ~12:37Z:** after changing the Site URL in the dashboard (Authentication → URL Configuration) to `https://gin.andrzej-pigon.workers.dev`, a fresh deployed-app login logged `POST /token → 200` with `referer: https://gin.andrzej-pigon.workers.dev`, and the following `/user` calls show the same referer. The fallback explanation holds.

The `remote_addr` `2a06:98c0:3600::103` is Cloudflare (`whois`: CLOUDFLARENET-EU, AS132892), i.e. the Worker's egress.

Also unexplained: the `GET /login` HTML has a script tag with a long random path (`/_kaq5m…`) injected at the top of `<head>`, before the charset meta. It is not in the React tree and is probably injected at the Cloudflare layer. Unverified, probably harmless.

## Sign-in request captured (deployed app, after the outage)

`POST /login` with `Next-Action: 60ecae8d…`, `Origin`/`Referer` = the workers.dev origin, multipart form with `_1_email` / `_1_password`. Response: **303**, body renders the signed-in page ("Create an event", header shows the account email and Sign out). Supabase shows matching `POST /token → 200`. Sign-in works when Auth is up.

## Next steps

1. ~~Capture the real sign-in request~~ — done, see above. (The pasted cURL contained the account password in plain text; change that password, and avoid pasting "Copy as cURL" output.)
2. ~~**Show a distinct error on auth timeouts / 5xx**~~ — done in `cf5c224` (GIN-39): `isAuthUnavailableError` in `src/utils/supabase/errors.ts`, per-form messages in `src/app/actions/auth.ts`, sign-in and sign-up both covered.
3. ~~**Reduce duplicate `getUser` calls.**~~ — done in `85a1427` (GIN-39): the source was the middleware plus `AuthStatus` in the root layout. `AuthStatus` now uses `getClaims()`; the middleware keeps the single `getUser()`. Verified in `edge_logs`: only `Next.js Middleware` calls `/auth/v1/user`, once per request. A single page load can still make 2–3 requests in dev; that was not investigated.
4. **Rotate the `sbp_…` Supabase personal access token** pasted into chat in an earlier session. It is account-wide. https://supabase.com/dashboard/account/tokens
5. ~~**Set the hosted project's Auth Site URL**~~ — done 2026-10-20, confirmed in logs. Original note: **Set the hosted project's Auth Site URL** to `https://gin.andrzej-pigon.workers.dev` (Authentication → URL Configuration) if it is still `http://localhost:3000`, and make sure the Redirect URLs allowlist contains the workers.dev origin (and any preview origins). Impact while it is wrong: Supabase-generated links that do not pass an explicit `redirectTo` (password-reset, magic-link, invite emails; `GetReferrer` fallback) would point at localhost. App-built links use `NEXT_PUBLIC_SITE_URL` and are already correct. `.env.example` already lists this as a manual dashboard step.
6. Check the Supabase status page and the project's plan / pause state for the 11:25–11:32Z window, to find out why the gateway returned 504s.

Steps 2 and 3 need a linked `GIN-<n>-<change-id>` branch and a PR. Nothing is to go on `main`. The issue number is still to be decided.

## Resolved: the 403s (2026-10-20)

Three `GET /auth/v1/user → 403` fired at 12:37:10Z, within 14 ms. `edge_logs` shows a `POST /auth/v1/logout?scope=global → 204` at 12:37:09.866Z just before them. They are the redirect request after the user's own sign-out, still carrying the session that `logout` had just revoked, not a stale cookie from an earlier visit. Three calls because of the duplicate `getUser` (middleware plus layout), now fixed. The exact error code was not recorded: `auth_logs` held only the 200s for that window.

Decision: benign, no code. Clearing cookies in middleware on `session_not_found` was rejected because `copyCookies` handling there is a known silent-failure area. After the fix, a sign-out was repeated and produced no 403 burst.
