---
project: "GIN (Gift I Need)"
researched_at: 2026-06-24
recommended_platform: Cloudflare (Workers + @opennextjs/cloudflare)
runner_up: Vercel
context_type: mvp
tech_stack:
  language: TypeScript
  framework: Next.js 16 (App Router) + React 19
  runtime: Node.js (via @opennextjs/cloudflare on Cloudflare Workers)
---

## Recommendation

**Deploy on Cloudflare (Workers via the `@opennextjs/cloudflare` adapter).**

Chosen by the user after the anti-bias cross-check, swapping from the initial leader (Vercel). Cloudflare scores highest on agent ergonomics — `llms.txt`/`llms-full.txt` docs, a full `wrangler` CLI loop (deploy / rollback / tail), and several MCP servers (docs, Workers Builds, Observability) — at a predictable flat **$5/mo** Workers Paid tier with no commercial-use restriction. The accepted trade-off vs. Vercel is the **OpenNext build layer**: Cloudflare does not maintain Next.js, so the adapter sits between Next.js releases and the `workerd` runtime and can lag point releases. Supabase (Postgres + Auth) stays external on every candidate — no platform here ships native email/password auth — so the platform choice is largely orthogonal to GIN's hardest requirement (the organizer-blindness business rule, enforced in Supabase).

## Platform Comparison

Scored against the five agent-friendly criteria. Hard filters first: Q1 (persistent connections) = **No**, so nothing was dropped on the serverless/persistent axis; all six support the Node/Next.js 16 runtime (Cloudflare/Netlify via OpenNext, Fly/Railway/Render as a self-managed Node server), so none were disqualified on runtime. The differentiator the five criteria under-weight is **Next.js 16-native support**: Vercel maintains Next.js (zero adapter risk); everyone else runs it through an adapter or container.

| Platform | CLI-first | Managed/Serverless | Agent-readable docs | Stable deploy API | MCP / Integration |
|---|---|---|---|---|---|
| **Cloudflare** | Pass | Pass | Pass (`llms.txt`) | Partial (OpenNext build layer) | Pass (multiple, beta-grade) |
| **Vercel** | Pass | Pass | Pass (`llms.txt`) | Pass | Partial (MCP read-only, public beta) |
| **Render** | Partial (no CLI rollback) | Partial (persistent Node, not serverless) | Pass (`llms.txt`) | Pass | Pass (MCP GA, cannot delete) |
| **Netlify** | Partial (no CLI rollback) | Pass | Pass (`llms.txt`) | Pass | Pass (MCP GA) |
| **Fly.io** | Pass | Partial (you own a Dockerfile) | Pass (markdown on GitHub) | Pass | Partial (MCP experimental) |
| **Railway** | Partial (no CLI rollback) | Partial (long-lived container) | Pass (`.md` docs) | Pass | Partial (MCP beta) |

**Per-platform notes:**

- **Cloudflare** — Strongest agent ergonomics and cheapest predictable price ($5 flat). `@opennextjs/cloudflare` on Workers is the current official path (the Pages-based `@cloudflare/next-on-pages` is legacy) and explicitly supports Next.js 16, App Router, SSR/SSG/PPR, ISR, Route Handlers, Middleware (except Node.js Middleware), and image optimization. Requires `nodejs_compat` + compatibility date ≥ `2024-09-23`. The deploy-API "Partial" reflects the OpenNext build step that sits between framework and runtime — real friction, version-lag risk, and a 3 MiB compressed Worker size cap (10 MiB paid).
- **Vercel** *(runner-up)* — Next.js-native, zero-config, fullest agent-operable CLI + best docs. Dropped from #1 by user choice. Two structural costs: Hobby is **non-commercial** (a launched GIN needs **Pro $20/seat/mo**), and there are **no persistent connections** (live "taken" updates must go through Supabase Realtime). Vercel Postgres is deprecated → Neon marketplace (irrelevant here; Supabase is the DB). MCP is read-only + public beta.
- **Render** *(third)* — Simplest mental model (persistent Node web service running `next start`), GA CLI, and a GA MCP server that safely **cannot delete** services/DBs. Frictions: free tier cold-starts (30–60s) → budget **$7/mo Starter** from day one, and **no CLI rollback** (dashboard only).
- **Netlify** — Next.js 16 via OpenNext (shipped 2025-10-21), official GA MCP server. Held back by **no CLI rollback** and a **credit hard-cap that suspends the site** on a spike with no overage grace. Netlify Identity is deprecated — Netlify itself recommends Supabase Auth.
- **Fly.io** — Real persistent-connection support and a full `flyctl` loop, but you own a **Dockerfile** (more ops surface than an MVP with no realtime requirement needs). No free tier; ~$5/mo PAYG. Managed Postgres is preview/region-limited (moot — Supabase external).
- **Railway** — Clean Railpack builds, one-click databases, good `.md` docs. **No CLI rollback** (dashboard), $5/mo floor, requires `output: "standalone"`. Container PaaS overhead without a persistent-connection need to justify it.

