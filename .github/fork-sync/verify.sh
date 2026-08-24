#!/usr/bin/env bash
#
# The single source of truth for verifying a merge result. Used by
# sync-oss-develop.yml and by anyone doing the merge by hand.
#
#   --tier fast   install + tsc + unit tests            (~4 min)
#   --tier full   ...plus eslint, prettier and build    (~10 min)
#
# The fast tier exists because it is cheap and it catches the failure class that
# actually bites on this fork: conflict-free auto-merges that break fork-only
# code. All three breakages in the 100-commit merge (a24470c6f4) were caught by
# tsc + vitest alone.
#
# e2e, Playwright and Argos are deliberately NOT run here. They are expensive and
# they run on the pull request instead.
#
# Two non-obvious rules are encoded below; see GUIDE.md section on verification.
set -uo pipefail

TIER=fast
OUT=""
while [ $# -gt 0 ]; do
  case "$1" in
    --tier) TIER="$2"; shift 2 ;;
    --out) OUT="$2"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$TIER" in
  fast|full) ;;
  *) echo "--tier must be 'fast' or 'full', got '$TIER'" >&2; exit 2 ;;
esac

cd "$(git rev-parse --show-toplevel)" || exit 2

RESULTS=()
FAILED=0

run() {
  local name="$1"; shift
  local started ended status
  printf '\n\033[1m=== %s ===\033[0m\n' "$name"
  started=$(date +%s)
  if "$@"; then status=pass; else status=fail; FAILED=1; fi
  ended=$(date +%s)
  printf '%s: %s (%ss)\n' "$name" "$status" "$((ended - started))"
  RESULTS+=("$(printf '{"step":"%s","status":"%s","duration_s":%s}' "$name" "$status" "$((ended - started))")")
}

# --- install -----------------------------------------------------------------
# --frozen-lockfile is the only proof that a regenerated lockfile is
# self-consistent with the merged package.json files.
run install pnpm install --frozen-lockfile
if [ "$FAILED" = 1 ]; then
  echo "::error title=verify::install failed; skipping the remaining steps" >&2
  [ -n "$OUT" ] && printf '{"tier":"%s","ok":false,"steps":[%s]}\n' "$TIER" "$(IFS=,; echo "${RESULTS[*]}")" > "$OUT"
  exit 1
fi

# --- typecheck ---------------------------------------------------------------
# Catches upstream code that references fork-only surfaces which do not exist,
# e.g. a new theme variable missing from the fork-only theme-mc.js.
run typecheck pnpm --filter @mermaid-chart/mermaid exec tsc --noEmit -p tsconfig.json

# --- unit tests --------------------------------------------------------------
# Trap: local .claude/worktrees/** copies break the vite json-schema plugin and
# inflate the run with phantom failures. A CI checkout has none, so a plain run
# is correct there; the exclusion only matters when running this locally.
run unit-tests npx vitest run --exclude '**/node_modules/**' --exclude '**/.claude/worktrees/**'

if [ "$TIER" = fast ]; then
  [ -n "$OUT" ] && printf '{"tier":"%s","ok":%s,"steps":[%s]}\n' \
    "$TIER" "$([ "$FAILED" = 0 ] && echo true || echo false)" "$(IFS=,; echo "${RESULTS[*]}")" > "$OUT"
  exit "$FAILED"
fi

# --- lint --------------------------------------------------------------------
# The explicit heap is required, not defensive. Type-aware eslint over this fork
# exceeds node's default limit (~2.2 GB on a 7 GiB runner) and dies with
# "FATAL ERROR: Ineffective mark-compacts near heap limit" — which reads exactly
# like a lint failure in the JSON gate output. Observed in run 32734010530.
run eslint env NODE_OPTIONS=--max-old-space-size=5120 \
  npx eslint --quiet --cache --cache-strategy content .

# Trap: do NOT run `prettier --check .` and do NOT use `pnpm lint` as the gate.
# `docs:code` writes generated files into packages/mermaid/src/docs/config/setup/,
# which is ignored only by the NESTED packages/mermaid/.gitignore. Prettier reads
# just the root .gitignore plus .prettierignore, so it reports ~54 failures for
# files that are not even tracked. Checking tracked files only sidesteps it.
prettier_tracked() {
  local out bad
  out="$(git ls-files -z | xargs -0 npx prettier --cache --check 2>&1 || true)"
  # Two error classes are benign and expected when files are passed explicitly
  # rather than globbed: binary/unknown types (images, .mmd fixtures) have no
  # parser, and CHANGELOG.md is a symlink that .prettierignore deliberately
  # excludes. Anything else — and every [warn] — is a real finding.
  bad="$(grep -E '^\[(warn|error)\]' <<<"$out" |
    grep -vE 'No parser could be inferred|is a symbolic link' || true)"
  if [ -n "$bad" ]; then
    printf '%s\n' "$bad" | head -40
    return 1
  fi
  return 0
}

run prettier prettier_tracked

run jison-lint pnpm run lint:jison
run build pnpm run build

if [ -n "$OUT" ]; then
  printf '{"tier":"%s","ok":%s,"steps":[%s]}\n' \
    "$TIER" "$([ "$FAILED" = 0 ] && echo true || echo false)" "$(IFS=,; echo "${RESULTS[*]}")" > "$OUT"
fi
exit "$FAILED"
