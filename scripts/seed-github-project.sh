#!/usr/bin/env bash
#
# seed-github-project.sh — create & populate the "GIN Roadmap" GitHub Project
# from context/foundation/roadmap.md. Idempotent: safe to re-run.
#
# Prerequisite (one-time, manual): grant gh the Projects scope:
#     gh auth refresh -s project
#
# What it does (Phases A + C of context/project/github-board.md):
#   - find-or-create the user Project "GIN Roadmap" and link it to the repo
#   - create custom fields: Roadmap ID, Change ID, Kind, Stream, Start, Target
#   - create labels
#   - find-or-create one issue per roadmap item (matched by a hidden change-id marker)
#   - add each issue to the project and set its field values
#   - set Status (best-effort — needs the built-in Status options from Phase B)
#
# What it does NOT do (Phase B, web-UI only): edit built-in Status field options,
# enable the Auto-add workflow, or create the Roadmap-layout view.
#
set -euo pipefail

OWNER="apigon"
REPO="apigon/gift-I-need"
TITLE="GIN"   # display name; the pinned number file (below) is what actually targets the project
REF_BRANCH="main"   # branch the issue links point at (PRD + roadmap must be committed there to resolve)
ROADMAP_URL="https://github.com/${REPO}/blob/${REF_BRANCH}/context/foundation/roadmap.md"
PRD_URL="https://github.com/${REPO}/blob/${REF_BRANCH}/context/foundation/prd.md"

command -v gh  >/dev/null || { echo "gh not found"; exit 1; }
command -v jq  >/dev/null || { echo "jq not found"; exit 1; }

# --- Prereq gate: Projects scope -------------------------------------------------
if ! gh project list --owner "$OWNER" >/dev/null 2>&1; then
  echo "ERROR: gh is missing the 'project' scope (P1)."
  echo "Run:  gh auth refresh -s project"
  exit 1
fi

# --- A1/A2: resolve the project (rename-proof), then link to the repo ------------
# Resolution order: $PROJECT_NUMBER env → pinned number file → find by title → create.
# The number is pinned to a file so renaming the project in the UI never creates a dup.
NUMBER_FILE=".github/gin-project"
NUMBER="${PROJECT_NUMBER:-}"
if [[ -z "$NUMBER" && -f "$NUMBER_FILE" ]]; then NUMBER="$(cat "$NUMBER_FILE")"; fi
# validate a pinned number still exists; otherwise fall through
if [[ -n "$NUMBER" ]] && ! gh project view "$NUMBER" --owner "$OWNER" >/dev/null 2>&1; then NUMBER=""; fi
if [[ -z "$NUMBER" ]]; then
  NUMBER="$(gh project list --owner "$OWNER" --format json \
    | jq -r --arg t "$TITLE" '.projects[] | select(.title==$t) | .number' | head -n1)"
fi
if [[ -z "$NUMBER" ]]; then
  echo "Creating project '$TITLE'…"
  NUMBER="$(gh project create --owner "$OWNER" --title "$TITLE" --format json | jq -r '.number')"
fi
printf '%s\n' "$NUMBER" > "$NUMBER_FILE"
PROJECT_ID="$(gh project view "$NUMBER" --owner "$OWNER" --format json | jq -r '.id')"
echo "Project #$NUMBER ($PROJECT_ID)"
gh project link "$NUMBER" --owner "$OWNER" --repo "$REPO" >/dev/null 2>&1 || true

# --- A3: create custom fields (skip if already present) --------------------------
have_field() {
  gh project field-list "$NUMBER" --owner "$OWNER" --format json \
    | jq -e --arg n "$1" '.fields[] | select(.name==$n)' >/dev/null 2>&1
}
create_field() { # name  data-type  [single-select-options]
  have_field "$1" && return 0
  echo "Creating field: $1"
  if [[ "${2}" == "SINGLE_SELECT" ]]; then
    gh project field-create "$NUMBER" --owner "$OWNER" --name "$1" \
      --data-type SINGLE_SELECT --single-select-options "$3" >/dev/null
  else
    gh project field-create "$NUMBER" --owner "$OWNER" --name "$1" --data-type "$2" >/dev/null
  fi
}
create_field "Key"        TEXT
create_field "Roadmap ID" TEXT
create_field "Change ID"  TEXT
create_field "Kind"   SINGLE_SELECT "Foundation,Slice"
create_field "Stream" SINGLE_SELECT "A,B,C,D"
create_field "Start"  DATE
create_field "Target" DATE

