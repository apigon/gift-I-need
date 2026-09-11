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

## Design system

- Use only semantic tokens (`bg-canvas`, `text-fg`, `border-edge`, `text-title`, `rounded-control`, …) — never raw Tailwind palette classes, arbitrary hex, or `dark:` variants. This is lint-enforced (`eslint.config.mjs`).
- Primitives come from `@/components` (Heading, Text, Button, Link, TextField, StatusBadge, Alert, Toaster). `className` on a primitive is for layout only (margin, width, flex placement) — never colour or typography.
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

## 10xDevs AI Toolkit - Module 2, Lesson 3

Review AI-generated code before merge with the **implementation review chain**:

```
/10x-implement -> /10x-impl-review -> triage -> (/10x-lesson | fix | skip | disagree)
```

`/10x-impl-review` is the lesson focus. Review is a quality gate, not an instruction to fix every finding.

### Task Router - Where to start

| Skill | Use it when |
| --- | --- |
| **Code review (lesson focus)** | |
| `/10x-impl-review <change-id>` | You have implemented code and want a structured review before merge. The skill checks plan adherence, scope discipline, safety and quality, architecture, pattern consistency, and success criteria, then presents findings for triage. |
| **Recurring lesson outcome** | |
| `/10x-lesson` | A finding reveals a recurring project rule or agent failure pattern. Record it in `context/foundation/lessons.md` instead of treating it as a one-off note. |

### Triage discipline

- Severity says how bad the finding is. Impact says how much the decision matters now.
- Valid outcomes: fix now, fix differently, skip, accept as risk, record as recurring rule (`/10x-lesson`), disagree.
- Fix critical findings. Do not burn hours on low-impact observations just because the agent found them.
- Conscious skipping of low-impact findings is a valid review outcome, not negligence.
- If you disagree with a finding, record why. Wrong agent reasoning is also signal.

### Review boundaries

- This lesson reviews implemented code. It does not create the plan, execute new phases, or teach CI review.
- Testing strategy and quality gates are introduced in Module 3.
- Do not use `/10x-contract` as a triage outcome in this lesson.

### Paths used by this lesson

- `context/changes/<change-id>/plan.md` - expected implementation contract
- `context/changes/<change-id>/reviews/` - review output
- `context/foundation/lessons.md` - recurring lessons

Skills must not write to `context/archive/`. Archived changes are immutable; if a resolved target path starts with `context/archive/`, abort with: "This change is archived. Open a new change with `/10x-new` instead."

<!-- END @przeprogramowani/10x-cli -->
