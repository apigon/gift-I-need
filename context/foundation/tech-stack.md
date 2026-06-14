---
starter_id: next
package_manager: pnpm
project_name: gin
hints:
  language_family: js
  team_size: solo
  deployment_target: vercel
  ci_provider: github-actions
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

GIN is a solo-built, after-hours web app with a 4-week MVP timeline, a single technology-forcing feature (email + password auth), and a medium-scale user base that does not require realtime connections. Next.js (App Router + TypeScript) serves as the full-stack framework: the frontend is React 19 with server components, and the backend is Node.js running via Vercel serverless functions — exposed through Next.js API Routes (`app/api/`) and Server Actions for mutations. No separate backend service is needed; the Node.js runtime is embedded in the Next.js deployment. Supabase provides the PostgreSQL database and Auth SDK (email + password), wired manually into the Next.js backend — a well-documented, mainstream pattern. Drizzle or Prisma can be layered on top for type-safe database access. Vercel is the natural deployment target: zero-config preview deployments per PR and auto-deploy on merge suit the solo CI/CD flow. GitHub Actions drives CI checks before merge.
