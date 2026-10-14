#!/usr/bin/env bash
#
# Alana-only. Uploads one e2e tier's screenshots to Argos as its own build.
#
# Argos only ever compares a build with earlier builds of the same name and mode,
# and only a complete (non-subset) build can become a baseline. So each tier on
# each branch is a separate build: `develop-pr-check`, `develop-nightly-check`,
# `main-pr-check`, `main-nightly-check` and `main-visual-check`. Approving one
# tier's build moves that tier's baseline and leaves the others alone. A full run
# uploads all three main tiers, which replaces the whole main baseline. Every
# build here holds a whole tier, so none is a subset.
#
# A screenshot's tier is the first `pr-check` / `nightly-check` / `visual-check`
# segment in its path under the screenshots directory (diagrams/<type>/<tier>/...
# for .mmd fixtures, rendering/<type>/<tier>/<spec>/... for specs). Anything
# outside a tier counts as visual-check, which only a full run uploads.
#
# Usage:
#   argos-upload-tier.sh <screenshots-dir> <tier> <build-name> <mode> <reference-branch>
#
# Environment:
#   ARGOS_PARALLEL_NONCE  required: unique per workflow run, suffixed per build here
#   GITHUB_STEP_SUMMARY   optional: the build URL is appended to it
set -euo pipefail

dir="$1" tier="$2" name="$3" mode="$4" ref="$5"
: "${ARGOS_PARALLEL_NONCE:?ARGOS_PARALLEL_NONCE must be set}"

mapfile -t groups < <(
  cd "$dir" &&
    find . -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) |
    sed 's#/[^/]*$##; s#^\./##; s#^\.$##' | sort -u |
    awk -v want="$tier" '{
      t = "visual-check"
      n = split($0, seg, "/")
      for (i = 1; i <= n; i++) if (seg[i] ~ /^(pr|nightly|visual)-check$/) { t = seg[i]; break }
      if (t == want) print
    }'
)

if [ "${#groups[@]}" -eq 0 ]; then
  echo "[argos] ${name}: no ${tier} screenshots — nothing uploaded."
  exit 0
fi

# Split into parallel uploads that Argos combines into one build, because a
# single finalize request overflows on large tiers (HTTP 413). The total must
# equal the number of uploads actually made, or the build never finalises.
K=$(( ${#groups[@]} < 5 ? ${#groups[@]} : 5 ))
log=$(mktemp)
for i in $(seq 1 "$K"); do
  globs=()
  for j in "${!groups[@]}"; do
    if [ $(( j % K + 1 )) -eq "$i" ]; then
      prefix="${groups[$j]:+${groups[$j]}/}"
      globs+=( "${prefix}*.{png,jpg,jpeg}" )
    fi
  done
  # The CLI's spinner writes "Build created: <url>" to stderr.
  pnpm exec argos upload "$dir" \
    --build-name "$name" \
    --mode "$mode" \
    --reference-branch "$ref" \
    --files "${globs[@]}" \
    --parallel --parallel-total "$K" --parallel-index "$i" \
    --parallel-nonce "${ARGOS_PARALLEL_NONCE}-${name}" \
    2>&1 | tee -a "$log"
done

url=$(grep -oE 'https://[^ ]*argos-ci\.com[^ ]*' "$log" | tail -1 || true)
echo "[argos] ${name} (${mode}, baseline branch ${ref}): ${url:-no build URL in the upload output}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "- \`${name}\` (${mode}): ${url:-build URL not found, see the upload step log}" >> "$GITHUB_STEP_SUMMARY"
fi