# --- cache field + option ids ----------------------------------------------------
FIELDS_JSON="$(gh project field-list "$NUMBER" --owner "$OWNER" --format json)"
field_id() { jq -r --arg n "$1" '.fields[] | select(.name==$n) | .id' <<<"$FIELDS_JSON"; }
option_id() { # field-name  option-name
  jq -r --arg f "$1" --arg o "$2" \
    '.fields[] | select(.name==$f) | .options[]? | select(.name==$o) | .id' <<<"$FIELDS_JSON"
}
FID_KEY="$(field_id "Key")"
FID_ROADMAP="$(field_id "Roadmap ID")"
FID_CHANGE="$(field_id "Change ID")"
FID_KIND="$(field_id "Kind")"
FID_STREAM="$(field_id "Stream")"
FID_STATUS="$(field_id "Status")"   # built-in

# --- C1: labels (idempotent) -----------------------------------------------------
mklabel() { gh label create "$1" --repo "$REPO" --color "$2" --force >/dev/null 2>&1 || true; }
mklabel roadmap         0e8a16
mklabel foundation      5319e7
mklabel slice           1d76db
mklabel stream:a        c5def5
mklabel stream:b        c5def5
mklabel stream:c        c5def5
mklabel stream:d        c5def5
mklabel north-star      fbca04

