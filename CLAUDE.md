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
- **Vercel** serverless — mutations go in Server Actions (`"use server"`), read-heavy routes in Server Components; API Routes (`app/api/`) only for endpoints that need an HTTP surface (webhooks, external clients)
- Package manager: **pnpm only** — never npm or yarn

## Path alias

`@/*` maps to `./src/*` — use it for all project imports.