### Shortlisted Platforms

#### 1. Cloudflare (Recommended)

Best agent-operability of the field (`llms.txt` docs, complete `wrangler` CLI, multiple MCP servers) at a flat, commercial-OK **$5/mo**. Edge-native (a hedge on the undecided global-reach question). Co-locatable primitives (D1, R2, KV, Queues, Hyperdrive for pooling Supabase Postgres) if ever needed. Chosen with eyes open to the OpenNext build trade-off.

#### 2. Vercel (Runner-up)

The lowest-friction path for this exact stack — Next.js-native, zero-config, no adapter in the middle. The gap that made it runner-up rather than the pick: commercial use forces Pro pricing, and the platform is otherwise close to Cloudflare on agent-operability while costing more and locking softly into Vercel-isms.

#### 3. Render

The most boring-in-a-good-way option: a persistent Node server, GA CLI, and a deliberately safe MCP. Loses to the top two on serverless/edge posture and CLI-rollback completeness, and it costs $7/mo from day one to avoid cold starts.

## Anti-Bias Cross-Check: Cloudflare

### Devil's Advocate — Weaknesses

1. **The OpenNext adapter is a third party between you and your framework.** Cloudflare doesn't maintain Next.js; `@opennextjs/cloudflare` sits between Next.js releases and `workerd`, so a Next.js 16 point release can outrun the adapter and you wait for it to catch up.
2. **Worker size cap (3 MiB compressed free / 10 MiB paid).** Next.js + Supabase SDK + an ORM can bump the ceiling, forcing tree-shaking/code-splitting at MVP stage.
3. **`workerd` is not Node.** `nodejs_compat` covers most but not all; libraries assuming full Node (some crypto/fs/native addons, certain ORM engines) can fail at runtime, not build. Supabase SSR cookie handling must work under the Workers fetch model.
4. **Build complexity vs. git-push.** OpenNext build + `wrangler deploy`, plus KV/R2 binding wiring for ISR/cache — more to misconfigure than zero-config, and the dev has no prior Cloudflare familiarity.
5. **The surprise rule still lives entirely in Supabase**, and Cloudflare adds a Hyperdrive-vs-direct-connection pooling decision where a misconfig can break queries under the concurrent-claim load GIN's duplicate-prevention depends on.

### Pre-Mortem — How This Could Fail

The Cloudflare bet cost the thing it was meant to save: time. The solo dev, new to Workers, spent week one not on GIN's features but on the OpenNext pipeline — compat flags, the 3 MiB cap forcing dependency surgery, and making Supabase's SSR cookies behave under `workerd`. Then Next.js shipped a 16.x point release; the adapter hadn't caught up, and a routine `pnpm update` broke the build two days before the first real event. Because the adapter sits between framework and runtime, the dev couldn't just read Next.js docs — they were debugging a three-way interaction nobody fully documents. Meanwhile a driver assumption that worked locally on Node failed silently on the edge runtime. The surprise rule, still entirely in Supabase RLS, was never the problem — but the energy that should have hardened it went into fighting the deploy layer. The flat $5/mo was real savings; the weeks of yak-shaving were not.

### Unknown Unknowns

- **`@cloudflare/next-on-pages` (the Pages path) is legacy.** Much of the Next.js-on-Cloudflare content online uses it; the current path is `@opennextjs/cloudflare` on Workers. Following stale Pages guides is an active trap.
- **Wrangler Pages ≠ Workers commands.** `wrangler pages deploy` and `wrangler deploy` target different products; copying a Pages CI config silently misdeploys.
- **Supabase Postgres from Workers should go through Hyperdrive** for connection pooling — direct edge connections can exhaust Postgres connection limits under concurrent claims.
- **The MCP servers aren't labeled GA/beta** and evolve — treat them as convenience; keep `wrangler` as the stable deploy path.
- **Worker CPU-time limits + cold edge start** — SSR + Supabase round-trips consume CPU-ms per request; heavy Server Components can brush limits the "unlimited scale" framing hides.

## Operational Story

