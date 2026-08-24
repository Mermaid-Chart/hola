#!/usr/bin/env bash
#
# Creates or updates the single rolling sync pull request.
#
# Uses raw `gh` rather than peter-evans/create-pull-request, despite that action
# being the in-repo precedent (refresh-sheet-order.yml). Two disqualifiers:
# it resets the branch and force-pushes, which would delete the lint-fix commits
# autofix.ci lands on this branch; and it squashes everything to a single
# non-merge commit, which would destroy the merge parentage that the workflow's
# `git merge-base --is-ancestor` state machine depends on.
#
# Writes `number=<n>` to $GITHUB_OUTPUT.
set -euo pipefail

SYNC_BRANCH="${SYNC_BRANCH:?}"
BASE_BRANCH="${BASE_BRANCH:?}"
SYNC_DIR="${SYNC_DIR:?}"
STATUS="${STATUS:?}"
UPSTREAM_SHA="${UPSTREAM_SHA:?}"
NEEDS_HUMAN_LABEL="${NEEDS_HUMAN_LABEL:-sync: needs human}"

REPORT="$SYNC_DIR/report.md"
[ -s "$REPORT" ] || { echo "::error::missing report at $REPORT"; exit 1; }

TITLE="chore(sync): merge OSS develop @ ${UPSTREAM_SHA:0:9}"

EXISTING="$(gh pr list --head "$SYNC_BRANCH" --state open --limit 1 \
  --json number,isDraft,body --jq '.[0] // {}')"
NUMBER="$(jq -r '.number // ""' <<<"$EXISTING")"

if [ -z "$NUMBER" ]; then
  # Create as a draft unless everything is green, so a red sync cannot be
  # mistaken for something ready to review.
  args=(--base "$BASE_BRANCH" --head "$SYNC_BRANCH" --title "$TITLE" --body-file "$REPORT")
  [ "$STATUS" = 'green' ] || args+=(--draft)
  # Take the number from create's own output rather than re-listing. `gh pr list`
  # returns an empty string when it has nothing, so a momentarily stale list here
  # leaves NUMBER empty and the `gh pr edit "$NUMBER"` below fails on a PR that
  # was in fact created. The list stays as a fallback.
  CREATED="$(gh pr create "${args[@]}")"
  printf '%s\n' "$CREATED"
  NUMBER="$(sed -n 's#.*/pull/\([0-9][0-9]*\).*#\1#p' <<<"$CREATED" | tail -1)"
  if [ -z "$NUMBER" ]; then
    NUMBER="$(gh pr list --head "$SYNC_BRANCH" --state open --limit 1 --json number --jq '.[0].number // ""')"
  fi
  [ -n "$NUMBER" ] || { echo "::error::created a PR but could not determine its number"; exit 1; }
  WAS_DRAFT=true
  PREVIOUS_STATUS=''
  echo "created PR #${NUMBER}"
else
  WAS_DRAFT="$(jq -r '.isDraft' <<<"$EXISTING")"
  # The previous automated verdict is recorded in an HTML comment in the body.
  PREVIOUS_STATUS="$(jq -r '.body // ""' <<<"$EXISTING" |
    sed -n 's/.*sync-oss-develop: status=\([a-z-]*\).*/\1/p' | tail -1)"
  gh pr edit "$NUMBER" --title "$TITLE" --body-file "$REPORT"
  echo "updated PR #${NUMBER} (was draft=${WAS_DRAFT}, previous status=${PREVIOUS_STATUS:-none})"
fi

echo "number=${NUMBER}" >> "${GITHUB_OUTPUT:-/dev/null}"

# Draft state can only be changed through GraphQL; REST PATCH /pulls ignores
# `draft`. `gh pr ready` wraps the right mutations.
if [ "$STATUS" = 'green' ]; then
  [ "$WAS_DRAFT" = 'true' ] && gh pr ready "$NUMBER" || true
  # --remove-label errors if the label is not present, so check first.
  if gh pr view "$NUMBER" --json labels --jq '.labels[].name' | grep -qxF "$NEEDS_HUMAN_LABEL"; then
    gh pr edit "$NUMBER" --remove-label "$NEEDS_HUMAN_LABEL"
  fi
else
  gh pr edit "$NUMBER" --add-label "$NEEDS_HUMAN_LABEL"
  # Only demote a PR this run broke. If a human promoted an already-red PR to
  # ready — because they are reviewing it — do not yank it back to draft every
  # morning at 04:40.
  if [ "$WAS_DRAFT" != 'true' ] && [ "$PREVIOUS_STATUS" = 'green' ]; then
    gh pr ready --undo "$NUMBER"
  fi
fi
