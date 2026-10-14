#!/usr/bin/env bash
#
# Alana-only. Uploads every captured e2e screenshot to Argos as a single build,
# compared with <reference-branch>'s baseline (develop).
#
# Every run that uploads has executed the full suite, so the build is never a
# subset. That matters: Argos only accepts a complete build as a baseline, and
# a merge to develop (an auto-approved branch) has to become the new one.
#
# Usage:
#   argos-upload.sh <screenshots-dir> <reference-branch>
#
# Environment:
#   ARGOS_PARALLEL_NONCE  required: unique per workflow run
#   GITHUB_STEP_SUMMARY   optional: the build URL is appended to it
set -euo pipefail

dir="$1" ref="$2"
: "${ARGOS_PARALLEL_NONCE:?ARGOS_PARALLEL_NONCE must be set}"

mapfile -t groups < <(
  cd "$dir" &&
    find . -type f \( -iname '*.png' -o -iname '*.jpg' -o -iname '*.jpeg' \) |
    sed 's#/[^/]*$##; s#^\./##; s#^\.$##' | sort -u
)

if [ "${#groups[@]}" -eq 0 ]; then
  echo "[argos] no screenshots — nothing uploaded."
  exit 0
fi

# Split into parallel uploads that Argos combines into one build, because a
# single finalize request overflows at this volume (HTTP 413). The total must
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
    --reference-branch "$ref" \
    --files "${globs[@]}" \
    --parallel --parallel-total "$K" --parallel-index "$i" \
    --parallel-nonce "$ARGOS_PARALLEL_NONCE" \
    2>&1 | tee -a "$log"
done

url=$(grep -oE 'https://[^ ]*argos-ci\.com[^ ]*' "$log" | tail -1 || true)
echo "[argos] compared with ${ref}: ${url:-no build URL in the upload output}"
if [ -n "${GITHUB_STEP_SUMMARY:-}" ]; then
  echo "## Argos: ${url:-build URL not found, see the upload step log}" >> "$GITHUB_STEP_SUMMARY"
fi
