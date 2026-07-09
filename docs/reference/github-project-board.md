# GitHub Project board — GIN Roadmap

The **GIN Roadmap** GitHub Project tracks the roadmap items from
`context/foundation/roadmap.md`. Setup and rationale live in
`context/project/github-board.md`; this is the day-to-day reference.

## Fields

| Field          | Type            | Source / meaning                                  |
| -------------- | --------------- | ------------------------------------------------- |
| **Status**     | single-select (built-in) | Board column: Todo · In Progress · In Review · Done |
| **Key**        | text            | `GIN-<issue#>` — the branch handle, **aligned to the issue number** (`GIN-12` == issue #12); also prefixes the issue title |
| **Roadmap ID** | text            | `F-01`, `S-03`, … (order id from the roadmap)      |
| **Change ID**  | text            | kebab id, e.g. `claim-gift-item` (the `/10x-plan` handle) |

## Ticket key ↔ issue number

`Key` is `GIN-<issue-number>`, so the key number and the GitHub issue number are the **same** —
`GIN-12` is issue `#12`. The key is derived from each issue's own number at runtime, so it can never
drift. Branch `feat/GIN-12-…` and PR `Closes #12` therefore use the same number.

| Key    | Issue | Roadmap | Change ID                     |
| ------ | ----- | ------- | ----------------------------- |
| GIN-8  | #8    | F-01    | `email-password-auth`         |
| GIN-9  | #9    | F-02    | `surprise-rule-data-contract` |
| GIN-10 | #10   | S-01    | `create-and-share-event-list` |
| GIN-11 | #11   | S-02    | `browse-shared-list`          |
| GIN-12 | #12   | S-03    | `claim-gift-item` (north star)|
| GIN-13 | #13   | S-04    | `edit-list-items`             |
| GIN-14 | #14   | S-05    | `post-event-reveal`           |
| **Kind**       | single-select   | Foundation · Slice                                |
| **Stream**     | single-select   | A · B · C · D (parallel tracks from the roadmap)   |
| **Start / Target** | date        | Timeline range for the **Roadmap** view (set by dragging) |

## Conventions

- **Branch:** `type/GIN-<n>-<change-id>` — e.g. `feat/GIN-12-claim-gift-item`. Cosmetic only; nothing
  keys off it.
- **PR:** put `Closes #<n>` in the body (the PR template pre-fills it) — e.g. `Closes #12` for GIN-12.
  Since the key is aligned to the issue number, the `GIN-<n>` and the `#<n>` share the same number.
  This is the single line that drives the board on merge.

## What's automatic vs manual

| Transition                         | How                                                                 |
| ---------------------------------- | ------------------------------------------------------------------- |
| → **Done**                         | **Automatic.** Merging a PR with `Closes #N` closes the issue → built-in *"item closed → Done"* workflow. |
| new `roadmap` issue → on the board | **Automatic.** Built-in *Auto-add* workflow (filter `is:issue label:roadmap`). |
| → **In Progress** / **In Review**  | **Manual.** Move the card yourself (no native trigger exists, and a user-owned Project can't be written by the default `GITHUB_TOKEN`). |

## Re-running setup

`scripts/seed-github-project.sh` is idempotent — it find-or-creates the project, fields, labels,
issues, and items, and re-applies field values. Run it after any roadmap change to sync new items:

```bash
gh auth refresh -s project      # one-time: grant the Projects scope
./scripts/seed-github-project.sh
```

Issues are matched by a hidden `<!-- change-id: … -->` marker in the body, so re-runs update rather
than duplicate. **Status** values are applied only once the Phase B built-in Status options exist
(see `context/project/github-board.md`); re-run the script after that to set them.

## Manual setup that gh CLI can't do (Phase B)

1. Project → Settings → Fields → **Status** → set options to Todo, In Progress, In Review, Done.
2. Settings → Workflows → **Auto-add to project** → filter `is:issue label:roadmap`, repo `apigon/gift-I-need`.
3. New view → layout **Roadmap** → date fields **Start** / **Target**.
