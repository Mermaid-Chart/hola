#!/usr/bin/env bash
#
# Resolve the conflict categories that have a mechanical recipe, so that handing
# a merge to a human is reserved for conflicts that carry an actual decision.
#
# Rationale: PR #141 was a full human handoff spent on two package.json version
# strings. package.json conflicts on essentially every upstream release (their
# changeset bumps `version`, so does the fork's alpha line) and generated files
# conflict on any docs or schema change — neither needs judgement, and GUIDE.md
# section 4 already records the recipe for each.
#
# The safety boundary: only ever touch files that are GENERATED or MECHANICALLY
# DERIVED. Never hand-written source — nothing under packages/*/src (except the
# generated config.type.ts), e2e/, or .github/. A wrong auto-resolution in
# generated output is corrected by regenerating; a wrong one in source is the
# silent breakage this whole pipeline exists to prevent.
#
# Everything resolved here still faces the full gate and guard.sh afterwards.
#
# Writes $SYNC_DIR/autoresolve.json and, if GITHUB_OUTPUT is set, `remaining=<n>`.
set -euo pipefail

SYNC_DIR="${SYNC_DIR:?}"
cd "$(git rev-parse --show-toplevel)"

emit() { # json_array_of_resolved json_array_of_deferred
  printf '{"resolved":%s,"deferred":%s}\n' "$1" "$2" > "$SYNC_DIR/autoresolve.json"
}

UNMERGED="$(git diff --name-only --diff-filter=U | sort || true)"
if [ -z "$UNMERGED" ]; then
  emit '[]' '[]'
  [ -n "${GITHUB_OUTPUT:-}" ] && echo 'remaining=0' >> "$GITHUB_OUTPUT"
  echo 'No unmerged paths.'
  exit 0
fi

RESOLVED='[]'
DEFERRED='[]'
add() { # array_var path recipe
  local cur="${!1}"
  printf -v "$1" '%s' "$(jq -c --arg p "$2" --arg r "$3" '. + [{path:$p, recipe:$r}]' <<<"$cur")"
}

want_docs=0
want_types=0
want_lock=0

# --- pass 1: recipes that need no install ------------------------------------
while IFS= read -r p; do
  [ -n "$p" ] || continue
  case "$p" in
    packages/*/package.json)
      # Only the `version` field may genuinely conflict; anything else is a
      # decision and goes to a human. The helper enforces that and exits 1.
      if out="$(node .github/fork-sync/merge-package-json.mjs "$p")"; then
        git add "$p"
        add RESOLVED "$p" 'three-way merged; version left to version.mjs'
        echo "resolved  $p"
      else
        reason="$(jq -r '.reason // "unmergeable"' <<<"$out" 2>/dev/null || echo unmergeable)"
        add DEFERRED "$p" "$reason"
        echo "deferred  $p — $reason"
      fi
      ;;
    pnpm-lock.yaml)          want_lock=1 ;;
    docs/*)                  want_docs=1 ;;
    packages/mermaid/src/config.type.ts) want_types=1 ;;
    *)
      add DEFERRED "$p" 'no mechanical recipe — needs judgement'
      echo "deferred  $p"
      ;;
  esac
done <<<"$UNMERGED"

# --- pass 2: regeneration ----------------------------------------------------
# Regenerating docs or types needs a real `pnpm install`, whose root `prepare`
# runs a full build — and a build cannot succeed while conflict markers remain in
# source. So if anything is still deferred, defer the generated files too rather
# than fail on an unrelated tree. The human resolving the source conflicts
# regenerates as GUIDE.md section 4 describes.
STILL_DEFERRED="$(jq 'length' <<<"$DEFERRED")"

if [ "$want_lock" = 1 ]; then
  # --ignore-scripts: no build needed to rewrite a lockfile, and the tree may
  # not be buildable yet.
  if pnpm install --lockfile-only --ignore-scripts >/dev/null 2>&1; then
    git add pnpm-lock.yaml
    add RESOLVED 'pnpm-lock.yaml' 'regenerated with pnpm install --lockfile-only'
    echo 'resolved  pnpm-lock.yaml'
  else
    add DEFERRED 'pnpm-lock.yaml' 'lockfile regeneration failed'
    echo 'deferred  pnpm-lock.yaml — regeneration failed'
  fi
fi

if [ "$want_docs" = 1 ] || [ "$want_types" = 1 ]; then
  if [ "$STILL_DEFERRED" != 0 ]; then
    while IFS= read -r p; do
      [ -n "$p" ] || continue
      add DEFERRED "$p" 'generated, but the tree has source conflicts so it cannot be rebuilt'
      echo "deferred  $p — tree not buildable yet"
    done < <(printf '%s\n' "$UNMERGED" | grep -E '^docs/|^packages/mermaid/src/config\.type\.ts$' || true)
  else
    echo 'Installing to regenerate generated files...'
    pnpm install --frozen-lockfile=false >/dev/null
    if [ "$want_types" = 1 ]; then
      pnpm --filter @mermaid-chart/mermaid types:build-config >/dev/null
      git add packages/mermaid/src/config.type.ts
      add RESOLVED 'packages/mermaid/src/config.type.ts' 'regenerated with types:build-config'
      echo 'resolved  packages/mermaid/src/config.type.ts'
    fi
    if [ "$want_docs" = 1 ]; then
      # docs:build starts with `rimraf ../../docs`, so nothing hand-merged there
      # survives anyway — and regenerating restores the fork's
      # @mermaid-chart/mermaid naming, which taking upstream's copy would not.
      pnpm --filter @mermaid-chart/mermaid docs:build >/dev/null
      git add docs
      while IFS= read -r p; do
        [ -n "$p" ] || continue
        add RESOLVED "$p" 'regenerated with docs:build'
        echo "resolved  $p"
      done < <(printf '%s\n' "$UNMERGED" | grep -E '^docs/' || true)
    fi
  fi
fi

emit "$RESOLVED" "$DEFERRED"

# Rewrite conflicts.txt to what is actually LEFT. Both the pull request report
# and the resolver's prompt read it, and a stale list would send a human or the
# model hunting for markers that are no longer there. autoresolve.json keeps the
# record of what was settled and how.
git diff --name-only --diff-filter=U > "$SYNC_DIR/conflicts.txt"

REMAINING="$(grep -c . "$SYNC_DIR/conflicts.txt" || true)"
[ -n "${GITHUB_OUTPUT:-}" ] && echo "remaining=${REMAINING}" >> "$GITHUB_OUTPUT"
printf '\nauto-resolved %s, deferred %s, unmerged paths remaining %s\n' \
  "$(jq 'length' <<<"$RESOLVED")" "$(jq 'length' <<<"$DEFERRED")" "$REMAINING"
