# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Next.js 16 is not what you know

This version contains breaking changes from Next.js 13/14/15. Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices — APIs, file conventions, and server/client boundaries may all differ from training data.

## Key business logic

The organizer's view **must never** expose claim status, claimer identity, or claim counts before the reveal (automatic at 00:00 on `event_date + 2` in the event's timezone; manual unlock from `event_date + 1`) — this holds under concurrent updates, page refresh, and direct URL access. Enforce this at the data layer — RLS and the `private.reveal_open` RPC gate in Postgres — never by a parallel app-side filter.

- Claims are reachable only through the `get_shared_*` / `claim_item` / `mark_given` / `unlock_event` RPCs — never a direct table read or write.
- List reads for the shared page go through `src/lib/lists/shared-list.ts`, never cached (no `unstable_cache`, `force-cache`, or `revalidate`).
- Every new table ships its grants, RLS policies and pgTAP coverage in the same migration.

## Access control

- Unauthenticated visitors may browse any shared list (read-only)
- Claiming an item requires sign-in
- All other writes require authentication
- No admin role in v1 — all accounts have equal capabilities

## Project

**GIN (Gift I Need)** — a gift-coordination web app. Event organizers create a gift-idea list and share a link; guests browse and claim items. The organizer cannot see claim status until after the event date (hard business rule — no bypass).

See `@context/foundation/prd.md` for full requirements and `@context/foundation/tech-stack.md` for stack rationale.

## Commands

```bash
pnpm dev        # start dev server (Next.js, port 3000)
pnpm build      # production build
pnpm lint       # ESLint (next/core-web-vitals + next/typescript)
pnpm test             # unit tests (Vitest)
pnpm test:db          # pgTAP suite — needs `colima start` and `supabase start`
pnpm test:integration # local-stack race test — needs `colima start` and `supabase start`
```

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript (strict)
- **Tailwind CSS v4** — different from v3; `@apply` and config syntax changed
- **Supabase** — PostgreSQL + email/password Auth SDK, wired via the anon key plus RLS, with migrations in `supabase/migrations/`
- **Cloudflare Workers** via `@opennextjs/cloudflare` (not Vercel) — mutations go in Server Actions (`"use server"`), read-heavy routes in Server Components; API Routes (`app/api/`) only for endpoints that need an HTTP surface (webhooks, external clients). `wrangler.jsonc` + `open-next.config.ts` are authoritative; middleware runs on the **Edge** runtime
- Package manager: **pnpm only** — never npm or yarn

## Path alias

`@/*` maps to `./src/*` — use it for all project imports.

## Code structure convention

- Use feature based architecture as much as possible
- Child components should sit in ./{currentParentDir}/components/{componentNameDir}
- Shared components should sit in src/components/{componentNameDir}
- Each `components/` directory exposes a single `index.ts` barrel that re-exports every component inside it. The barrel sits at `components/index.ts` — **not** one per component subdirectory — and consumers import from the `components` directory itself:

  ```
  src/app/(auth)/login/
  ├── page.tsx                       // import { SignInForm } from "./components";
  └── components/
      ├── index.ts                   // export { SignInForm } from "./sign-in-form/sign-in-form";
      └── sign-in-form/
          └── sign-in-form.tsx
  ```
- All unit tests should sit in same directory as SUT

## Design system

- Use only semantic tokens (`bg-canvas`, `text-fg`, `border-edge`, `text-title`, `rounded-control`, …) — never raw Tailwind palette classes, arbitrary hex, or `dark:` variants. This is lint-enforced (`eslint.config.mjs`).
- Primitives come from `@/components` (Heading, Text, Button, Link, Input, StatusBadge, Alert, Toaster). `className` on a primitive is for layout only (margin, width, flex placement) — never colour or typography.
- A claim/item status always renders through `StatusBadge`, with its label visible — never colour-only.
- Toasts (`notify` from `@/components`) supplement an inline state change (e.g. Button `pending`, then a `StatusBadge` flip) and must never be the only confirmation.
- Adding a new token means adding it to both `src/app/globals.css` and the `/design-system` showcase.
- `context/changes/design-system-baseline/palette-proof.html` is the approved colour reference.
- Primary buttons use `bg-primary`/`text-on-primary` (purple). `brand-rose` is decorative only — never a control fill.
- Use `Link` from `@/components`, never `next/link` directly (lint-enforced).

## Branching and PR convention

Branch names start with the board **Key** of the roadmap issue they deliver:

```
GIN-<issue-number>-<change-id>      # e.g. GIN-8-email-password-auth
```

The `<change-id>` half matches the `context/changes/<change-id>/` folder, so the
branch, the change folder, and the board ticket all read as one unit. Multi-phase
plans stay on a single branch — do not add a `-phase-N` suffix.

**The branch name is a label, not a mechanism.** Nothing about it updates the
board on its own. Two separate things do the real work:

1. **`Closes #<n>` in the PR body** (see `.github/pull_request_template.md`) is
   what closes the issue on merge and lets GitHub Projects' built-in
   "item closed → Done" workflow move the ticket. Without that line the board
   will not update, whatever the branch is called.
2. **A linked-branch record** on the issue is what makes `gh pr create`
   pre-fill that `Closes #<n>` line and makes the branch show up in the issue's
   Development panel.

Create the branch so it is linked from the start — the API creates the ref and
the link together:

```bash
gh api graphql -f query='
  mutation {
    createLinkedBranch(input:{
      issueId:"<issue node id>"
      oid:"<base commit sha>"
      name:"GIN-<n>-<change-id>"
      repositoryId:"<repo node id>"
    }) { linkedBranch { id ref { name } } }
  }'
git fetch origin && git checkout GIN-<n>-<change-id>
```

`createLinkedBranch` **creates** a ref; it will not adopt one that already
exists. Pushing the branch first makes the mutation return
`{"linkedBranch": null}` with no error — a silent no-op. If that happens, delete
the remote ref (confirm it has no unique commits first) and re-run the mutation.

Node ids come from:

```bash
gh api graphql -f query='
  query { repository(owner:"apigon", name:"gift-I-need") {
    id issue(number:<n>) { id }
  } }'
```

When starting work on an issue, also move its board Status to **In Progress**
and self-assign it; both are manual, neither is automated.

<!-- BEGIN @przeprogramowani/10x-cli -->

## 10xDevs AI Toolkit - Module 3, Lesson 1

Open Module 3 by producing a **durable, risk-first quality contract** before any test is written — then drive each rollout phase through the standard change chain.

```
PRD + roadmap + archive
        │
        ▼
   /10x-test-plan  ──►  context/foundation/test-plan.md  (strategy §1–§5 frozen + cookbook §6 grows)
        │
        ▼  (one rollout phase at a time, /clear between handoffs)
   /10x-new ──► /10x-research ──► /10x-plan ──► /10x-implement
```

`/10x-test-plan` is a **stateful orchestrator**, not a one-shot generator. On first run it writes the phased rollout to `context/foundation/test-plan.md`. On every subsequent run it re-derives state from on-disk artifacts and presents the next handoff. The lesson focus is **strategy and rollout sequencing, not configuration**. Hooks, MCP servers, and CI YAML are configured in later lessons of this module.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Quality strategy as a rules-file (lesson focus)** | |
| `/10x-test-plan` | You have a PRD (and ideally a roadmap and a few archived slices) and you are about to write the project's first tests, or you noticed that AI-generated tests are landing on helpers while critical flows go uncovered. First invocation runs discovery (PRD + roadmap + archive + hot-spot scan), a 5-question user interview, and a synthesis pass with a mandatory challenger check, then writes `test-plan.md` in `context/foundation/` with a risk map (5–7 failure scenarios), a phased rollout table, a stack table, a quality-gates table, a cookbook section (`§6`, fills in as phases ship), and a negative-space section (what we deliberately don't test). Subsequent invocations advance the rollout one handoff at a time. |
| `/10x-test-plan --status` | A `test-plan.md` already exists and you want a compact snapshot of where the rollout stands — which phases are `not started`, `change opened`, `researched`, `planned`, `implementing`, or `complete`, and what the next action is. Does no work; safe to run any time. |
| `/10x-test-plan --refresh` | A `test-plan.md` already exists and one of: a new top-3 risk surfaced from the roadmap or archive, a tool's `checked:` date is older than three months, the project's tech stack changed, or §7 negative-space no longer matches what the team believes. Opens a new `test-plan-refresh-<YYYY-MM-DD>` change folder rather than editing the guide in place. |

### Rollout chain — what happens after the guide is written

The guide's §3 *Phased Rollout* table is the orchestrator's state. For each non-`complete` row the orchestrator selects the next handoff based on which artifacts exist in `context/changes/<change-id>/`:

| State on disk | Next handoff | Status transitions to |
| --- | --- | --- |
| change folder missing | `/10x-new <change-id>` | `change opened` |
| `change.md` only | `/10x-research` (with a risks-to-verify brief) | `researched` |
| `+ research.md` | `/10x-plan` (with cost × signal + cookbook-update constraints) | `planned` |
| `+ plan.md` with pending `## Progress` items | `/10x-implement <change-id> phase <N>` | `implementing` / `complete` |
| `+ plan.md` fully `[x]` | Mark §3 row `complete`; loop to next pending row | — |

Each handoff is a **STOP point**. The orchestrator copies the next command to the clipboard, asks the user to `/clear` and run it, then exits. Re-invoke `/10x-test-plan` (no arguments) to advance.

### Risk-first prioritization rules

- Risks are **failure scenarios in user / business terms**, not test names. "Logged-out user reaches paid content via stale token" is a risk; "test the login form" is not.
- 5 to 7 risks. Fewer is too coarse; more makes prioritization useless.
- Impact and likelihood are user/business ratings, not technical complexity.
- Every risk traces to a source: PRD section, archived slice, roadmap entry, Phase 2 interview question, hot-spot **directory** with churn count, or a tech-stack constraint. No invented risks.
- **Signal, not knowledge.** §2 cites *evidence that raised the risk*, never a file as "where the failure lives." File:line anchors, function names, schema names, and module names are forbidden in §2 — they belong in `/10x-research`'s output, produced per rollout phase against current code. The plan is a QA spec; it is not a code audit.
- Coverage is not the metric. **Risk coverage** is the metric.

### Dual-layer mapping rules

- Classic layer first: the cheapest test that gives a real signal wins. Promote to e2e only when no cheaper layer covers the risk.
- AI-native layer second, and only where it adds signal classic tests do not give cheaply.
- Every AI-native row has a **"When NOT to use"** line. If you cannot write one, drop the row.
- Every tool name carries a `checked: <YYYY-MM-DD>` date. Tool names are examples of the category, not endorsements.
- Both layers must be non-empty in the final guide if the project warrants them. Classic-only is a 2020 plan; AI-native-only is hype. AI-native phases are not mandatory — include them only when the brief justified them under cost × signal.

### Quality gates rules

- Required gates (lint, typecheck, unit+integration, e2e on critical flows) must map to actual CI steps. If a required gate is not yet wired, mark it as `required after §3 Phase <N>` and let the named rollout phase wire it.
- Post-edit hook is **recommended local**, not a CI substitute.
- Multimodal visual review is **selective**, applied to 1–3 critical screens, not to every page.
- Vision-driven fallback (Anthropic Computer Use or OpenAI CUA) is reserved for DOM-unreachable surfaces; expensive per action.

### Cookbook patterns (§6) — fills in over time

`test-plan.md` is both a phased strategy and a **growing cookbook**. §6 starts as placeholders (`TBD — see §3 Phase <N>`) and fills in incrementally — each rollout phase's plan ends with a sub-phase that updates the relevant §6 entry (location, naming, reference test, run command). After Module 3 completes, §6 becomes the canonical answer to "how do I add a test for X in this project?" — and is what `/10x-tdd` reads in Lesson 2.

### Lesson boundaries

- Do not write test code. That is Lesson 2 (`/10x-tdd` and unit-test authoring).
- Do not configure hooks, hook lifecycle, or debugging hooks. That is Lesson 3.
- Do not configure MCP servers, Playwright API, e2e code, or multimodal scenario code. That is Lesson 4.
- Do not run the bug-to-fix-to-regression-test workflow. That is Lesson 5.
- Do not author CI/CD pipelines from scratch or write GitHub Actions YAML. The guide names gates; configuration is owned by Module 1 Lesson 5 and Module 2 Lesson 5.
- Do not benchmark multimodal models. Cite criteria (cost, latency, agent-friendliness), never a ranking.
- Do not read the codebase for knowledge (call graphs, schemas, "which file owns this failure"). That is `/10x-research`'s job, per rollout phase.

### Paths used by this lesson

- `context/foundation/test-plan.md` — the quality contract produced and maintained by `/10x-test-plan`
- `context/foundation/prd.md` — primary risk source
- `context/foundation/roadmap.md` — likelihood weighting
- `context/foundation/tech-stack.md` — stack input (when present)
- `context/archive/<change-id>/plan.md` — implemented risk surface
- `context/changes/<change-id>/` — per-rollout-phase change folder (one per row in §3)

<!-- END @przeprogramowani/10x-cli -->
