#!/usr/bin/env bash
#
# Mechanical checks on the merge result. Run by the workflow AFTER the resolver,
# and deliberately trusting nothing the resolver claims — these operate only on
# git facts.
#
# The failure mode being defended against is a resolver that reaches "all tests
# pass" by weakening the tests. Guiding principle: PREVENT where a legitimate
# resolution could never need the capability, DETECT where it could. Editing a
# spec is sometimes legitimate during a merge (upstream tests occasionally encode
# assumptions that are false in this fork), so spec edits are surfaced rather
# than blocked. Disabling a test never is.
#
# Every check is static or diff-based, so this costs no meaningful runner time.
# There is deliberately no runtime "did the test count drop" check: vitest exits
# non-zero on a spec file that collects no tests, so the fast gate already covers
# the silent-collection-failure case that would motivate one.
#
# Two modes, because two different things get merged here.
#
#   sync       (default) an upstream merge. A resolver has just made judgement
#              calls over conflicts, so checks 2-5 below ask what THE RESOLUTION
#              introduced.
#   promotion  develop -> main. There is no resolver and no resolution: the
#              merge is conflict-free by construction, and every commit in the
#              range already arrived on develop through its own reviewed pull
#              request and its own CI run. Checks 2-5 have no subject, and
#              running them anyway means months of legitimate change — a moved
#              spec, a `@ts-expect-error`, an eslint config edit — all report as
#              findings. A guard that always fails is one nobody reads, so
#              promotion mode runs only the checks that still mean something:
#              the merge is complete, the e2e.yml deltas survived, and the
#              versions are exactly what version.mjs computed. That last one is
#              the whole point of a promotion, and it is the check that would be
#              lost by simply skipping the guard.
#
# Environment:
#   BASE_BEFORE            required — the branch tip before this run's merges
#   UPSTREAM_SHA           optional — enables attributing added lines to upstream
#   FORK_SYNC_GUARD_MODE   optional — `sync` (default) or `promotion`
#   FORK_SYNC_LINE         optional — forwarded to version.mjs; `beta` on a promotion
set -uo pipefail

cd "$(git rev-parse --show-toplevel)" || exit 2
BASE="${BASE_BEFORE:?BASE_BEFORE must be set to the pre-merge branch tip}"
MODE="${FORK_SYNC_GUARD_MODE:-sync}"
case "$MODE" in
  sync | promotion) ;;
  *)
    echo "FORK_SYNC_GUARD_MODE must be 'sync' or 'promotion', got '$MODE'" >&2
    exit 2
    ;;
esac
FAILED=0
SPEC_GLOBS=('**/*.spec.ts' '**/*.spec.js' '**/*.spec.mjs' '**/*.test.ts' '**/*.test.js')

fail() { echo "::error title=fork-sync guard::$*"; FAILED=1; }
warn() { echo "::warning title=fork-sync guard::$*"; }
ok() { echo "  ok: $*"; }

echo "=== guard: ${BASE:0:9}..HEAD (mode: ${MODE}) ==="

# --- 1. The merge must be complete ------------------------------------------
if [ -n "$(git diff --name-only --diff-filter=U)" ]; then
  fail "unresolved conflicts remain"
else
  ok "no unresolved paths"
fi

if git grep -nIE '^(<{7}|={7}|>{7})( |$)' -- . ':(exclude)*.md' | head -5 | grep .; then
  fail "conflict markers present in tracked files"
else
  ok "no conflict markers"
fi

if [ "$MODE" = promotion ]; then
  echo "  skip: resolution checks (2-5) — a promotion has no resolution to check"
