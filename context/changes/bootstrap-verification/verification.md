---
bootstrapped_at: 2026-06-14T16:06:00Z
starter_id: next
starter_name: Next.js
project_name: gin
language_family: js
package_manager: pnpm
cwd_strategy: subdir-then-move
bootstrapper_confidence: verified
phase_3_status: ok
audit_command: "npm audit --json (fell back to pnpm audit --json — pnpm project has no package-lock.json)"
---

## Hand-off

```yaml
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
```

## Why this stack

GIN is a solo-built, after-hours web app with a 4-week MVP timeline, a single technology-forcing feature (email + password auth), and a medium-scale user base that does not require realtime connections. Next.js (App Router + TypeScript) serves as the full-stack framework: the frontend is React 19 with server components, and the backend is Node.js running via Vercel serverless functions — exposed through Next.js API Routes (`app/api/`) and Server Actions for mutations. No separate backend service is needed; the Node.js runtime is embedded in the Next.js deployment. Supabase provides the PostgreSQL database and Auth SDK (email + password), wired manually into the Next.js backend — a well-documented, mainstream pattern. Drizzle or Prisma can be layered on top for type-safe database access. Vercel is the natural deployment target: zero-config preview deployments per PR and auto-deploy on merge suit the solo CI/CD flow. GitHub Actions drives CI checks before merge.

## Pre-scaffold verification

| Signal      | Value                                        | Severity | Notes                                                              |
| ----------- | -------------------------------------------- | -------- | ------------------------------------------------------------------ |
| npm package | create-next-app v16.2.9 published 2026-06-13 | fresh    | resolved from cmd_template; published yesterday                    |
| GitHub repo | not run                                      | n/a      | docs_url (https://nextjs.org/docs) is not a GitHub URL; skipped   |

## Scaffold log

**Resolved invocation**: `npx create-next-app@latest bootstrap-scaffold --ts --tailwind --eslint --app --src-dir --import-alias "@/*" --use-pnpm`

**Note on temp-dir name**: the `subdir-then-move` strategy substitutes `{name}=.bootstrap-scaffold`, but `create-next-app` rejects names starting with a period (npm naming restriction). The temp directory was changed to `bootstrap-scaffold` (no leading dot) for this run. Conflict policy and move-up mechanics were otherwise identical.

**CLI defaults applied** (unprompted options create-next-app selected):
- `--no-react-compiler` (React Compiler disabled)
- `--agents-md` (AGENTS.md generated — moved to cwd per conflict matrix since no existing AGENTS.md)

**Strategy**: subdir-then-move (scaffold into temp directory then move files up)
**Exit code**: 0
**Files moved**: 14
**Conflicts (.scaffold siblings)**: `CLAUDE.md` → `CLAUDE.md.scaffold`, `README.md` → `README.md.scaffold`
**.gitignore handling**: append-merged (cwd had 1 line: `.claude/*`; scaffold's 41 lines appended with `# from next` separator after de-duplication)
**Temp dir cleanup**: deleted (bootstrap-scaffold/ removed after successful move-up)

### Files moved to cwd

| File / Directory   | Resolution         |
| ------------------ | ------------------ |
| AGENTS.md          | moved silently     |
| CLAUDE.md          | → CLAUDE.md.scaffold (cwd wins) |
| README.md          | → README.md.scaffold (cwd wins) |
| eslint.config.mjs  | moved silently     |
| next-env.d.ts      | moved silently     |
| next.config.ts     | moved silently     |
| node_modules/      | moved silently     |
| package.json       | moved silently     |
| pnpm-lock.yaml     | moved silently     |
| postcss.config.mjs | moved silently     |
| public/            | moved silently     |
| src/               | moved silently     |
| tsconfig.json      | moved silently     |
| .next/             | moved silently     |

## Post-scaffold audit

**Tool**: `pnpm audit --json` (fallback — `npm audit --json` requires `package-lock.json`; this project uses `pnpm-lock.yaml`. `pnpm audit` reads the pnpm lockfile directly.)

**Summary**: 0 CRITICAL, 0 HIGH, 1 MODERATE, 0 LOW

**Direct vs transitive**: 0/0/0/0 direct of total 0/0/1/0 — the single MODERATE finding is transitive (via `next→postcss`)

#### CRITICAL findings

None.

#### HIGH findings

None.

#### MODERATE findings

**Package**: `postcss`
**Version found**: 8.4.31
**Advisory**: GHSA-qx2v-qp2m-jg93 / CVE-2026-41305
**CVSS**: 6.1 (MODERATE)
**Path**: `.>next>postcss` (transitive — not a direct dependency)
**Title**: PostCSS has XSS via Unescaped `</style>` in its CSS Stringify Output
**Summary**: PostCSS does not escape `</style>` sequences when stringifying CSS ASTs. When user-submitted CSS is parsed and re-stringified for embedding in HTML `<style>` tags, the sequence breaks out of the style context, enabling XSS.
**Impact**: Affects use cases where user-controlled CSS is passed through PostCSS and embedded in HTML. Not a risk in typical Next.js build pipelines where only trusted CSS is processed.
**Fix**: Upgrade postcss to >= 8.5.10. This is a transitive dependency — Next.js must ship an updated peer dependency for this to resolve automatically.
**Reference**: https://github.com/advisories/GHSA-qx2v-qp2m-jg93

#### LOW / INFO findings

None.

## Hints recorded but not acted on

| Hint                    | Value                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------- |
| bootstrapper_confidence | verified                                                                                       |
| quality_override        | false                                                                                          |
| path_taken              | custom                                                                                         |
| self_check_answers      | typed: true, from_official_starter: true, conventions: true, docs_current: true, can_judge_agent: true |
| team_size               | solo                                                                                           |
| deployment_target       | vercel                                                                                         |
| ci_provider             | github-actions                                                                                 |
| ci_default_flow         | auto-deploy-on-merge                                                                           |
| has_auth                | true                                                                                           |
| has_payments            | false                                                                                          |
| has_realtime            | false                                                                                          |
| has_ai                  | false                                                                                          |
| has_background_jobs     | false                                                                                          |

These hints are preserved in this log for the future M1L4 skill ("Memory Architecture"), which will use them to generate `CLAUDE.md` and `AGENTS.md` with project-appropriate agent context. In v1, bootstrapper reads them for conversation surfacing only — no automated action taken.

## Next steps

Next: a future skill will set up agent context (CLAUDE.md, AGENTS.md). For now, your project is scaffolded and verified — happy hacking.

Useful manual steps in the meantime:
- Review `.scaffold` siblings the conflict policy created (`CLAUDE.md.scaffold`, `README.md.scaffold`) and decide which content to keep.
- The scaffolded `AGENTS.md` (from create-next-app) is now in cwd — review it; the v16.2.9 starter ships a note about API changes versus older training data.
- The single MODERATE audit finding (`postcss` via `next`) is transitive. Monitor for a Next.js release that bumps `postcss` to >= 8.5.10; no immediate action required for a new project with trusted CSS inputs.
- Connect Supabase (auth + database) as your next integration step per the PRD.
- Configure Vercel deployment and GitHub Actions CI per `hints.deployment_target` and `hints.ci_provider`.
