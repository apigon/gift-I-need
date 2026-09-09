---
starter_id: next
package_manager: pnpm
project_name: gin
hints:
  language_family: js
  team_size: solo
  deployment_target: cloudflare-workers
  ci_provider: cloudflare-git-integration
  ci_default_flow: auto-deploy-on-merge
  bootstrapper_confidence: verified
  path_taken: custom
  quality_override: false
  self_check_answers:
    typed: true
    from_official_starter: true
    conventions: true
    docs_current: true
    can_judge_agent: true
  has_auth: true
  has_payments: false
  has_realtime: false
  has_ai: false
  has_background_jobs: false
---

## Why this stack

> **Corrected 2026-09-08.** This document originally named Vercel as the deployment target and GitHub Actions as the CI provider. The platform decision was subsequently made in favour of Cloudflare Workers (`context/foundation/infrastructure.md`, researched 2026-06-24) and that is what the repo actually deploys — `wrangler.jsonc` and `open-next.config.ts` are authoritative. The `deployment_target` / `ci_provider` hints and the paragraph below have been updated to match; the platform comparison that produced the decision lives in `infrastructure.md`, where Vercel is recorded as the runner-up.

GIN is a solo-built, after-hours web app with a 4-week MVP timeline, a single technology-forcing feature (email + password auth), and a medium-scale user base that does not require realtime connections. Next.js (App Router + TypeScript) serves as the full-stack framework: the frontend is React 19 with server components, and the backend is Node.js running on Cloudflare Workers via the `@opennextjs/cloudflare` adapter — exposed through Server Actions for mutations, with Next.js API Routes (`app/api/`) reserved for endpoints that need a real HTTP surface. No separate backend service is needed; the runtime is embedded in the Next.js deployment. Supabase provides the PostgreSQL database and Auth SDK (email + password), wired manually into the Next.js backend — a well-documented, mainstream pattern. Drizzle or Prisma can be layered on top for type-safe database access. Cloudflare Workers is the deployment target: a flat $5/mo Workers Paid tier with no commercial-use restriction, and PR previews plus auto-deploy on push via Cloudflare's Git integration (Workers Builds) suit the solo CI/CD flow — no GitHub Actions needed. The accepted cost is the OpenNext adapter sitting between Next.js releases and the `workerd` runtime, which can lag point releases.