# --- C2/C3/C4: one issue per roadmap item ---------------------------------------
# args: ID CHANGE_ID KIND STREAM STATUS TITLE PRD_REFS PREREQS UNLOCKS EXTRA_LABEL
seed_item() {
  local id="$1" cid="$2" kind="$3" stream="$4" status="$5" title="$6" \
        prd="$7" prereqs="$8" unlocks="$9" extra="${10}" outcome="${11}" risk="${12}"
  local marker="change-id: ${cid}"
  local slc klc
  slc="$(printf '%s' "$stream" | tr '[:upper:]' '[:lower:]')"
  klc="$(printf '%s' "$kind"   | tr '[:upper:]' '[:lower:]')"

  local body
  body="$(cat <<EOF
**${id} · \`${cid}\`**

**Outcome:** ${outcome}

- **PRD refs:** ${prd}
- **Prerequisites:** ${prereqs}
- **Unlocks:** ${unlocks}
- **Stream:** ${stream} · **Kind:** ${kind}

**Risk:** ${risk}

📋 Context: [roadmap](${ROADMAP_URL}) · [PRD](${PRD_URL})

<!-- ${marker} -->
EOF
)"

  # find-or-create by hidden marker
  local num
  num="$(gh issue list --repo "$REPO" --state all --search "\"${marker}\" in:body" \
          --json number --jq '.[0].number' 2>/dev/null || true)"
  local labels="roadmap,${klc},stream:${slc}"
  [[ -n "$extra" ]] && labels="${labels},${extra}"
  if [[ -z "$num" || "$num" == "null" ]]; then
    echo "Creating issue: ${title}"
    local url
    url="$(gh issue create --repo "$REPO" --title "$title" \
            --body "$body" --label "$labels")"
    num="${url##*/}"
  fi
  # Key is aligned to the GitHub issue number, so GIN-12 IS issue #12.
  local key="GIN-${num}"
  echo "  ${key} (${id}) → issue #${num}"
  gh issue edit "$num" --repo "$REPO" --title "${key}: ${title}" --body "$body" --add-label "$labels" >/dev/null 2>&1 || true
  # drop the old kind:* labels from a prior scheme (no-op if absent)
  gh issue edit "$num" --repo "$REPO" --remove-label "kind:foundation" --remove-label "kind:slice" >/dev/null 2>&1 || true

  # add to project (idempotent)
  local url="https://github.com/${REPO}/issues/${num}"
  local item_id
  item_id="$(gh project item-list "$NUMBER" --owner "$OWNER" --format json \
    | jq -r --argjson n "$num" '.items[] | select(.content.number==$n) | .id' | head -n1)"
  if [[ -z "$item_id" ]]; then
    item_id="$(gh project item-add "$NUMBER" --owner "$OWNER" --url "$url" --format json | jq -r '.id')"
  fi

  # set custom field values
  gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_ROADMAP" --text "$id"  >/dev/null
  gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_CHANGE"  --text "$cid" >/dev/null
  gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_KEY"     --text "$key" >/dev/null
  local kopt sopt
  kopt="$(option_id "Kind" "$kind")";     [[ -n "$kopt" ]] && gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_KIND"   --single-select-option-id "$kopt" >/dev/null
  sopt="$(option_id "Stream" "$stream")"; [[ -n "$sopt" ]] && gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_STREAM" --single-select-option-id "$sopt" >/dev/null

  # Status is best-effort: needs the Phase B options to exist first
  local stopt; stopt="$(option_id "Status" "$status")"
  if [[ -n "$stopt" ]]; then
    gh project item-edit --project-id "$PROJECT_ID" --id "$item_id" --field-id "$FID_STATUS" --single-select-option-id "$stopt" >/dev/null
  else
    echo "  (Status '$status' option not found — do Phase B, then re-run to set it)"
  fi
}

# The GIN-<n> key is derived from each issue's own number at runtime (GIN-12 == issue #12),
# so branch `feat/GIN-12-claim-gift-item` and PR `Closes #12` share the same number.
# Outcome ($O) and Risk ($R) are lifted from roadmap.md and passed as the last two args.
# args: ID CHANGE_ID KIND STREAM STATUS TITLE PRD_REFS PREREQS UNLOCKS EXTRA OUTCOME RISK

O="(foundation) email/password sign-up, sign-in, and sign-out are wired to the existing Supabase SSR scaffold; an authenticated session is available to Server Actions and Server Components."
R="Scaffold exists (clients, middleware), so this is the user-facing sign-up/sign-in surface + Server Actions, not a from-scratch auth build; the load-bearing check is that the cookie/session path holds under workerd (the health route already smoke-tests it). Kept minimal — no OAuth, no dashboard (both parked)."
seed_item "F-01" "email-password-auth"         "Foundation" "A" "Todo" "Wire email/password sign-up, sign-in, sign-out"                  "FR-001, FR-002"                "—"                "S-01, S-03, S-04, S-05" ""           "$O" "$R"

O="(foundation) the minimal schema for events, items, and claims exists, with row-level policies that enforce organizer-blindness (a query-level event-date gate) and a DB constraint making a single claim per item atomic; a test runner plus one test lock both guarantees."
R="The riskiest correctness surface in the product and the one place the speed goal does not relax the bar — the surprise rule and duplicate-prevention are must-hold guarantees. Kept to a minimal enabler contract (only the entities the first slices need + the two invariants + a focused test), NOT a full data-layer build."
seed_item "F-02" "surprise-rule-data-contract" "Foundation" "B" "Todo" "Schema + enforce organizer-blindness & single-claim, with tests" "NFR (both), FR-011"            "—"                "S-01, S-02, S-03, S-05" ""           "$O" "$R"

O="an authenticated organizer can create an event (name + date), add gift ideas (title; optional notes, link, price range), and get a shareable link."
R="First slice to exercise the F-02 schema end-to-end; the event date captured here is the input the entire surprise rule keys off, so the create form must make the date unambiguous. Item deletion is out of scope (edit-only per Non-Goals)."
seed_item "S-01" "create-and-share-event-list" "Slice"      "B" "Todo" "Organizer creates an event, adds items, shares a link"            "US-01, FR-003, FR-004, FR-006" "F-01, F-02"       "—"                      ""           "$O" "$R"

O="an unauthenticated visitor can open a shared link, view all items, and see each item's available or taken status."
R="Read-only and unauthenticated, so the surprise rule does not apply to guests here — but this view must show taken without leaking claimer identity (FR-009), and must not accidentally reuse an organizer-scoped query path. No claimer name to any guest."
seed_item "S-02" "browse-shared-list"          "Slice"      "B" "Todo" "Guest browses a shared list; available/taken status"              "US-01, FR-007, FR-009"         "S-01, F-02"       "—"                      ""           "$O" "$R"

O="a signed-in guest can claim one unclaimed item; the item immediately flips to taken for all other guests, and the organizer sees no claim status until the event date."
R="The north star and highest-stakes slice: duplicate-prevention must be reliable under concurrent claims (rests on the F-02 DB constraint, not UI checks), the claim must confirm within ~1s (NFR), and claiming is irreversible in v1 (unclaim is parked). If F-02's invariants are sound, this is mostly wiring the action + optimistic UI."
seed_item "S-03" "claim-gift-item"             "Slice"      "B" "Todo" "Guest claims an unclaimed item (north star)"                      "US-01, FR-008, FR-009"         "S-02, F-01, F-02" "—"                      "north-star" "$O" "$R"

O="an authenticated organizer can edit items on an event they created (e.g. rename, update notes/link/price)."
R="Off the north-star critical path, so sequenced after the core loop under the speed bias — but it is the strongest parallel-with candidate, so it is the natural slice to fan out to a separate agent run when capacity is the blocker. Edit-only; deletion is a Non-Goal."
seed_item "S-04" "edit-list-items"             "Slice"      "C" "Todo" "Organizer edits items on their list"                              "FR-005"                        "S-01, F-01"       "—"                      ""           "$O" "$R"

O="after the event date passes, the organizer can see the full claim status, and both the claiming guest and the organizer can independently mark an item as given."
R="Exercises the reveal side of the surprise rule: the gate must flip exactly on the event date and never before, under refresh/direct-URL access (NFR). Given can be set by either party, so the state model must tolerate both writers. This is the second half of the F-02 contract made user-visible."
seed_item "S-05" "post-event-reveal"           "Slice"      "D" "Todo" "Post-event reveal + mark-as-given"                                "US-02, FR-010, FR-011"         "S-03, F-01, F-02" "—"                      ""           "$O" "$R"

echo "Done. View: gh project view $NUMBER --owner $OWNER --web"