else
  # --- 2. Test files must not disappear ---------------------------------------
  # Both upstream and the fork only ever add tests, so a drop is never legitimate.
  before_files=$(git ls-tree -r --name-only "$BASE" | grep -cE '\.(spec|test)\.(ts|js|mjs|cjs)$' || true)
  after_files=$(git ls-files | grep -cE '\.(spec|test)\.(ts|js|mjs|cjs)$' || true)
  if [ "$after_files" -lt "$before_files" ]; then
    fail "test file count dropped: ${before_files} -> ${after_files}"
  else
    ok "test file count ${before_files} -> ${after_files}"
  fi

  deleted_specs=$(git diff --diff-filter=DR --name-only "$BASE..HEAD" -- "${SPEC_GLOBS[@]}" || true)
  if [ -n "$deleted_specs" ]; then
    fail "spec files deleted or renamed:"$'\n'"$deleted_specs"
  else
    ok "no spec deletions"
  fi

  # --- 3. No test may be disabled BY THE RESOLUTION ---------------------------
  # A bare pattern match is far too blunt. Upstream's own tests legitimately
  # contain `@ts-expect-error` (frequently the very thing being asserted: "this
  # type no longer accepts that field") and targeted `eslint-disable` comments.
  # Failing on those would fail every sync.
  #
  # So each suspicious added line is attributed: if upstream's copy of the same
  # file already contains it, upstream wrote it and it is not our concern. If it
  # does not, the resolution introduced it — which is what we are looking for.
  #
  # Note the regex stays in grep. Passing one through `awk -v` mangles the
  # backslashes and, worse, makes awk fail in a way that reads as "no matches".

  # Emits "path<TAB>added-line" for every added line in a test file. No dynamic
  # regex, so awk cannot misinterpret anything.
  added_test_lines() {
    git diff -U0 "$BASE..HEAD" -- "${SPEC_GLOBS[@]}" |
      awk '
        /^\+\+\+ /  { path = substr($0, 7); next }
        /^\+[^+]/   { print path "\t" substr($0, 2) }
      '
  }

  ADDED_CACHE="$(added_test_lines)"

  # Prints "path: line" for matches upstream does not already have.
  introduced_by_resolution() {
    local pattern="$1" path line needle
    [ -n "$ADDED_CACHE" ] || return 0
    while IFS=$'\t' read -r path line; do
      [ -n "${path:-}" ] || continue
      needle="$(printf '%s' "${line:-}" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//')"
      [ -n "$needle" ] || continue
      if [ -n "${UPSTREAM_SHA:-}" ] &&
        git show "${UPSTREAM_SHA}:${path}" 2>/dev/null | grep -qF -- "$needle"; then
        continue # upstream shipped this line verbatim
      fi
      printf '%s: %s\n' "$path" "$needle"
    done < <(grep -E -- "$pattern" <<<"$ADDED_CACHE" || true)
  }

  disabled=$(introduced_by_resolution '\.skip\b|\.todo\b|\bxit\(|\bxdescribe\(|\.only\(')
  if [ -n "$disabled" ]; then
    fail "the resolution skipped or narrowed a test:"$'\n'"$disabled"
  else
    ok "no skip/todo/only introduced by the resolution"
  fi

  suppressed=$(introduced_by_resolution '@ts-expect-error|@ts-ignore|eslint-disable')
  if [ -n "$suppressed" ]; then
    fail "the resolution added a type or lint suppression to a test file:"$'\n'"$suppressed"
  else
    ok "no suppressions introduced by the resolution"
  fi

  widened=$(introduced_by_resolution 'toBeDefined\(\)|toBeTruthy\(\)|expect\.any\(|expect\.anything\(')
  widened_count=$([ -z "$widened" ] && echo 0 || wc -l <<<"$widened" | tr -d ' ')
  if [ "$widened_count" != 0 ]; then
    warn "the resolution added ${widened_count} loose assertion(s); review the test diff"
  else
    ok "no loose assertions introduced by the resolution"
  fi

  # --- 4. Net assertions must not fall ----------------------------------------
  adds=$(git diff -U0 "$BASE..HEAD" -- "${SPEC_GLOBS[@]}" | grep -c '^+.*expect(' || true)
  dels=$(git diff -U0 "$BASE..HEAD" -- "${SPEC_GLOBS[@]}" | grep -c '^-.*expect(' || true)
  if [ "$adds" -lt "$dels" ]; then
    fail "net assertions removed (+${adds} / -${dels})"
  else
    ok "assertions +${adds} / -${dels}"
  fi

  # --- 5. The hiding places are off limits ------------------------------------
  # `.cspell/*.txt` is deliberately NOT guarded: upstream adds dictionary words on
  # roughly a third of its commits (32 in the last 90 days), so guarding it would
  # send every sync to a human. cspell.config.yaml IS guarded, because it controls
  # which files get checked at all. The rest see 0-6 upstream commits a quarter,
  # so the occasional review they force is cheap.
  #
  # .github/fork-sync/* is guarded because it holds the gate itself. In the first
  # rehearsal the resolver edited verify.sh to raise eslint's heap — a defensible
  # fix, disclosed in its report, and invisible to every other check here. A gate
  # the agent can edit is not a gate; legitimate fixes go through a human.
  forbidden=$(git diff --name-only "$BASE..HEAD" -- \
    .gitignore .prettierignore eslint.config.js cspell.config.yaml \
    '.github/fork-sync/*' \
    'tsconfig*.json' vite.config.ts vitest.workspace.ts playwright.config.ts || true)
  if [ -n "$forbidden" ]; then
    fail "ignore/config/gate file changed — these are where failures get hidden, so a human must look:"$'\n'"$forbidden"
  else
    ok "no ignore/config files touched"
  fi
