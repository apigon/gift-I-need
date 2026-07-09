# Plan: GitHub Projects roadmap board for GIN (native automation)

## Context

`context/foundation/roadmap.md` defines 7 backlog items (F-01, F-02, S-01…S-05) but there's
no place to track them. The goal is a **GitHub Projects** board that: (1) is a ticket board,
(2) visualizes the roadmap on a timeline, and (3) auto-transitions tickets to **Done** on PR
merge — with **as much setup as possible done by the agent via `gh` CLI / GitHub MCP**.

Decisions already made (do not re-litigate):
- **Fully native automation only** — no fine-grained PAT, no GitHub Actions, no local git hooks.
- **Merged → Done is native**: GitHub Projects ships two default built-in workflows
  (*item closed → Done*, *PR merged → Done*). A PR whose body says `Closes #<issue>` auto-closes
  the linked roadmap issue on merge → it lands in **Done** with zero custom infra.
- **No "PR opened → In Review" automation** (GitHub has no native trigger for it, and the default
  `GITHUB_TOKEN` can't write a user-owned Project). Move **In Progress** / **In Review**
  manually from the board.
- **Branch naming is cosmetic**: convention `type/<ticket-id>` (e.g. `feat/5-claim-gift-item`).
  Nothing depends on it — the `Closes #N` link in the PR is what drives Done.
- Repo is **`apigon/gift-I-need`** (User-owned, not org), default branch **`main`**, issues enabled.
- Primary tool: **`gh` CLI 2.95**. The GitHub MCP server's Projects toolset is an optional
  substitute for the same reads/writes.

Intended outcome: a linked GitHub Project with a Roadmap view and 7 seeded, field-populated
tickets; merges flow to Done automatically; the whole thing re-creatable from a committed script.

---

## Prerequisites (MANUAL — do before the agent starts)

- [x] **P1 — Grant `gh` the Projects scope.** Current token scopes are `gist, read:org, repo, workflow`
      (no `project`), so every `gh project …` call fails today. Run in this session:
      `! gh auth refresh -s project` (opens a browser; grants read+write to Projects).
      **Verify:** `gh project list --owner apigon` returns without a scope error.

> Three further small **web-UI** steps (Phase B below) are unavoidable — editing built-in Status
> field options, toggling the Auto-add workflow, and creating the Roadmap-layout view are the only
> things `gh` CLI / MCP genuinely cannot do. They're flagged `[MANUAL/UI]` inline and take ~3 min total.

---

## Phase A — Create the project & custom fields  *(AGENT · `gh` CLI)*

- [x] **A1.** Create the project and capture its number + node id:
      `gh project create --owner apigon --title "GIN Roadmap"`.
- [x] **A2.** Link it to the repo so it appears in the Projects tab and Auto-add can target it:
      `gh project link <number> --owner apigon --repo apigon/gift-I-need`.
- [x] **A3.** Create custom fields with `gh project field-create <number> --owner apigon …`:
  - `Key` — `--data-type TEXT` (`GIN-<issue#>`, aligned to the issue number; branch handle + title prefix)
  - `Roadmap ID` — `--data-type TEXT` (holds `F-01`, `S-03`, …)
  - `Change ID` — `--data-type TEXT` (kebab id, e.g. `claim-gift-item`)
  - `Kind` — `--data-type SINGLE_SELECT --single-select-options "Foundation,Slice"`
  - `Stream` — `--data-type SINGLE_SELECT --single-select-options "A,B,C,D"`
  - `Start` — `--data-type DATE` (for the Roadmap timeline)
  - `Target` — `--data-type DATE` (for the Roadmap timeline)
- [x] **A4.** Read back ids for later field-setting:
      `gh project field-list <number> --owner apigon --format json` → record project node id,
      each field id, and the built-in **Status** option ids into the Phase D seed script.

> Status stays the **built-in** single-select field — the native *merged/closed → Done* automations
> target it specifically, so we must not replace it with a custom field.

## Phase B — Configure Status options & native workflows  *(MANUAL/UI · ~3 min)*

- [x] **B1 [MANUAL/UI].** In the project → **Settings → Fields → Status**, set options to:
      `Todo`, `In Progress`, `In Review`, `Done`.
      (gh CLI can create new fields but cannot edit built-in field options.)
- [ ] **B2 [MANUAL/UI].** **Settings → Workflows → Auto-add to project** → enable, filter
      `is:issue label:roadmap`, repo `apigon/gift-I-need`. Confirm the default
      *"When an item is closed → set Status: Done"* and *"When a PR is merged → set Status: Done"*
      workflows are **On** (they're on by default).
- [x] **B3 [MANUAL/UI].** New **view** → layout **Roadmap**, set the date-range fields to
      **Start** / **Target**. This is the required visualization (#3); gh can't create views/layouts.

## Phase C — Seed the 7 roadmap tickets  *(AGENT · `gh` CLI)*

- [x] **C1.** Create labels (`gh label create`): `roadmap`, `kind:foundation`, `kind:slice`,
      `stream:a`, `stream:b`, `stream:c`, `stream:d`, `north-star`.
- [x] **C2.** Create one issue per roadmap item (`gh issue create`), titles from roadmap
      `## Backlog Handoff` (e.g. F-02 → *"Schema + enforce organizer-blindness & single-claim, with tests"*).
      Body carries: Outcome, PRD refs, Prerequisites (by Roadmap ID), Unlocks (foundations),
      a `change-id: <kebab>` line, and a link to the roadmap section. Labels: `roadmap` +
      `kind:*` + `stream:*` (+ `north-star` on S-03). Capture the resulting issue numbers.
- [x] **C3.** Add each issue to the project (`gh project item-add <number> --owner apigon --url <issue-url>`)
      — explicit add is deterministic even though Auto-add (B2) would also catch them.
- [x] **C4.** Set field values per item (`gh project item-edit --project-id <id> --id <item-id>
      --field-id <fid> --text|--single-select-option-id|--date …`) from the ids captured in A4:
      `Roadmap ID`, `Change ID`, `Kind`, `Stream`, and **Status** — all 7 seed to **Todo**
      (readiness stays in the roadmap/prereqs, not duplicated on the board). Leave `Start`/`Target` empty
      for the user to drag on the Roadmap view (preserves the roadmap's deliberate no-estimates stance).

## Phase D — Repo hygiene that makes the native flow work  *(AGENT)*

- [x] **D1.** `.github/pull_request_template.md` — the load-bearing piece: a `Closes #<issue>` line
      + a short checklist. This is what converts a merge into an auto-Done.
- [x] **D2.** `scripts/seed-github-project.sh` — idempotent re-runnable script encoding A1–A3 and
      C1–C4 (guards against duplicate issues by label/title; reads field/option ids from
      `gh project field-list`). Serves as the executable record of the setup.
- [x] **D3.** `docs/reference/github-project-board.md` — documents the board: field list, the
      `type/<ticket-id>` branch convention, the `Closes #N` PR convention, which transitions are
      automatic (merge→Done) vs manual (In Progress / In Review), and how to re-run the seed script.

## Phase E — Verify end-to-end

- [x] **E1.** `gh project item-list <number> --owner apigon --format json` → 7 items, each with
      `Roadmap ID` / `Change ID` / `Kind` / `Stream` / `Status` populated.
- [x] **E2.** Open the **Roadmap** view → 7 tickets render; drag one to confirm Start/Target set.
- [ ] **E3.** Native Done smoke test (low-risk, throwaway — does **not** touch real roadmap issues):
      create a temp `roadmap`-labeled issue → confirm Auto-add put it on the board; make a branch,
      open a trivial PR with body `Closes #<temp>`, merge it → confirm the temp issue moves to
      **Done** automatically; then delete the temp issue/branch. Proves the merge→Done pipeline.

---

## Files created (all new)

- `.github/pull_request_template.md` — `Closes #` PR template (drives native Done).
- `scripts/seed-github-project.sh` — idempotent board-seeding script (`gh` CLI).
- `docs/reference/github-project-board.md` — board + automation reference doc.

No application code changes. Source of truth for ticket content: `context/foundation/roadmap.md`
(`## At a glance` + `## Backlog Handoff` + per-item bodies).

## Reused / referenced

- `context/foundation/roadmap.md` — canonical item list, Change IDs, Streams, PRD refs, statuses.
- `gh` CLI verbs validated as available (2.95): `project create/link/field-create/field-list/
  item-add/item-edit/item-list`, `issue create`, `label create`.
- Optional: GitHub MCP server **Projects toolset** can substitute for the `gh project …` reads/writes
  if preferred; `gh` is the default per the tooling preference.

## Notes / risks

- **P1 is a hard gate** — nothing in Phases A/C runs until the `project` scope is granted.
- **B1–B3 are the only manual mid-flow steps.** If they're skipped: Status columns stay as the
  default Todo/In Progress/Done (C4 Status-seeding degrades to those), no Auto-add, and no Roadmap
  visualization — the board still works but misses requirement #3.
- Merge→Done depends entirely on authors writing `Closes #N` in PRs; the PR template (D1) is the
  reminder. Without it, merged PRs won't move their linked issue.