- **Preview deploys**: `wrangler versions upload` produces a preview version URL without promoting it; PR/branch previews via Workers Builds (Git integration) or CI calling `wrangler versions upload`. Gate preview URLs behind Cloudflare Access if they expose pre-event claim state during testing.
- **Secrets**: Supabase keys and tokens live in **Workers Secrets** (`wrangler secret put SUPABASE_SERVICE_ROLE_KEY`) and in CI as repo secrets — never committed to `wrangler.toml` or `.mcp.json`. The Cloudflare API token is scoped to Workers for this one project (no DNS, no unrelated Secrets, no billing). Rotate via `wrangler secret put` (re-put overwrites).
- **Rollback**: `wrangler rollback [version-id]` reverts to a prior version deterministically; `wrangler versions list` shows candidates. Time-to-revert is seconds. Caveat: Supabase schema migrations do **not** roll back with the Worker — coordinate DB migrations separately.
- **Approval**: an agent may run `wrangler deploy` / `wrangler versions upload` / `wrangler tail` / `wrangler rollback` unattended. **Human-only**: rotating the Supabase service-role key, dropping/altering production Postgres, deleting the Worker or KV/R2 namespaces, and changing the billing tier — panel-by-hand even if the agent suggests them.
- **Logs**: `wrangler tail` streams live runtime logs (read-only); Workers Builds logs are viewable via the Observability MCP server or dashboard. The agent reads logs via `wrangler tail --format json` for structured parsing.

## Risk Register

| Risk | Source | Likelihood | Impact | Mitigation |
|---|---|---|---|---|
| OpenNext adapter lags a Next.js 16.x release and breaks the build | Devil's advocate / Pre-mortem | M | H | Pin Next.js + `@opennextjs/cloudflare` versions; test `pnpm update` on a branch before merge; don't auto-bump Next near a launch date |
| Organizer-blindness leaks via a service-role key bypassing Supabase RLS | Devil's advocate / Pre-mortem | M | H | Enforce the rule at the data layer (query-level filter on event date) per CLAUDE.md; default to anon key + RLS; reserve service-role for server-only paths; add a test before any claim-status code ships |
| Worker bundle exceeds 3 MiB (free) / 10 MiB (paid) cap | Devil's advocate | M | M | Watch bundle size on build; tree-shake; lazy-load heavy deps; upgrade to paid (already $5/mo) for the 10 MiB ceiling |
| `workerd` Node-incompat surfaces a library failure at runtime | Devil's advocate / Unknown unknowns | M | M | Set `nodejs_compat` + compat date ≥ `2024-09-23`; prefer Workers-compatible Supabase SSR client; smoke-test auth/session on a deployed preview, not just local |
| Supabase Postgres connection exhaustion from edge under concurrent claims | Unknown unknowns | L | H | Route Postgres through **Hyperdrive** for pooling; or use Supabase's pooled connection string; load-test the claim path |
| Following legacy `next-on-pages` / mixing Pages vs Workers `wrangler` commands | Unknown unknowns / Research finding | M | M | Use only `@opennextjs/cloudflare` + Workers `wrangler deploy`; document the exact command set in the deploy plan |
| Live "taken" status not truly real-time (Workers are request-scoped) | Research finding | M | M | Use Supabase Realtime for claim fan-out (or Durable Objects if ever needed); don't assume the platform pushes updates |
| MCP server behavior shifts (unlabeled GA/beta) | Unknown unknowns | L | L | Keep `wrangler` CLI as the stable deploy/rollback path; treat MCP as convenience for live-state queries |
| No test runner configured yet (CLAUDE.md) — RLS/caching regressions ship uncaught | Pre-mortem | M | H | Add a test runner before writing claim-status logic; cover the organizer-blindness guarantee explicitly |

## Getting Started

Versions matter — validate against the exact Next.js 16 / adapter versions in `tech-stack.md`, not general platform tutorials.

1. **Add the adapter (pnpm only):** `pnpm add -D @opennextjs/cloudflare wrangler` — confirm the adapter version supports your pinned Next.js 16 minor.
2. **Configure for Workers:** create `wrangler.toml` (or `wrangler.jsonc`) with `compatibility_flags = ["nodejs_compat"]` and `compatibility_date` ≥ `2024-09-23`; add the `open-next.config.ts`. Use the Workers path (`@opennextjs/cloudflare`), **not** `@cloudflare/next-on-pages`.
3. **Local dev fidelity:** the Next.js dev server (`pnpm dev`) is the day-to-day loop; use the OpenNext preview (`pnpm exec opennextjs-cloudflare build && pnpm exec wrangler dev`) only to validate Workers-runtime behavior before deploying — it is not a replacement for `next dev`.
4. **Wire Supabase as Workers Secrets:** `pnpm exec wrangler secret put SUPABASE_URL` / `SUPABASE_ANON_KEY` / (server-only) `SUPABASE_SERVICE_ROLE_KEY`. Do not commit them.
5. **First deploy:** `pnpm exec opennextjs-cloudflare build && pnpm exec wrangler deploy`. Verify with `pnpm exec wrangler tail`. Take the next step (Plan Mode deploy) to produce the reviewed `context/deployment/deploy-plan.md` before any production mutation.

## Out of Scope

The following were not evaluated in this research:
- Docker image configuration
- CI/CD pipeline setup
- Production-scale architecture (multi-region, HA, DR)
