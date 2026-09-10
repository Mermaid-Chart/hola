---
description: Promote develop to main — merge, switch the alpha line to a beta, verify and raise the PR
argument-hint: '[--dry-run]'
---

Cut a beta from `develop` onto `main`: merge everything develop has, move the
versions from the alpha line to the beta line, verify, and open the pull request.

`--dry-run` — do the merge and the checks, but do not push and do not open a PR.

## What this is

`develop` and `main` are two publish lines over the same tree, and the only thing
that distinguishes them is the version suffix and the npm dist tag:

| branch    | suffix               | dist tag | workflow            |
| --------- | -------------------- | -------- | ------------------- |
| `develop` | `<base>-a.N` (alpha) | `dev`    | `publish-alpha.yml` |
| `main`    | `<base>-b.N` (beta)  | `latest` | `publish-beta.yml`  |

`latest` is what an untagged `npm install @mermaid-chart/mermaid` resolves to, so
this promotion is the thing that decides what consumers get by default. Treat it
with more care than a develop sync, not less.

Unlike the upstream sync, this merge is normally **conflict-free** — `main` is a
strict ancestor of `develop`, so nothing is being reconciled. The work is in the
versions and in checking that the tree being promoted is actually good.

## Steps

1. **Read `.github/fork-sync/GUIDE.md` section 8** ("Versioning and release
   lines"). It carries the rule, why `-a.N` sorts below `-b.N`, and why that
   forces the dist tags apart. Do not re-derive it.

2. **Check there is something to promote, and read what main carries alone:**

   ```bash
   git fetch origin develop && git fetch origin main
   git rev-list --left-right --count origin/main...origin/develop   # ours / theirs
   git log --oneline origin/develop..origin/main    # what main has and develop does not
   ```

   That last list is **not** expected to be empty, and this is the step most
   likely to be misread. Every promotion leaves a `chore(release): beta versions`
   commit on `main` that `develop` never receives — the two branches are supposed
   to disagree about the version suffix, permanently. So:
   - only version-bump commits → normal, carry on;
   - anything else → **stop and report it**. A hotfix landed straight on `main` is
     the usual cause, and it has to be merged back into `develop` first, or this
     promotion silently reverts it.

   Read the commits, not the count. `git diff origin/develop...origin/main --stat`
   restricted to non-`package.json` paths is the quick way to see whether the
   divergence is only versions.

3. **Create or update the promotion branch.** Never force-push; `autofix.ci` lands
   commits on it and they must survive.

   ```bash
   git switch -c chore/promote-to-main origin/main   # or switch to it if it exists
   git merge origin/main       # if the branch already existed
   git merge origin/develop
   ```

4. **Set the beta versions.** `version.mjs` owns this; never hand-edit a version.
   The beta line reads `current` from `origin/main` and the incoming base from
   `origin/develop`, so it is correct even though the merge has just put
   develop's alpha versions in the working tree:

   ```bash
   node .github/fork-sync/version.mjs --line beta --check    # read this first
   node .github/fork-sync/version.mjs --line beta --write
   pnpm install --lockfile-only
   ```

   **Read the `reason` column before writing.** `adopted develop <x>` is what a
   promotion that carries a base change should say; `bumped beta N -> N+1` is
   what a second promotion against an unchanged base should say. Anything
   mentioning the alpha line means the refs are wrong.

5. **Verify, and guard on the beta line.** `guard.sh` shells out to `version.mjs`
   without forwarding argv, so the line must be passed by environment or it will
   check the promotion against the alpha rule and fail:

   ```bash
   bash .github/fork-sync/verify.sh --tier full
   BASE_BEFORE=$(git rev-parse origin/main) FORK_SYNC_LINE=beta \
     bash .github/fork-sync/guard.sh
   ```

   If the prettier step fails printing only a bare count of files with no paths,
   that is the stale generated-docs trap — GUIDE.md section 7 has it.
   `rm -rf packages/mermaid/src/docs/config/setup` and re-run.

6. **Regenerate rather than trust the merge**, even though it was clean. A
   text-merged generated file matching neither side is the failure mode that has
   bitten every sync so far:

   ```bash
   pnpm --filter @mermaid-chart/mermaid docs:build
   git status --porcelain -- docs/     # must be empty
   ```

7. **Report** in the house format: what is being promoted, the version table
   (from → to, with the reason for each), what was verified, and anything
   unresolved. Say explicitly that e2e and Argos were not run locally.

Unless `--dry-run` was passed, push the branch and open the PR against `main`.

## After it merges

`publish-beta.yml` fires on the push to `main` and publishes every `-b.N`
package to GitHub Packages under `latest`. Confirm from the run's "Dist tags
after publishing" summary rather than assuming. If the merge was done through
GitHub **auto-merge** enabled with `GITHUB_TOKEN`, the push may raise no event at
all and the 06:10 UTC reconciler picks it up instead — that is expected, not a
failure.

## Do not

- Touch `main` or `develop` directly, or force-push anything.
- Hand-edit a version, `pnpm-lock.yaml`, anything under `docs/`, or any
  `generated/` directory. `version.mjs` and the regeneration recipes own these.
- Weaken, skip or delete a test to reach green. If a test cannot pass without
  changing product behaviour, that is a finding to report.
- Promote past a `main` that has diverged. Merge it back to `develop` first.
- Substitute the `<MERMAID_RELEASE_VERSION>` docs placeholder. The beta line
  leaves it standing on purpose — see the note in `publish-beta.yml`.
