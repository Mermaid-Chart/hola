---
description: Merge upstream OSS mermaid develop into a local sync branch, verify it, and report
argument-hint: '[--dispatch] [--dry-run]'
---

Perform the upstream OSS sync locally, the same way `.github/workflows/sync-oss-develop.yml`
does in CI, but interactively so you can apply judgement and I can see it.

Arguments: `$ARGUMENTS`

- `--dispatch` — don't merge locally; trigger the real CI workflow instead
  (`gh workflow run sync-oss-develop.yml`) and report the run URL. Requires the
  workflow to be on `develop`.
- `--dry-run` — do the merge and the checks, but do not push and do not open a PR.

## Why this command exists

Roughly one sync in four touches `.github/workflows/**`, which the default
`GITHUB_TOKEN` cannot push, so CI stops and hands off to a human. This is the tool
for that handoff. It is also the way to sync when CI is unavailable or when you
want to watch the resolution happen.

## Steps

1. **Read `.github/fork-sync/GUIDE.md` first, in full.** It carries the conflict
   taxonomy, the fork-only invariants that upstream code silently breaks, the
   regeneration recipes, and the verification traps. Do not re-derive what it
   already records.

2. **Check whether there is anything to do:**

   ```bash
   git fetch os_repo develop && git fetch origin develop
   git rev-list --left-right --count origin/develop...os_repo/develop
   git merge-base --is-ancestor os_repo/develop origin/develop \
     && echo "nothing to sync" || echo "there is work"
   ```

   If upstream is already contained in `develop`, stop and say so.

3. **Create or update the rolling branch**, never force-pushing — `autofix.ci`
   lands commits on it and they must survive:

   ```bash
   git switch -c chore/sync-oss-develop origin/develop   # or switch to it if it exists
   git merge origin/develop      # if the branch already existed
   git merge os_repo/develop
   ```

4. **Resolve any conflicts** by the guide's rules. Classify each file before
   editing. Regenerate generated files rather than hand-merging them.

5. **Hunt the clean auto-merges.** This matters even when there were no conflicts
   — it is the failure class that actually bites here. Follow the guide's
   playbook: diff each fork-owned hot file against `ORIG_HEAD` looking for dropped
   imports, parameters and call arguments, and confirm each fork-only identifier
   still exists.

   If that hunt turns up a cross-package dependency you need to fix (a stale
   literal range, or restoring `workspace:^`), fixing it so the tree typechecks is
   not the whole job — a `workspace:` protocol value only resolves correctly if
   whatever eventually publishes the package understands it, and `npm publish`
   does not. `verify.sh`'s `publish-safety` step (below) catches a regression of
   the specific incident this happened to the fork once already; see GUIDE.md
   section 5's "cross-package deps" entry for the full story before touching
   either publish-\*.yml workflow or a `workspace:` dependency again.

6. **Version and verify**, reusing the same scripts CI uses so there is one
   source of truth:

   ```bash
   node .github/fork-sync/version.mjs --write --json
   pnpm install --lockfile-only
   bash .github/fork-sync/verify.sh --tier full
   BASE_BEFORE=<the pre-merge tip> UPSTREAM_SHA=$(git rev-parse os_repo/develop) \
     bash .github/fork-sync/guard.sh
   ```

   `verify.sh --tier full` (and `--tier fast`) now includes a `publish-safety`
   step that asserts `publish-alpha.yml`/`publish-beta.yml` invoke `pnpm publish`,
   not `npm publish` — do not skip or weaken it to reach green.

7. **Report** in the house format the guide describes: conflict resolutions with
   rationale, follow-on fixes the merge required, anything unresolved, and what
   was verified. Say explicitly that e2e and Argos were not run locally.

Unless `--dry-run` was passed, push the branch and open or update the PR against
`develop` when everything is green. Stop and ask rather than guessing if a
resolution needs a product decision.

## Do not

- Touch `develop` directly, or force-push anything.
- Weaken, skip or delete a test to reach green. If a test cannot pass without
  changing product behaviour, that is a finding to report.
- Hand-edit version numbers, `pnpm-lock.yaml`, anything under `docs/`, or any
  `generated/` directory. Regenerate instead.
- Edit `.gitignore`, `.prettierignore`, eslint/cspell/tsconfig/vite/playwright
  config, or any exclude list, to make a failure disappear.
- Assume a cross-package dependency fix is complete once `tsc`/`vitest` pass. A
  `workspace:` protocol value that typechecks locally can still publish broken —
  it did, twice (GUIDE.md section 5) — because that only resolves correctly
  through `pnpm publish`, never `npm publish`. Confirm `publish-safety` in
  `verify.sh` still passes; do not remove or narrow that check to get there.
