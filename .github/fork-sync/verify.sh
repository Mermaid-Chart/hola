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

# --- publish safety ------------------------------------------------------------
# pnpm substitutes a `workspace:` protocol dependency with the package's real
# resolved version at pack time; plain `npm publish` has no idea what the
# protocol means and ships the literal string, which no install outside this
# monorepo can resolve. That is exactly how @mermaid-chart/mermaid@12.1.0-a.0/
# -b.0 and @mermaid-chart/layout-elk@1.0.1-b.0 got published broken: both
# publish-alpha.yml and publish-beta.yml ran `npm publish`.
#
# A content-based check here — e.g. `pnpm pack` every publishable package and
# inspect the tarball's package.json — would NOT catch a regression of this:
# `pnpm pack` always substitutes `workspace:` correctly, by definition, no
# matter what the real CI publish step does. It would have passed on the
# broken tree just as happily as on the fixed one, because it never runs the
# command that actually shipped the bug. The only thing that distinguishes
# "fixed" from "broken" here is which command the workflow files invoke — so
# that is what this checks, directly.
check_publish_safety() {
  local f bad=0
  for f in .github/workflows/publish-alpha.yml .github/workflows/publish-beta.yml; do
    # Matches the actual invocation line (`... && pnpm publish --tag ...`), not
    # this very comment's own mentions of "npm publish" in prose.
    if grep -qE '\bnpm publish --tag\b' "$f"; then
      echo "${f} invokes \`npm publish\`, which ships a \`workspace:\` protocol dependency as a literal, unresolvable string — see this check's own comment for the incident." >&2
      bad=1
    elif ! grep -qE '\bpnpm publish --tag\b' "$f"; then
      echo "${f} invokes neither \`npm publish --tag\` nor \`pnpm publish --tag\` — has the publish step been renamed or restructured? Update this check to match." >&2
      bad=1
    fi
  done
  return "$bad"
}

run publish-safety check_publish_safety

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
  # Deliberately the SAME invocation as the repo's own `pnpm lint`, so this gate
  # cannot disagree with the check that gates the pull request. The previous form
  # — `git ls-files -z | xargs -0 npx prettier --check` — passed a tree that
  # `pnpm lint` failed on (an unformatted .github/fork-sync/*.mjs, run
  # 32955797225 vs lint run 32957466260). Whatever the mechanism, a gate that
  # disagrees with CI is worse than no gate: it grants confidence CI then
  # withdraws.
  out="$(npx prettier --cache --check . 2>&1 || true)"
  # The one tolerated class, and the reason a bare `prettier --check .` was
  # avoided before: `docs:code` writes generated files into
  # packages/mermaid/src/docs/config/setup/, ignored only by the NESTED
  # packages/mermaid/.gitignore, which prettier does not read. autoresolve.sh now
  # runs docs:build, so those files may well be present. Scoped to that one path
  # rather than filtering by message, so a real finding cannot hide behind it.
  bad="$(grep -E '^\[(warn|error)\]' <<<"$out" |
    grep -vE 'packages/mermaid/src/docs/config/setup/' |
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
