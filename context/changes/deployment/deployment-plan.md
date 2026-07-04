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
- [x] **Workers plan — STAY ON FREE (decided in Phase 4, 2026-07-03).** The Phase 4 dry-run measured the gzipped Worker at **1.12 MiB**, under the Free **3 MiB** cap → no upgrade forced, no upfront pay. Revisit only if a later feature pushes compute past the Free **10 ms CPU/request** limit (network wait to Supabase doesn't count). — ✅ Free.
      <br>Original guidance: **START ON FREE, upgrade only if the build forces it.** Don't pay upfront. *(This is a billing decision only — you do NOT create a Worker here. The `gin` Worker is auto-provisioned by the first `deploy` in Phase 5 from `wrangler.jsonc`; do not hand-create it in the dashboard.)* Current limits: Free = **3 MiB** Worker size / **10 ms** CPU per request / 100k req/day; Paid ($5/mo) = **10 MiB** / 30 s (→5 min) CPU / no daily cap. The **only hard blocker** is the 3 MiB size cap — Next.js + OpenNext + Supabase SDK often exceeds it (*"Your Worker exceeded the size limit of 3 MiB"*). **Phase 4's preview build prints the actual bundle size** → if < 3 MiB, stay Free; if over (likely), upgrade via **Workers & Pages → Plans → Workers Paid**. Also watch the 10 ms CPU limit on Free (network wait to Supabase doesn't count, only compute).
- [ ] **Note the Account ID:** Workers & Pages → right sidebar → **Account ID** (also retrievable later via `wrangler whoami`).
- [ ] **Scoped API token** *(optional now — only for token-based/headless deploy; `wrangler login` is simpler for the manual first deploy, and Workers Builds in Phase 6 uses its own OAuth connection, no repo token):* My Profile → **API Tokens** → **Create Token** → **Edit Cloudflare Workers** template → restrict **Account Resources** to this account and **Zone Resources** to none; **no DNS, no billing, no unrelated Secrets**. Store the token in your shell/secret manager, never in the repo.
- [ ] **Verify:** you can load **Workers & Pages** in the dashboard (plan can be Free at this point).

> **Credential-plane boundary.** The Account ID and API token are **Cloudflare deploy credentials** — they do NOT go in `.env*` (those are for the app's Supabase runtime vars only, Phase 3). Account ID isn't secret (safe in `wrangler.jsonc` or via `wrangler whoami`); an API token, *if ever used*, lives in the shell/secret manager as `CLOUDFLARE_API_TOKEN`, never committed. With `wrangler login` you need neither in a file.

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

- [x] **Install tooling (pnpm only):** — ✅ installed `@opennextjs/cloudflare` **pinned to 1.20.1** (no `^`) + `wrangler ^4.106.0` (2026-07-03).
      `pnpm add -D @opennextjs/cloudflare@latest wrangler@latest`
      Confirm `wrangler --version` ≥ **3.99.0** and `@opennextjs/cloudflare` is a version that includes the #1160 fix (**≥ 1.17.2**, prefer latest). Record exact resolved versions in `package.json` (no `^` range on the adapter — **pin it** to avoid surprise bumps).
- [x] **Authenticate wrangler** — ✅ `wrangler login` done (2026-07-03). *(was prereq Block B — lives here because it needs wrangler installed first; use `pnpm exec`, never a global install)*. Pick one method:
      - **Interactive (recommended):** `pnpm exec wrangler login` — browser OAuth. In this session run it as `! pnpm exec wrangler login` so the flow lands in the conversation.
      - **Token-based (headless/CI):** `export CLOUDFLARE_API_TOKEN="<scoped token>"`. Note it **overrides** any `wrangler login` session — unset a stale token when switching back to OAuth.
      - **Verify + grab Account ID:** `pnpm exec wrangler whoami` prints your account email + **Account ID** (this completes prereq Block A's Account-ID step and confirms which auth method is active).
- [x] **`wrangler.jsonc`** at repo root: — ✅ created (verbatim; `compatibility_date` kept at `2024-12-30`).
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
- [x] **`open-next.config.ts`** at repo root: — ✅ created.
      ```ts
      import { defineCloudflareConfig } from "@opennextjs/cloudflare";
      import r2IncrementalCache from "@opennextjs/cloudflare/overrides/incremental-cache/r2-incremental-cache";
      export default defineCloudflareConfig({ incrementalCache: r2IncrementalCache });
      ```
- [x] **`next.config.ts`** — ✅ appended `initOpenNextCloudflareForDev()` so `next dev` can see Workers bindings (⚠️ corrected in Phase 2 — was recorded as the non-existent `initializeOpenNextCloudflareForDev`):
      ```ts
      import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
      initOpenNextCloudflareForDev();
      ```
- [x] **`public/_headers`** — ✅ created (long-cache static assets):
      ```
      /_next/static/*
        Cache-Control: public,max-age=31536000,immutable
      ```
- [x] **`package.json` scripts** — ✅ added `preview`/`deploy`/`cf-typegen` (kept `dev`/`build`/`start`/`lint`):
      ```jsonc
      "preview": "opennextjs-cloudflare build && opennextjs-cloudflare preview",
      "deploy":  "opennextjs-cloudflare build && opennextjs-cloudflare deploy",
      "cf-typegen": "wrangler types --env-interface CloudflareEnv cloudflare-env.d.ts"
      ```
- [x] **`.gitignore`** — ✅ added `.open-next`, `.dev.vars`, `cloudflare-env.d.ts`; `.env*` already ignored.
- [x] **`pnpm cf-typegen`** — ✅ generated `cloudflare-env.d.ts` (bindings `ASSETS`, `WORKER_SELF_REFERENCE`, `NEXT_INC_CACHE_R2_BUCKET` typed). Required approving pnpm 11 build scripts first (see note below).
- [x] **Edge-case sweep:** — ✅ `grep -rn 'runtime.*=.*edge' src` returns none. Re-check after Supabase wiring.

> **pnpm 11 build-script approval (done 2026-07-03).** `pnpm add` left `pnpm-workspace.yaml` with placeholder `allowBuilds:` entries for `workerd`, `esbuild`, `sharp`, `unrs-resolver`; unresolved placeholders made `pnpm install` (and every `pnpm <script>`) exit 1. Set all four to `true` — trusted native tooling we deliberately installed (`workerd`/`esbuild` are core to the OpenNext build + Phase 4 preview). **Commit `pnpm-workspace.yaml`** so CI / Workers Builds reproduce the approvals.

## Phase 2 — Wire Supabase (SSR client + middleware)

Use `@supabase/ssr`; **create the client per-request, never as a module-global** (Workers cannot reuse a connection across requests).

> ⚠️ **Next.js 16 deviations from this plan's text (verified against `node_modules/next/dist/docs/`, 2026-07-03):**
> 1. **`middleware.ts` → `proxy.ts` … then back to `src/middleware.ts` (Phase 4 deploy blocker).** Next.js 16 deprecated/renamed the `middleware` file convention to **`proxy`** (function `middleware()` → `proxy()`); it defaults to the **Node.js runtime**. Phase 2 first implemented it as `src/proxy.ts`. **Phase 4 reverted this** to `src/middleware.ts` (export `middleware()`): `@opennextjs/cloudflare` 1.20.1 rejects Next 16's Node-runtime Proxy middleware, and the deprecated `middleware` convention is the only one that emits an adapter-accepted **Edge** entry. See the "Blocker found & fixed" note in Phase 4. The file lives at **`src/middleware.ts`** (same level as `src/app`), *not* repo root, because `app/` is under `src/`.
> 2. **`cookies()` is async** in Next.js 16 — the server client `await`s it.

- [x] `pnpm add @supabase/supabase-js @supabase/ssr` — ✅ installed `@supabase/ssr` **pinned to 0.12.0** (satisfies ≥ 0.10.0; auto-emits CDN cache headers on token refresh) + `@supabase/supabase-js 2.110.0` (2026-07-03).
- [x] **`src/utils/supabase/client.ts`** — ✅ browser client via `createBrowserClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)`.
- [x] **`src/utils/supabase/server.ts`** — ✅ `createServerClient` with the **anon key**, `await cookies()` (async in Next 16), instantiated per-call so RLS applies with the user's session (`auth.uid()`). `setAll` wrapped in try/catch for the Server-Component case. **No service_role helper.**
- [x] **`src/middleware.ts`** (deprecated `middleware` convention — Phase 2 wrote `src/proxy.ts`, Phase 4 reverted it for adapter compatibility; see Phase 4 blocker note) — ✅ session-refresh via `updateSession` helper in **`src/utils/supabase/proxy.ts`**; `setAll` rebuilds the response and writes refreshed cookies back so `@supabase/ssr` cache headers take effect; returns the `supabaseResponse` unmodified. Matcher excludes `_next/static`, `_next/image`, favicon, and image assets. No route-protection redirects (scaffold has none; auth enforced at the data layer via RLS).
- [x] **Decision — v1 is anon-key + RLS only (no service_role):** the service_role/secret key **bypasses RLS**, which is exactly the mechanism enforcing the organizer-blindness rule — so not wiring it removes the top leak vector from infrastructure.md's risk register. GIN v1 has no admin role, no background jobs, and no webhooks (per CLAUDE.md / tech-stack.md), so there is no legitimate need. All access — auth, browse, claim, and the organizer's **post-event reveal** — runs through RLS with the user's session; the reveal is an RLS policy `USING (event_date < now())` (the query-level event-date filter CLAUDE.md mandates), and any signup-side row creation uses a `SECURITY DEFINER` Postgres trigger, not app-side elevation. — ✅ honored: no service_role imported anywhere.
- [x] **Guardrail:** if a future feature ever genuinely needs service_role, it must be a **deliberate, reviewed, server-only** addition with a test proving it can't touch claim-status read paths before the event date — never a default import. — ✅ recorded; no service_role helper exists to import by accident.
- [x] **Smoke component:** ✅ `src/app/api/health/route.ts` (GET) calls `supabase.auth.getUser()` and returns `{ ok, authenticated }` — gives Phase 4 something real to exercise the cookie/Workers path against.

> **Phase 1 fix made here (blocked the build):** `next.config.ts` imported `initializeOpenNextCloudflareForDev`, which **does not exist** in `@opennextjs/cloudflare` 1.20.1 — the real export is **`initOpenNextCloudflareForDev`**. Corrected both the import and the call; `pnpm exec tsc --noEmit` is now clean. (Phase 1's recorded snippet used the wrong name.)

## Phase 3 — Environment (no app secrets in v1)

Only the **two public** `NEXT_PUBLIC_*` values, inlined at build. **v1 has no runtime Supabase secret** (service_role is intentionally unused — Phase 2 decision), so there is no `wrangler secret put` step for the app.

> 🔄 **Revised architecture (2026-07-03) — `.dev.vars` removed, single source of truth.** The original plan duplicated the hosted pair into both `.env.local` (build) and `.dev.vars` (preview runtime). Verified against the installed adapter source: `@opennextjs/cloudflare` **does its own `.env*` loading** (it launches wrangler with `CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`), bakes the Next.js env cascade for all modes into `.open-next/cloudflare/next-env.mjs` at build, and injects it into the Workers runtime (`process.env[k] ??= …`, mode = `NEXTJS_ENV ?? "production"`). So `.env*` values **already reach the preview/prod worker** — `.dev.vars` was pure duplication (and v1 has no secrets that must override). New layout below.

- [x] **`.env`** (gitignored) — ✅ **single source of truth for the HOSTED project** (URL + anon key). Read by `pnpm dev` (default), the build's `NEXT_PUBLIC_*` inlining, and the Workers preview/prod runtime (via the adapter's `next-env.mjs` injection, production mode). Replaces the former `.env.local`.
- [x] **`.env.localdb`** (gitignored) — ✅ **LOCAL stack values** (`http://127.0.0.1:54321` + anon key from `supabase status`). A **non-Next-recognized** filename, loaded **only** by `pnpm dev:local` (`dotenv -e .env.localdb -- next dev`) so plain `pnpm dev` stays hosted. URL pre-filled; anon key placeholder until the local stack is up.
- [x] **`package.json` scripts** — ✅ `dev` = `next dev` (hosted), `dev:local` = `dotenv -e .env.localdb -- next dev` (local). Added `dotenv-cli` (MIT) as a dev-dependency (pure JS → no pnpm-11 build-script gate).
- [x] **~~`.dev.vars`~~ deleted** — ✅ redundant under the adapter's injection model; recreate only if a real runtime secret is ever introduced (not in v1).
- [x] **`.env.example`** (committed) — ✅ var **names only** + the `.env`/`.env.localdb` model documented. Uses a `!.env.example` negation in `.gitignore` (the `.env*` rule was ignoring it).
- [x] **No Worker secret to set for v1.** — ✅ confirmed nothing to do (`wrangler secret put` only returns if service_role is ever introduced — human-only).
- [x] **Build-time publics for prod:** ✅ for manual deploys they come from `.env`; for Workers Builds from build variables (Phase 6).
- [x] **Values pasted** — ✅ hosted Project URL + anon key are in `.env` (source: Supabase → Settings → API).

> **Local Supabase stack is deferred — see the last section of this plan.** Not on the deployment critical path: Phases 1–6 all run against the **hosted** project (Phase 4's preview *must*, per the `global_fetch_strictly_public` gotcha). During deploy, only `.env` (hosted) matters; `.env.localdb` is unused until you start feature dev. Switching `pnpm dev` to the local Docker stack is now a **script** (`pnpm dev:local`), not a file re-point — see **"Feature-dev inner loop"** at the end.

## Phase 4 — Local Workers preview (the gate — do NOT skip)

This is where the 16.2.9 × adapter compatibility is proven before touching production.

> 🚧 **Blocker found & fixed (2026-07-03) — the version trap was NOT Error 1101, it was the Next 16 Proxy × adapter middleware trap.** The first `opennextjs-cloudflare build` failed with `ERROR Node.js middleware is not currently supported. Consider switching to Edge Middleware.` Root cause: Next.js 16's `proxy.ts` (Phase 2's `src/proxy.ts`) is **Node-runtime only** (the `runtime` config is forbidden in Proxy files — `node_modules/next/dist/docs/.../proxy.md:223`), so it emits a **Node** middleware manifest entry; `@opennextjs/cloudflare` **1.20.1 (already the latest — no newer version exists)** only accepts an **Edge** middleware entry (`useNodeMiddleware` check in `dist/cli/build/build.js`). Known upstream: [opennextjs-cloudflare#962](https://github.com/opennextjs/opennextjs-cloudflare/issues/962), [workers-sdk#13755](https://github.com/cloudflare/workers-sdk/issues/13755). **Fix applied:** renamed `src/proxy.ts` → **`src/middleware.ts`** and the export `proxy()` → `middleware()`. In Next 16 the deprecated `middleware` convention still emits an **Edge** entry (build cost = one deprecation warning), which the adapter accepts. No Next.js downgrade needed; Supabase session-refresh preserved. **Revert to `proxy.ts` once the adapter ships Node-middleware support.**

- [x] `pnpm preview` (= `opennextjs-cloudflare build && … preview`). — ✅ builds **and** boots, **no Error 1101**. `workerd` Ready on `http://localhost:8787` with all bindings (R2 cache, WORKER_SELF_REFERENCE, ASSETS) resolved. *(Required the middleware rename above to get past the build gate.)*
- [x] In the preview, hit `/` and the smoke endpoint; confirm `supabase.auth.getUser()` round-trips. — ✅ `/` → **HTTP 200**; `/api/health` → **`{"ok":true,"authenticated":false}` HTTP 200**. Confirms per-request Supabase client + cookies work under `workerd`, and the fetch to the **hosted** Supabase project succeeds (`global_fetch_strictly_public` allows the public HTTPS URL). `authenticated:false` is correct — no session.
- [x] **Bundle-size check.** — ✅ `wrangler deploy --dry-run`: **Total Upload 5498.74 KiB / gzip 1144.58 KiB (≈1.12 MiB compressed)**. Cloudflare enforces the cap on the **gzipped** size → **far under the 10 MiB Paid cap, and under the 3 MiB Free cap too.** ⇒ **resolves prereq Block A's deferred billing decision: the Free tier fits** (watch only the Free 10 ms CPU limit once GIN adds compute; Supabase network wait doesn't count).
- [x] **Error 1101 contingency** — ✅ **not triggered** (no `setImmediate`/`loadManifest`/`prefetch-hints` crash on 16.2.9 with adapter 1.20.1). The blocker we hit was the middleware trap above, not 1101. `wrangler tail` on standby if a runtime 1101 ever surfaces post-deploy.
- [x] `pnpm lint` and (if/when a runner exists) tests pass. — ✅ `pnpm lint` exit 0 and `tsc --noEmit` exit 0. **Fixed a config gap the build exposed:** the generated `.open-next/**` and `cloudflare-env.d.ts` artifacts were being linted (385 errors) — added both to `eslint.config.mjs` `globalIgnores`. *Note: CLAUDE.md flags no test runner is configured — out of scope here, but the organizer-blindness rule needs coverage before claim-status code ships.*

## Phase 5 — First production deploy (manual)

> 🟡 **R2 DEFERRED (Option B, 2026-07-03) — deployed without R2.** `wrangler r2 bucket create gin-inc-cache` failed: **R2 not enabled on the account** (`code: 10042`, "Please enable R2 through the Cloudflare Dashboard" — enabling prompts for a payment method). Since the scaffold has **no ISR/`revalidate` routes**, the incremental cache isn't exercised yet, so R2 was **commented out** of `wrangler.jsonc` (`r2_buckets`) and `open-next.config.ts` (`incrementalCache: r2IncrementalCache` → `defineCloudflareConfig({})`) to ship on the fully-free account. **RE-ENABLE BEFORE ANY ISR ROUTE SHIPS:** dashboard → R2 → Enable → `pnpm exec wrangler r2 bucket create gin-inc-cache` → uncomment both config blocks → `pnpm cf-typegen` → redeploy. (User was away at the decision point; chosen per their free/OSS preference + R2 not yet needed.)

- [~] **Create the R2 cache bucket** — ⏸️ **deferred** (see note above). Not created; R2 wiring commented out so the deploy runs R2-free.
- [x] **Authenticate wrangler** — ✅ already authenticated from Phase 1 (`wrangler whoami`: andrzej.pigon@gmail.com, account `875a82b3…`; token has `workers (write)`). No re-login needed.
- [x] **Deploy:** `pnpm deploy`. — ✅ **live at `https://gin.andrzej-pigon.workers.dev`**. Version `2bb9976a-5404-433b-ad57-34f6ce4f0ef9`; Total Upload 5488 KiB / **gzip 1142 KiB (~1.12 MiB, under Free cap)**; Worker Startup 26 ms; bindings = `WORKER_SELF_REFERENCE` + `ASSETS` (no R2).
- [x] **Verify live** — ✅ `/` → 200 (scaffold "Create Next App"); `/api/health` → `{"ok":true,"authenticated":false}` 200, **auth round-trip works in production** (5/5 stable). *Note: the very first `/api/health` hit right after deploy returned a transient `error 1042 / 404` — a post-deploy edge-propagation blip that cleared within ~2 s; stable 200 on every retry. `wrangler tail --format json` confirmed `response.status 200`.*
- [x] **Rollback rehearsal** — ✅ `wrangler versions list --name gin` shows version `2bb9976a…`; revert path is `pnpm exec wrangler rollback [version-id] --name gin` (seconds). Not executed — only one version exists so far, nothing to roll back to yet. *Caveat: Supabase schema migrations do NOT roll back with the Worker — coordinate DB changes separately.* *(CLI note: worker name is the `--name` flag, not a positional arg.)*

## Phase 6 — Cloudflare Workers Builds (Git integration, branch deploys + previews)

No GitHub Actions. Use Cloudflare's **native** Git integration: it OAuth-connects the repo to the Worker, builds in Cloudflare's environment, auto-deploys the production branch, and creates **preview deployments** for non-production branches (PR comment + preview URL). No `CLOUDFLARE_API_TOKEN` in the repo — the connection handles auth.

> Confirm branch name during execution — repo default is **`main`** (you said "master"). Plan targets `main` as the production branch.

> ✅ **Git prep (2026-07-04):** all Phase 1–5 work merged to `main` via **PR #5** (`apigon/gift-I-need`, merge commit `274024f`). `main` is the production branch and carries the deploy config. **Node pin:** `.nvmrc` = `24` (matches local/tested v24.13.0, overriding the plan's original "Node 20"); added locally, to be committed as part of the pipeline-test change. If a Workers Builds image rejects Node 24, drop `.nvmrc` to `22`/`20`.

- [x] **Connect the repo** — ✅ `gin` Worker connected to GitHub `apigon/gift-I-need` via Cloudflare's native Git integration (Workers Builds), GitHub App scoped to this repo.
- [x] **Build configuration** — ✅ set:
      - **Build command:** `pnpm exec opennextjs-cloudflare build`
      - **Deploy command (production):** `pnpm exec wrangler deploy` (Cloudflare auto-swaps to `wrangler versions upload` on non-production branches → preview version, not promoted).
      - **Production branch:** `main`. **Build watch paths:** default (whole repo).
      - **Package manager:** pnpm (lockfile detected). **Node:** governed by `.nvmrc` once committed (leave dashboard Node unset to avoid a conflicting override).
- [x] **Build-time variables** — ✅ `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` added. *(User may store them **encrypted/masked** in the console — harmless: both are public anyway, still available at build time to inline `NEXT_PUBLIC_*`. Not real secrets; RLS is the protection. No `service_role`.)* No Supabase runtime secret in v1.
- [~] **Preview-state guardrail — DEFERRED (2026-07-04, tracked).** ⏸️ Cloudflare Access on preview URLs **skipped for now**: the app is scaffold-only, so there is **no claim-status data to leak yet**, and this guardrail is scoped "before any claim-status code exists." **🔒 HARD RE-ADD TRIGGER:** before the first commit that adds claim/reveal/organizer-view code, gate preview URLs behind **Cloudflare Access** *or* point previews at a separate Supabase project. This is the CLAUDE.md organizer-blindness rule — non-negotiable once claim code exists. (Preview-branch protection is a later-course topic per the user.)
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

`wrangler.jsonc` (incl. observability), `open-next.config.ts`, updated `next.config.ts`/`package.json` (incl. `dev:local` + `dotenv-cli`)/`.gitignore`, `public/_headers`, `src/utils/supabase/{client,server,proxy}.ts`, `src/middleware.ts` (deprecated `middleware` convention — reverted from `src/proxy.ts` in Phase 4 for `@opennextjs/cloudflare` compatibility), `src/app/api/health/route.ts`, `supabase/config.toml` + `supabase/migrations/*` (local stack config + schema/RLS migrations), `.env`/`.env.localdb`/`.env.example` (no `.dev.vars` — see Phase 3 revised architecture), a connected **Workers Builds** Git integration (no repo CI files), and the reviewed deploy record at this file.

---

## Feature-dev inner loop — local Supabase stack *(NEXT track: start when you begin building GIN features, after the scaffold is deployed)*

> **Why this is last / off the deployment path:** nothing in Phases 1–6 needs the running local stack — deployment uses the **hosted** project throughout (Phase 4's preview *must*, per the `workerd` + `global_fetch_strictly_public` gotcha). Stand this up when you start writing GIN's features (auth, claim, RLS). Concretely, it means running `pnpm dev:local` (which loads `.env.localdb`) instead of `pnpm dev` — `.env` (hosted) is never touched.

### Start the local stack

- [ ] **Init once:** `supabase init` (creates `supabase/config.toml` + migrations dir; commit these). *(Harmless to run earlier if you want the config committed sooner.)*
- [ ] **Start:** `supabase start` — boots Postgres (`:54322`), Auth/GoTrue + API (`:54321`), Studio (`:54323`), Mailpit (`:54324`). Re-print URLs/keys anytime with `supabase status`; tear down with `supabase stop`. (Colima must be running first — prereq Block C.)
- [ ] **Fill `.env.localdb`:** paste the **local** anon key from `supabase status` into the existing `.env.localdb` (URL `http://127.0.0.1:54321` is already there). No change to `.env` — it stays hosted.
      ```
      NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
      NEXT_PUBLIC_SUPABASE_ANON_KEY=<local anon key from `supabase status`>
      ```
- [ ] **Run:** `pnpm dev:local` → the app now talks to fully-local DB + Auth, offline. (`pnpm dev` still targets hosted.)

### Auth flow locally (Mailpit)

- [ ] Sign-up / sign-in / sessions run against local GoTrue — no internet.
- [ ] **Confirmation / magic-link / reset emails never send for real** — they land in **Mailpit** at `http://127.0.0.1:54324`; open it and click the link to complete flows.
- [ ] Speed up iteration by toggling `[auth.email] enable_confirmations = false` in `supabase/config.toml` (configure OAuth providers in the same file); apply changes with `supabase stop && supabase start`.

### Schema + RLS workflow (where organizer-blindness lives)

- [ ] Author schema and **RLS policies** as migrations: `supabase migration new <name>`, then `supabase db reset` to apply against the local DB from scratch.
- [ ] Build and test the **organizer-blindness rule** (event-date query filter + RLS) here, locally, before it ever ships — this is the safe sandbox CLAUDE.md's hard rule needs.
- [ ] Promote to the hosted project with `supabase db push` (links to the project from prereq Block B). *Reminder: DB migrations do NOT roll back with a Worker rollback — coordinate them separately (Phase 5 caveat).*

### The two-loop gotcha (why the local target is its own file + script)

Once the local stack is in play, `next dev` reaches `127.0.0.1` fine, but the **Workers preview runs under `workerd` with `global_fetch_strictly_public`**, which rejects `fetch()` to localhost/private IPs (*"resolves to a local or disallowed IP address"*). The env architecture keeps localhost **structurally** out of every workerd path: localhost lives only in `.env.localdb`, which is loaded **only** by the `dev:local` script (a filename Next never auto-loads), so neither the build nor the preview can pick it up.

| Loop | Runtime | Command | Env source | Supabase target |
|---|---|---|---|---|
| local feature dev | Node (`next dev`) | `pnpm dev:local` | `.env.localdb` (via dotenv-cli) | **local stack** `http://127.0.0.1:54321` |
| dev against hosted | Node (`next dev`) | `pnpm dev` | `.env` | **hosted** project URL |
| `pnpm preview` | `workerd` | `pnpm preview` | `.env` (baked into `next-env.mjs`, prod mode) | **hosted** project URL |
| production | `workerd` | `pnpm deploy` / Workers Builds | `.env` / build vars | **hosted** project URL |

- [ ] **Rule of thumb:** build features with `pnpm dev:local` (local stack); validate Workers-runtime behavior with `pnpm preview` (the Phase 4 gate), which always uses `.env` (hosted). No file editing to switch — it's the command you run.
- [ ] **Decision (current):** one Supabase project — **production** — for everything; a dedicated **staging** project is deferred. **Consequence:** `pnpm preview` and Phase 6 branch/preview deployments run against **production data**, so (a) keep destructive testing on the local stack, and (b) gate preview URLs behind **Cloudflare Access** (Phase 6) so pre-event claim state can't leak. Revisit with a staging project + a second build-var set when the claim code lands.
