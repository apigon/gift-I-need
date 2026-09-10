# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Critical: Next.js 16 is not what you know

This version contains breaking changes from Next.js 13/14/15. Before writing any Next.js code, read the relevant guide in `node_modules/next/dist/docs/`. Heed deprecation notices — APIs, file conventions, and server/client boundaries may all differ from training data.

## Key business logic

The organizer's view **must never** expose claim status, claimer identity, or claim counts before the event date — this holds under concurrent updates, page refresh, and direct URL access. Enforce this at the data layer (query-level filter on event date), not only in the UI.

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
```

No test runner is configured yet — add one before writing tests.

## Stack

- **Next.js 16** (App Router) + React 19 + TypeScript (strict)
- **Tailwind CSS v4** — different from v3; `@apply` and config syntax changed
- **Supabase** — PostgreSQL + email/password Auth SDK (not yet wired)
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

## 10xDevs AI Toolkit - Module 2, Lesson 1

Move from sprint-zero setup to project orchestration with the **roadmap chain**:

```
(Module 1 foundation docs) -> /10x-roadmap -> backlog-ready roadmap items
```

`/10x-roadmap` is the lesson focus. `/10x-new` is intentionally introduced in Module 2, Lesson 2, when a selected roadmap item becomes an implementation change folder.

### Task Router - Where to start

| Skill                                                                                                                   | Use it when                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Roadmap (lesson focus)**                                                                                              |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-roadmap`                                                                                                          | You have `context/foundation/prd.md` and a scaffolded project baseline, and you need a vertical-first MVP roadmap. The skill reads the PRD, inspects the code baseline, uses available foundation docs such as `tech-stack.md`, `infrastructure.md`, and `deploy-plan.md`, then writes `context/foundation/roadmap.md`. Use it BEFORE creating per-change folders or implementation plans. |
| **Re-run upstream if needed**                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                            |
| `/10x-shape` / `/10x-prd` / `/10x-tech-stack-selector` / `/10x-bootstrapper` / `/10x-agents-md` / `/10x-infra-research` | Bundled from Module 1 so foundation contracts can be fixed before roadmap sequencing. If roadmap generation exposes a PRD gap, repair the PRD before pretending the backlog is ready.                                                                                                                                                                                                      |

### How the chain hands off

- `/10x-roadmap` bridges product and implementation. It does not choose frameworks, design schemas, or write a per-change implementation plan.
- The output is `context/foundation/roadmap.md`: ordered milestones, vertical slices, bounded foundations, dependencies, unknowns, risk, and backlog handoff fields.
- Roadmap items should receive stable human-readable identifiers in backlog tools. The actual `context/changes/<change-id>/` folder is created in Lesson 2 with `/10x-new`.

### Roadmap boundaries

- Default to vertical slices: user-visible outcomes that cross UI, data, business logic, and integrations.
- Horizontal work is allowed only as a bounded enabler that names the downstream vertical milestone it unlocks.
- Avoid orphan horizontal work such as "build the whole database", "build all API endpoints", or "design the whole UI" before the first user-visible flow.
- Roadmap is not a calendar estimate. Do not invent dates, story points, or sprint velocity unless the user explicitly asks for a separate planning artifact.

### Foundation paths used by this lesson

- `context/foundation/prd.md` - input
- `context/foundation/tech-stack.md` - optional input
- `context/foundation/infrastructure.md` - optional input
- `context/deployment/deploy-plan.md` - optional input
- `context/foundation/roadmap.md` - output
- `context/foundation/lessons.md` - recurring rules and pitfalls
- `docs/reference/contract-surfaces.md` - load-bearing names registry

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