fi

# --- 6. The fork's e2e.yml deltas must survive an upstream rewrite ---------
# Upstream edits this file constantly and carries none of the fork's changes.
check_e2e() {
  if grep -q -- "$1" .github/workflows/e2e.yml; then
    ok "e2e.yml keeps $2"
  else
    fail "e2e.yml lost $2"
  fi
}
check_e2e "github.repository == 'Mermaid-Chart/alana-mermaid'" 'its repository guard'
check_e2e 'runs-on: 2-core-advanced' 'the 2-core-advanced runner'
check_e2e 'workflow_call:' 'the workflow_call trigger (pr-labeled.yml calls it)'
check_e2e 'IS_ALANA_REPO' "Alana's tier policy (develop PRs: pr-check, main PRs: full)"
check_e2e 'argos-alana:' 'the per-tier Argos upload job'
check_e2e '      - main' 'the push trigger on main (refreshes the main-* Argos baselines)'

# Same idea for nightly-e2e.yml, which upstream gates to mermaid-js/mermaid only.
check_nightly() {
  if grep -q -- "$1" .github/workflows/nightly-e2e.yml; then
    ok "nightly-e2e.yml keeps $2"
  else
    fail "nightly-e2e.yml lost $2"
  fi
}
check_nightly "github.repository == 'Mermaid-Chart/alana-mermaid'" 'its Alana repository gate'
check_nightly "needs.changes.outputs.run == 'true'" 'the skip-when-develop-is-unchanged check'
check_nightly "'2-core-advanced'" 'the 2-core-advanced runner'
check_nightly 'argos-upload-tier.sh' 'the develop-nightly-check monitoring upload'

# --- 7. Versions must be exactly what version.mjs computed -----------------
# Version numbers are the versioning script's job; the resolver must never
# hand-edit one.
if ! node .github/fork-sync/version.mjs --json >"${TMPDIR:-/tmp}/guard-versions.json" 2>/dev/null; then
  warn "could not recompute versions; skipping the version check"
else
  while read -r dir expected; do
    actual=$(node -e "console.log(require('./${dir}/package.json').version)")
    if [ "$actual" != "$expected" ]; then
      fail "${dir}/package.json is ${actual}, but version.mjs computes ${expected}"
    else
      ok "${dir} at ${actual}"
    fi
  done < <(node -e "
    const d = require('${TMPDIR:-/tmp}/guard-versions.json');
    for (const p of d.packages) console.log(p.dir, p.next);
  ")
fi

echo
[ "$FAILED" = 0 ] && echo 'guard: PASS' || echo 'guard: FAIL'
exit "$FAILED"
