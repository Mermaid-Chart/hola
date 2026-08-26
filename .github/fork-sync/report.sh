#!/usr/bin/env bash
#
# Renders the run report to stdout. Used verbatim as the pull request body and
# echoed into the job summary, so it has to read well to a human who has not
# looked at the log.
#
# Deliberately mirrors the structure of the fork's hand-written merge commit
# bodies (a24470c6f4, fa9709de0f, 9b95356233) — that convention is good and
# worth keeping machine-generated.
set -uo pipefail

SYNC_DIR="${SYNC_DIR:?}"
STATUS="${STATUS:-unknown}"
UPSTREAM_SHA="${UPSTREAM_SHA:-}"
UPSTREAM_BRANCH="${UPSTREAM_BRANCH:-develop}"
LAST_SYNCED_SHA="${LAST_SYNCED_SHA:-}"
COMMIT_COUNT="${COMMIT_COUNT:-0}"
CONFLICTED="${CONFLICTED:-false}"
AI_COST="${AI_COST:-0}"
AI_TURNS="${AI_TURNS:-0}"
AI_INVOKED="${AI_INVOKED:-false}"
# A conflicted merge no longer implies a handoff: autoresolve.sh may have settled
# every conflict mechanically, in which case this run is a normal green sync.
# HANDOFF is the truth about whether markers were committed for a human.
HANDOFF="${HANDOFF:-false}"
AUTORESOLVED="${AUTORESOLVED:-}"
WF_FILES="${WF_FILES:-}"

case "$STATUS" in
  green) headline='All checks passed. Auto-merge has been requested.' ;;
  needs-human)
    # Do not assert a verification failure that never happened: a conflict
    # handoff skips guardrails and full verification entirely, because both are
    # meaningless on a tree holding conflict markers.
    if [ "$HANDOFF" = 'true' ]; then
      headline='**Needs a human.** Conflicts with no mechanical recipe were handed over unresolved — nothing was verified.'
    else
      headline='**Needs a human.** Something did not verify cleanly — details below.'
    fi
    ;;
  blocked-workflow-files) headline='**Blocked.** This merge changes GitHub Actions workflow files, which the default `GITHUB_TOKEN` cannot push.' ;;
  no-op) headline='Nothing to merge.' ;;
  *) headline="Status: ${STATUS}" ;;
esac

echo "## Upstream sync — \`${STATUS}\`"
echo
echo "$headline"
echo
echo "| | |"
echo "|---|---|"
echo "| Upstream | \`os_repo/${UPSTREAM_BRANCH}\` @ \`${UPSTREAM_SHA:0:9}\` |"
if [ -n "$LAST_SYNCED_SHA" ]; then
  echo "| Previously synced | \`${LAST_SYNCED_SHA:0:9}\` |"
else
  echo '| Previously synced | never |'
fi
echo "| Incoming commits | ${COMMIT_COUNT} |"
echo "| Conflicts | ${CONFLICTED} |"
# Recorded on every sync, including the many that cost nothing — the point is to
# watch the trend and know when the strategy needs revisiting, which a number
# that only appears on expensive runs cannot tell you.
if [ "${AI_INVOKED:-false}" = 'true' ]; then
  printf '| AI cost | %s%.2f over %s turns |\n' '$' "${AI_COST:-0}" "${AI_TURNS:-0}"
else
  printf '| AI cost | %s0.00 — resolver not invoked |\n' '$'
fi
echo

if [ "$STATUS" = 'blocked-workflow-files' ] && [ -n "$WF_FILES" ]; then
  echo '### Why this is blocked'
  echo
  echo 'There is no `workflows` permission for `GITHUB_TOKEN`, so a push containing'
  echo 'changes to these files is rejected outright:'
  echo
  printf '%s\n' "$WF_FILES" | sed 's/^/- `/; s/$/`/'
  echo
  echo 'Finish this sync by hand — see `.github/fork-sync/GUIDE.md`, and pay particular'
  echo 'attention to re-applying the fork deltas in `e2e.yml`.'
  echo
  exit 0
fi

if [ -s "$SYNC_DIR/versions.txt" ]; then
  echo '### Versions'
  echo
  echo '```'
  cat "$SYNC_DIR/versions.txt"
  echo '```'
  echo
fi

if [ -s "$SYNC_DIR/conflicts.txt" ]; then
  echo "### Conflicted files ($(wc -l < "$SYNC_DIR/conflicts.txt" | tr -d ' '))"
  echo
  sed 's/^/- `/; s/$/`/' "$SYNC_DIR/conflicts.txt"
  echo
