# Cloudflare Workers Deployment Plan — GIN

## Context

`context/foundation/infrastructure.md` selected **Cloudflare Workers via `@opennextjs/cloudflare`** as the deployment target (runner-up: Vercel), at a flat $5/mo Workers Paid tier. This plan turns that decision into an executable runbook for the **first production deploy**, plus the Supabase integration and CI auto-deploy.

**Current repo state (verified):**
- Next.js **16.2.9**, React 19.2.4, TypeScript strict, pnpm. Path alias `@/* → ./src/*`.
- `src/app` is still the **stock scaffold** — no Supabase, no GIN features, no `app/api`, no server actions, no `middleware.ts`.
- **No** `@opennextjs/cloudflare`, `wrangler`, `@supabase/*`, `wrangler.jsonc`, `open-next.config.ts`, `.dev.vars`, or `.github/workflows`.
- `.env*` is already gitignored.

**Decisions for this plan:**
- **Scope:** stand up the OpenNext→Workers pipeline **and** wire Supabase SSR auth/DB client utilities.
- **CI:** prove the pipeline with a **manual** first deploy, then connect **Cloudflare Workers Builds** (Cloudflare-native Git integration — *not* GitHub Actions) so pushes to the production branch auto-deploy and non-production branches get **preview deployments**. Enable **Workers Observability** so those builds/previews are inspectable.
- **Intended outcome:** the scaffold (with Supabase client wired and ready) runs on Workers in production, secrets are in Workers Secrets, pushes to `main` auto-deploy via Workers Builds, feature branches get preview URLs, and runtime logs are queryable in the Observability dashboard.

> ⚠️ **Load-bearing version risk.** Next.js **16.1.0** (Error 1101: `setImmediate`) and **16.2.0** (Error 1101: `loadManifest`/`prefetch-hints.json`) both crashed on Workers and were fixed in the adapter ([#1057/#1069](https://github.com/opennextjs/opennextjs-cloudflare/issues/1049), [#1160](https://github.com/opennextjs/opennextjs-cloudflare/issues/1157)). We are on **16.2.9** — *above* the broken 16.2.0 — so we must install a recent adapter that contains the #1160 fix and **prove it with a local Workers preview before any production deploy** (Phase 4 is the gate, not optional).

---

## Prerequisites — environment & account setup (human-only — do these first)

Each block ends with a **verify** command/check; do not move past a block until its verify passes. Several steps are **manual dashboard gates** (account creation, plan upgrade, key copying) that cannot and should not be automated.

### 0. Base toolchain

- [x] **Node 20+** and **pnpm** available (`corepack enable pnpm` if pnpm isn't installed). Match the version Workers Builds uses later (Phase 6 pins Node 20).
- [x] **Verify:** `node -v` (≥ 20), `pnpm -v`. — ✅ Node **v24.13.0**, pnpm **11.6.0** (2026-06-29).

> ⚠️ **Parity note:** local Node is **24**, but Phase 6 Workers Builds pins **Node 20**. Fine for now (the build is identical), but if a dependency ever behaves differently between major versions, align them — either bump the Workers Builds Node version to 24 or pin local to 20 via `.nvmrc`/Volta.

### A. Cloudflare account & Workers plan *(manual dashboard gate)*

- [x] **Create / sign in** to a Cloudflare account at `dash.cloudflare.com`. Verify the account email (an unverified account can't deploy Workers). — ✅ done 2026-06-29.
- [ ] **Workers plan — START ON FREE, upgrade only if the build forces it (decision deferred to Phase 4).** Don't pay upfront. *(This is a billing decision only — you do NOT create a Worker here. The `gin` Worker is auto-provisioned by the first `deploy` in Phase 5 from `wrangler.jsonc`; do not hand-create it in the dashboard.)* Current limits: Free = **3 MiB** Worker size / **10 ms** CPU per request / 100k req/day; Paid ($5/mo) = **10 MiB** / 30 s (→5 min) CPU / no daily cap. The **only hard blocker** is the 3 MiB size cap — Next.js + OpenNext + Supabase SDK often exceeds it (*"Your Worker exceeded the size limit of 3 MiB"*). **Phase 4's preview build prints the actual bundle size** → if < 3 MiB, stay Free; if over (likely), upgrade via **Workers & Pages → Plans → Workers Paid**. Also watch the 10 ms CPU limit on Free (network wait to Supabase doesn't count, only compute).
- [ ] **Note the Account ID:** Workers & Pages → right sidebar → **Account ID** (also retrievable later via `wrangler whoami`).
- [ ] **Scoped API token** *(optional now — only for token-based/headless deploy; `wrangler login` is simpler for the manual first deploy, and Workers Builds in Phase 6 uses its own OAuth connection, no repo token):* My Profile → **API Tokens** → **Create Token** → **Edit Cloudflare Workers** template → restrict **Account Resources** to this account and **Zone Resources** to none; **no DNS, no billing, no unrelated Secrets**. Store the token in your shell/secret manager, never in the repo.
- [ ] **Verify:** you can load **Workers & Pages** in the dashboard (plan can be Free at this point).

> **Credential-plane boundary.** The Account ID and API token are **Cloudflare deploy credentials** — they do NOT go in `.env*`/`.dev.vars` (those are for the app's Supabase runtime vars only, Phase 3). Account ID isn't secret (safe in `wrangler.jsonc` or via `wrangler whoami`); an API token, *if ever used*, lives in the shell/secret manager as `CLOUDFLARE_API_TOKEN`, never committed. With `wrangler login` you need neither in a file.

> **Wrangler CLI auth is NOT a prereq — it moved into Phase 1**, because `wrangler` is installed there (as a pinned project dev-dependency, never global). You'll run `wrangler login` / `wrangler whoami` right after the install. See Phase 1.

### B. Supabase (project + keys + CLI)

- [x] **Create a Supabase project** *(manual dashboard gate)* at `supabase.com/dashboard` → **New project**. Choose a region close to your users, set a strong DB password (store it in a secret manager — needed for direct Postgres/migrations later). — ✅ done 2026-07-02.
- [x] **Copy API credentials:** Project → **Settings → API** → copy **Project URL** (`NEXT_PUBLIC_SUPABASE_URL`) and **anon/public key** (`NEXT_PUBLIC_SUPABASE_ANON_KEY`). **These two are all v1 needs.** *(Newer Supabase projects label these **Project URL** + **publishable key** — same thing.)* **Do NOT wire the service_role/secret key** — v1 is **anon + RLS only** (see the decision note below); it bypasses RLS and would undermine the organizer-blindness rule, so we deliberately don't use it.
- [x] **(Recommended) Install the Supabase CLI via Homebrew** — for migrations + the local stack: `brew install supabase/tap/supabase` (the tap tracks latest; the core `brew install supabase` may lag). Global binary, invoked as `supabase …`. Chosen over the npm/pnpm dev-dependency because CI here never runs the Supabase CLI (migrations are pushed manually), and brew **sidesteps the pnpm build-script blocking entirely**.
      - *Alternative (project-pinned), only if you later want the CLI version locked in the lockfile / run migrations in CI:* `pnpm add -D supabase`. **pnpm 11 gotcha:** lifecycle scripts are blocked by default, so the binary isn't generated — approve with `pnpm approve-builds` (writes `allowBuilds: { supabase: true }` to `pnpm-workspace.yaml`) or `pnpm add -D supabase --allow-build=supabase`, then run as `pnpm exec supabase …`. *(pnpm 11 removed `onlyBuiltDependencies`; the old `package.json` allowlist no longer applies.)*
      - [x] **Link the project:** `supabase login` then `supabase link --project-ref <ref>` (the `<ref>` is the subdomain of your Project URL). This is what later carries the **RLS policies enforcing the organizer-blindness rule** as versioned migrations. — ✅ linked 2026-07-02.
- [x] **Verify:** `supabase --version` succeeds; the **two public** credential values (URL + anon key) are saved ready for Phase 3.

### C. Local Supabase stack runtime — **Docker** *(only if you run Supabase locally, Option 1)*

The local stack runs Postgres, **GoTrue (Auth)**, Studio, and **Mailpit** (email catcher) as containers — so the **only thing you install is a Docker-compatible engine**; Mailpit/Postgres/Auth/Studio are pulled and managed by `supabase start`, never installed by hand.

**Engine choice — use a fully free / open-source runtime (decided):** **Colima** (MIT, CLI-only, Supabase-CLI-supported) is the pick for this CLI-first workflow.
- *Licensing context:* **Docker Desktop** is actually free for this project (personal use / small business <250 employees & <$10M revenue), but to avoid any license question we use open-source instead. **Avoid OrbStack** here — its free tier is personal/non-commercial only; commercial use is paid. Alternatives that are also fully OSS + Supabase-supported: **Rancher Desktop**, **Podman**.

- [x] **Install Colima + the docker CLI:** `brew install colima docker` (the `docker` formula is just the client; Colima provides the engine). — ✅ installed 2026-07-02.
- [ ] **Start the engine with enough headroom** for the Supabase stack: `colima start --cpu 4 --memory 6` (the stack wants a few GB; tune later). Colima exposes a Docker-compatible socket the Supabase CLI auto-detects.
- [ ] **If the Supabase CLI can't find the daemon:** point it at Colima's socket — `export DOCKER_HOST="unix://$HOME/.colima/default/docker.sock"` (add to your shell profile).
- [ ] **Capacity:** first `supabase start` pulls several images (a few minutes, ~couple GB disk); stop the engine with `colima stop` and the stack with `supabase stop` when not in use.
- [ ] **Verify:** `docker info` succeeds (daemon reachable via Colima). The first `supabase start` then pulls images and prints the service URLs + local keys.

> **Note — keys boundary.** v1 uses only the **two public** hosted-project values (URL + anon key), both inlined into the client bundle at build — so there's **no app-level Supabase secret** to manage (the service_role/secret key is intentionally unused; see the v1 decision note in Phase 2). The **local** stack has its own separate fixed dev keys (from `supabase status`) — never deploy those.

---

## Phase 1 — Add the adapter and Workers config

- [ ] **Install tooling (pnpm only):**
      `pnpm add -D @opennextjs/cloudflare@latest wrangler@latest`
      Confirm `wrangler --version` ≥ **3.99.0** and `@opennextjs/cloudflare` is a version that includes the #1160 fix (**≥ 1.17.2**, prefer latest). Record exact resolved versions in `package.json` (no `^` range on the adapter — **pin it** to avoid surprise bumps).
- [ ] **Authenticate wrangler** *(was prereq Block B — lives here because it needs wrangler installed first; use `pnpm exec`, never a global install)*. Pick one method:
      - **Interactive (recommended):** `pnpm exec wrangler login` — browser OAuth. In this session run it as `! pnpm exec wrangler login` so the flow lands in the conversation.
      - **Token-based (headless/CI):** `export CLOUDFLARE_API_TOKEN="<scoped token>"`. Note it **overrides** any `wrangler login` session — unset a stale token when switching back to OAuth.
      - **Verify + grab Account ID:** `pnpm exec wrangler whoami` prints your account email + **Account ID** (this completes prereq Block A's Account-ID step and confirms which auth method is active).
- [ ] **`wrangler.jsonc`** at repo root:
      ```jsonc
      {
        "$schema": "node_modules/wrangler/config-schema.json",
        "main": ".open-next/worker.js",
        "name": "gin",
        "compatibility_date": "2024-12-30",
        "compatibility_flags": ["nodejs_compat", "global_fetch_strictly_public"],
        "assets": { "directory": ".open-next/assets", "binding": "ASSETS" },
        "services": [{ "binding": "WORKER_SELF_REFERENCE", "service": "gin" }],
        "r2_buckets": [
          { "binding": "NEXT_INC_CACHE_R2_BUCKET", "bucket_name": "gin-inc-cache" }
        ],
        "observability": {
          "enabled": true,
          "logs": { "invocation_logs": true, "head_sampling_rate": 1 }
        }
      }
      ```
      (`name` must match the `WORKER_SELF_REFERENCE` service. R2 bucket is for ISR/Next cache — include it now so caching works once GIN adds dynamic routes; create the bucket in Phase 5.)
- [ ] **`open-next.config.ts`** at repo root:
      ```ts
      import { defineCloudflareConfig } from "@opennextjs/cloudflare";
      import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
      export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
      ```
- [ ] **`next.config.ts`** — append the dev-binding initializer so `next dev` can see Workers bindings:
      ```ts
      import { initializeOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
      initializeOpenNextCloudflareForDev();
      ```
- [ ] **`public/_headers`** — long-cache static assets:
      ```
      /_next/static/*
        Cache-Control: public,max-age=31536000,immutable
      ```
- [ ] **`package.json` scripts** — add (keep existing `dev`/`build`/`lint`):
      ```jsonc
      "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
      "deploy":  "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
      ```
- [ ] **`.gitignore`** — add `.open-next`, `.dev.vars`, `cloudflare-env.d.ts` (regenerated), and confirm `.env*` already ignored.
- [ ] **`pnpm cf-typegen`** to generate `cloudflare-env.d.ts` typing the bindings/secrets.
- [ ] **Edge-case sweep:** grep for `export const runtime = "edge"` and remove any (OpenNext uses the Node-compat Worker runtime; `edge` declarations break the build). None exist today — re-check after Supabase wiring.

## Phase 2 — Wire Supabase (SSR client + middleware)

Use `@supabase/ssr`; **create the client per-request, never as a module-global** (Workers cannot reuse a connection across requests).

- [ ] `pnpm add @supabase/supabase-js @supabase/ssr` (pin `@supabase/ssr` **≥ 0.10.0** — it auto-emits CDN cache headers on token refresh, preventing Cloudflare from caching a `Set-Cookie` and signing users in as each other).
- [ ] **`src/utils/supabase/client.ts`** — browser client via `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)`.
- [ ] **`src/utils/supabase/server.ts`** — `createServerClient` with the **anon key**, reading/writing cookies through `next/headers` `cookies()`; instantiate inside each call (per-request) so RLS applies with the user's session (`auth.uid()`). **No service_role helper** — see the decision below.
- [ ] **`middleware.ts`** at repo root — session-refresh middleware (`updateSession` pattern from Supabase Next.js SSR docs). Make sure `setAll` writes the refreshed cookies back onto the response so the `@supabase/ssr` cache headers take effect.
- [ ] **Decision — v1 is anon-key + RLS only (no service_role):** the service_role/secret key **bypasses RLS**, which is exactly the mechanism enforcing the organizer-blindness rule — so not wiring it removes the top leak vector from infrastructure.md's risk register. GIN v1 has no admin role, no background jobs, and no webhooks (per CLAUDE.md / tech-stack.md), so there is no legitimate need. All access — auth, browse, claim, and the organizer's **post-event reveal** — runs through RLS with the user's session; the reveal is an RLS policy `USING (event_date < now())` (the query-level event-date filter CLAUDE.md mandates), and any signup-side row creation uses a `SECURITY DEFINER` Postgres trigger, not app-side elevation.
- [ ] **Guardrail:** if a future feature ever genuinely needs service_role, it must be a **deliberate, reviewed, server-only** addition with a test proving it can't touch claim-status read paths before the event date — never a default import.
- [ ] **Smoke component:** a tiny server component (or `app/api/health/route.ts`) that calls `supabase.auth.getUser()` and returns ok — gives Phase 4 something real to exercise the cookie/Workers path against. (Remove or keep as a health endpoint.)

## Phase 3 — Environment (no app secrets in v1)

Only the **two public** `NEXT_PUBLIC_*` values, inlined at build. **v1 has no runtime Supabase secret** (service_role is intentionally unused — Phase 2 decision), so there is no `wrangler secret put` step for the app.

- [ ] **`.dev.vars`** (gitignored) for local Workers preview:
      ```
      NEXTJS_ENV=development
      NEXT_PUBLIC_SUPABASE_URL=...
      NEXT_PUBLIC_SUPABASE_ANON_KEY=...
      ```
- [ ] **`.env.local`** (gitignored) — same `NEXT_PUBLIC_*` pair so `next dev` and the build inline them.
- [ ] **`.env.example`** (committed) — the var **names only**, no values, as documentation.
- [ ] **No Worker secret to set for v1.** (If service_role is ever introduced later, *that* is when a `pnpm exec wrangler secret put …` step gets added — human-only.)
- [ ] **Build-time publics for prod:** `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` must be present during `opennextjs-cloudflare build`. For manual deploys they come from `.env.local`; for Workers Builds they come from build variables (Phase 6).

> **Local Supabase stack is deferred — see the last section of this plan.** It is **not** on the deployment critical path: Phases 1–6 all run against the **hosted** Supabase project (Phase 4's preview *must* use hosted anyway, per the `global_fetch_strictly_public` gotcha). So for the whole deploy, point **both** `.env.local` and `.dev.vars` at the **hosted** project. Stand up the local Docker stack (`supabase start`) later, when you start building GIN's features — that's **"Feature-dev inner loop"** at the end.

## Phase 4 — Local Workers preview (the gate — do NOT skip)

This is where the 16.2.9 × adapter compatibility is proven before touching production.

- [ ] `pnpm preview` (= `opennextjs-cloudflare build && … preview`). It must build **and** boot without Error 1101.
- [ ] In the preview, hit `/` and the smoke endpoint; confirm `supabase.auth.getUser()` round-trips (cookies work under `workerd`).
- [ ] **Bundle-size check:** watch the build output for the Worker size; must stay under **10 MiB** compressed (paid cap). If close, lazy-load heavy deps.
- [ ] **If the Worker crashes with Error 1101** (`setImmediate` / `loadManifest`/`prefetch-hints`): the adapter is older than the fix → bump `@opennextjs/cloudflare` to latest and re-run. If latest still fails, pin Next.js to the last known-good 16.2.x for this adapter and open/track an upstream issue. **Extra support:** `pnpm exec wrangler tail --format json` while reproducing to capture the stack.
- [ ] `pnpm lint` and (if/when a runner exists) tests pass. *Note: CLAUDE.md flags no test runner is configured — out of scope here, but the organizer-blindness rule needs coverage before claim-status code ships.*

## Phase 5 — First production deploy (manual)

- [ ] **Create the R2 cache bucket:** `pnpm exec wrangler r2 bucket create gin-inc-cache` (matches `wrangler.jsonc`).
- [ ] **Authenticate wrangler:** `pnpm exec wrangler login` (interactive — run via `! wrangler login` in the session) **or** export the scoped `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` env vars.
- [ ] **Deploy:** `pnpm deploy`. Note the `*.workers.dev` URL.
- [ ] **Verify live:** load the URL; `pnpm exec wrangler tail --format json` to watch runtime logs; confirm the smoke endpoint + auth round-trip in production.
- [ ] **Rollback rehearsal:** `pnpm exec wrangler versions list`; confirm `pnpm exec wrangler rollback [version-id]` is understood (seconds to revert). *Caveat: Supabase schema migrations do NOT roll back with the Worker — coordinate DB changes separately.*

## Phase 6 — Cloudflare Workers Builds (Git integration, branch deploys + previews)

No GitHub Actions. Use Cloudflare's **native** Git integration: it OAuth-connects the repo to the Worker, builds in Cloudflare's environment, auto-deploys the production branch, and creates **preview deployments** for non-production branches (PR comment + preview URL). No `CLOUDFLARE_API_TOKEN` in the repo — the connection handles auth.

> Confirm branch name during execution — repo default is **`main`** (you said "master"). Plan targets `main` as the production branch.

- [ ] **Connect the repo** (Cloudflare dashboard → the `gin` Worker → Settings → **Builds** → Connect GitHub): authorize the Cloudflare GitHub App scoped to this repo only.
- [ ] **Build configuration:**
      - **Build command:** `pnpm exec opennextjs-cloudflare build`
      - **Deploy command (production):** `pnpm exec wrangler deploy` (Cloudflare auto-swaps this to `pnpm exec wrangler versions upload` on non-production branches → preview version, not promoted).
      - **Production branch:** `main`. **Build watch paths:** default (whole repo) is fine for now.
      - **Package manager:** ensure pnpm is detected (lockfile present); pin Node 20 via build settings if needed.
- [ ] **Build-time variables** (Builds → Variables, NOT secrets — they're public): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` so `next build` inlines them. (No Supabase runtime secret in v1 — nothing else to configure.)
- [ ] **Preview-state guardrail:** preview deployments hit the **same** Supabase project. Because they can surface pre-event claim state during testing, gate preview URLs behind **Cloudflare Access** (or point previews at a separate Supabase project) before any claim-status code exists.
- [ ] **Validate:** push a feature branch → confirm a **preview deployment** is created with a working URL and a PR comment. Merge to `main` → confirm Workers Builds auto-deploys and the production URL updates.
- [ ] **Observability check:** in the Worker → **Observability** tab (enabled via `wrangler.jsonc` in Phase 1), confirm invocation logs/metrics appear for both the preview and production deploys; logs are also live via `wrangler tail --format json`.

---

## Edge cases & extra support steps

- **Pages vs Workers commands are not interchangeable.** Use `@opennextjs/cloudflare` + `wrangler deploy`/`opennextjs-cloudflare deploy` only. Never `wrangler pages deploy` or `@cloudflare/next-on-pages` (legacy) — copying a Pages guide silently misdeploys.
- **`workerd` ≠ Node.** `nodejs_compat` covers most APIs; some crypto/fs/native-addon paths fail at **runtime, not build**. The Phase 4 preview is what catches these — never trust `next dev` alone for Workers behavior.
- **Supabase Postgres pooling.** Pure `supabase-js` (PostgREST over HTTPS) needs **no** Hyperdrive. If GIN later adds a **raw Postgres driver** (Drizzle/Prisma over TCP) for the concurrent-claim path, route it through **Hyperdrive** (use Supabase's *direct* connection string, not the pooled one) to avoid connection exhaustion — and create the client per-request. Documented now; not built in this change.
- **No realtime in scope.** tech-stack.md has `has_realtime: false`; Workers are request-scoped and don't push. If live "taken" status is added later, use Supabase Realtime, not the platform.
- **Don't auto-bump Next.js near a launch.** The adapter sits between Next.js and `workerd`; test every `pnpm update` of `next`/`@opennextjs/cloudflare` on a branch through Phase 4 before merge.
- **Preview-URL leakage.** If preview deploys ever expose pre-event claim state during testing, gate them behind Cloudflare Access.

## Human-only actions (never automate)

Dropping/altering production Postgres, deleting the Worker / R2 bucket / KV namespaces, and changing the billing tier — panel-by-hand even if suggested. (From infrastructure.md operational story.) *(Rotating a service_role/secret key would join this list only if v1's anon-only decision is ever reversed.)*

## Verification (end-to-end)

1. `pnpm preview` builds and boots with no Error 1101; `/` + smoke endpoint + `auth.getUser()` work locally under `workerd`.
2. `pnpm deploy` succeeds; `*.workers.dev` URL serves the app; `wrangler tail` shows clean logs; auth round-trip works in prod.
3. `wrangler versions list` shows the version; rollback path confirmed.
4. Feature-branch push → Workers Builds creates a preview deployment (preview URL + PR comment); merge to `main` → auto-deploys and updates the live URL.
5. Worker bundle < 10 MiB; build inlines the `NEXT_PUBLIC_*` pair. (No app Supabase secret to verify in v1 — `wrangler secret list` should be empty of Supabase keys.)
6. Observability tab shows invocation logs/metrics for production and preview deploys.

## Artifacts produced

`wrangler.jsonc` (incl. observability), `open-next.config.ts`, updated `next.config.ts`/`package.json`/`.gitignore`, `public/_headers`, `src/utils/supabase/{client,server}.ts`, `middleware.ts`, `supabase/config.toml` + `supabase/migrations/*` (local stack config + schema/RLS migrations), `.dev.vars`/`.env.local`/`.env.example`, a connected **Workers Builds** Git integration (no repo CI files), and the reviewed deploy record at this file.

---

## Feature-dev inner loop — local Supabase stack *(NEXT track: start when you begin building GIN features, after the scaffold is deployed)*

> **Why this is last / off the deployment path:** nothing in Phases 1–6 needs the running local stack — deployment uses the **hosted** project throughout (Phase 4's preview *must*, per the `workerd` + `global_fetch_strictly_public` gotcha). Stand this up when you start writing GIN's features (auth, claim, RLS). Concretely, it **repoints `.env.local`** from the hosted values you used during deploy to the **local** stack.

### Start the local stack

- [ ] **Init once:** `supabase init` (creates `supabase/config.toml` + migrations dir; commit these). *(Harmless to run earlier if you want the config committed sooner.)*
- [ ] **Start:** `supabase start` — boots Postgres (`:54322`), Auth/GoTrue + API (`:54321`), Studio (`:54323`), Mailpit (`:54324`). Re-print URLs/keys anytime with `supabase status`; tear down with `supabase stop`. (Colima must be running first — prereq Block C.)
- [ ] **Repoint `next dev` to local:** swap the hosted values in `.env.local` for the **local** ones:
      ```
      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key from `supabase status`>
      ```
- [ ] **Run:** `pnpm dev` → the app now talks to fully-local DB + Auth, offline.

### Auth flow locally (Mailpit)

- [ ] Sign-up / sign-in / sessions run against local GoTrue — no internet.
- [ ] **Confirmation / magic-link / reset emails never send for real** — they land in **Mailpit** at `http://127.0.0.1:54324`; open it and click the link to complete flows.
- [ ] Speed up iteration by toggling `[auth.email] enable_confirmations = false` in `supabase/config.toml` (configure OAuth providers in the same file); apply changes with `supabase stop && supabase start`.

### Schema + RLS workflow (where organizer-blindness lives)

- [ ] Author schema and **RLS policies** as migrations: `supabase migration new <name>`, then `supabase db reset` to apply against the local DB from scratch.
- [ ] Build and test the **organizer-blindness rule** (event-date query filter + RLS) here, locally, before it ever ships — this is the safe sandbox CLAUDE.md's hard rule needs.
- [ ] Promote to the hosted project with `supabase db push` (links to the project from prereq Block B). *Reminder: DB migrations do NOT roll back with a Worker rollback — coordinate them separately (Phase 5 caveat).*

### The two-loop gotcha (why `.env.local` and `.dev.vars` differ)

Once the local stack is in play, `next dev` reaches `127.0.0.1` fine, but the **Workers preview runs under `workerd` with `global_fetch_strictly_public`**, which rejects `fetch()` to localhost/private IPs (*"resolves to a local or disallowed IP address"*). So the two loops target different Supabase URLs:

| Loop | Runtime | Env file | Point Supabase at |
|---|---|---|---|
| `pnpm dev` | Node (`next dev`) | `.env.local` | **local stack** `http://127.0.0.1:54321` |
| `pnpm preview` | `workerd` | `.dev.vars` | **hosted** project URL (public) |
| production | `workerd` | build vars | **hosted** project URL |

- [ ] **Rule of thumb:** build features against the **local stack with `pnpm dev`**; when you run `pnpm preview` to validate Workers-runtime behavior (the Phase 4 gate), point `.dev.vars` at the **hosted** project, not the local one. *(During the initial deploy — before this loop exists — `.env.local` also points at hosted; this is the only step that changes that.)*
- [ ] **Decision (current):** one Supabase project — **production** — for everything; a dedicated **staging** project is deferred. **Consequence:** `pnpm preview` and Phase 6 branch/preview deployments run against **production data**, so (a) keep destructive testing on the local stack, and (b) gate preview URLs behind **Cloudflare Access** (Phase 6) so pre-event claim state can't leak. Revisit with a staging project + a second `.dev.vars`/build-var set when the claim code lands.