fi

# The resolver's own account, if it ran.
if [ -s "$SYNC_DIR/resolution.md" ]; then
  echo '### Resolution'
  echo
  cat "$SYNC_DIR/resolution.md"
  echo
fi

echo '### Verification'
echo
for tier in fast full; do
  f="$SYNC_DIR/verify.${tier}.json"
  [ -s "$f" ] || continue
  echo "\`--tier ${tier}\`:"
  echo
  jq -r '.steps[]
    | "- " + (if .status == "pass" then "PASS" else "FAIL" end)
      + " — " + .step + " (" + (.duration_s | tostring) + "s)"' "$f" \
    || echo '- (could not parse the verification summary)'
  echo
done
echo 'Not verified here: e2e, Playwright and Argos. Those run on this pull request.'
echo

if [ -s "${SYNC_DIR}/autoresolve.json" ]; then
  AR_COUNT="$(jq '.resolved | length' "${SYNC_DIR}/autoresolve.json")"
  if [ "$AR_COUNT" != 0 ]; then
    echo "### Auto-resolved (${AR_COUNT})"
    echo
    echo 'These conflicts have a mechanical recipe — GUIDE.md section 4 — so they were'
    echo 'resolved without a model and without a human. Each is listed with the recipe'
    echo 'used, and all of them still went through the gate and the guardrails below.'
    echo
    jq -r '.resolved[] | "- `\(.path)` — \(.recipe)"' "${SYNC_DIR}/autoresolve.json"
    echo
  fi
fi

if [ "$STATUS" = 'needs-human' ] && [ "$HANDOFF" = 'true' ]; then
  echo '### This branch contains unresolved conflicts, on purpose'
  echo
  echo 'The merge conflicted, so it was committed **as-is** and handed to you rather'
  echo 'than resolved automatically. CI on this pull request will be red until you'
  echo 'resolve it — that is expected. Nothing was verified and no model was invoked.'
  echo
  echo 'To finish it:'
  echo
  echo '```bash'
  echo "git fetch origin && git switch ${SYNC_BRANCH:-chore/sync-oss-develop}"
  echo 'git grep -lE "^(<{7}|={7}|>{7})( |$)"   # files with markers'
  echo '```'
  echo
  echo 'The commit message lists every conflicted path — trust that over a marker'
  echo 'scan, because delete/modify conflicts leave no markers at all.'
  echo
  if [ -s "$SYNC_DIR/deleted-modified.txt" ]; then
    echo '#### Delete/modify conflicts — these have no conflict markers'
    echo
    echo 'Each path below was deleted on one side and modified on the other, so'
    echo 'there is nothing to grep for. `git add -A` staged them as-is, which for'
    echo '`DU` means a file this fork had **deleted has been resurrected** and'
    echo 'appears in the diff as an ordinary addition. Decide per path: keep the'
    echo 'deletion (`git rm`), or port the change if the fork moved the file.'
    echo
    echo '```'
    cat "$SYNC_DIR/deleted-modified.txt"
    echo '```'
    echo
  fi
  echo 'Read `.github/fork-sync/GUIDE.md` section 3 for the rule per conflict'
  echo 'category, and section 5 for the fork-only invariants a clean-looking'
  echo 'resolution can still break. Then `bash .github/fork-sync/verify.sh --tier full`'
  echo 'before pushing. The `/sync-oss-develop` slash command drives this with the'
  echo 'same knowledge base the automation uses.'
  echo
elif [ "$STATUS" = 'needs-human' ]; then
  echo '### What to check'
  echo
  echo 'Auto-merge was **not** requested. Look at:'
  echo
  echo '- Any guardrail error in the run log (spec deletions, ignore/config changes,'
  echo '  and suppressions the resolution introduced are all reported there).'
  echo '- The `Verification` section above for the failing step.'
  echo '- Every change to a test file, separately from the source changes:'
  echo '  `git diff develop...HEAD -- "**/*.spec.*"`'
  echo
fi

echo '---'
echo
echo "<sub>Generated by [\`sync-oss-develop.yml\`](../blob/develop/.github/workflows/sync-oss-develop.yml). Knowledge base: [\`.github/fork-sync/GUIDE.md\`](../blob/develop/.github/fork-sync/GUIDE.md).</sub>"
echo "<!-- sync-oss-develop: status=${STATUS} upstream=${UPSTREAM_SHA} -->"
