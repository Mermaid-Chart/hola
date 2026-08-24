---
description: Read-only status of the upstream sync — divergence, state ref, open PR, versions
---

Report the current state of the upstream sync. Read-only: change nothing, push
nothing.

```bash
git fetch os_repo develop --quiet && git fetch origin develop --quiet

echo "— divergence —"
git rev-list --left-right --count origin/develop...os_repo/develop   # ours / theirs

echo "— is upstream already merged? —"
git merge-base --is-ancestor os_repo/develop origin/develop \
  && echo "yes: a sync now would be a no-op" || echo "no: there is work to sync"

echo "— what would come in —"
git log --oneline origin/develop..os_repo/develop | head -20

echo "— last synced (the state ref CI maintains) —"
git ls-remote origin refs/sync/oss-develop-last

echo "— rolling branch and its PR —"
git ls-remote origin refs/heads/chore/sync-oss-develop
gh pr list --head chore/sync-oss-develop --state all --limit 3 \
  --json number,state,isDraft,title

echo "— versions: current vs what the next sync would set —"
node .github/fork-sync/version.mjs --check

echo "— recent workflow runs —"
gh run list --workflow=sync-oss-develop.yml --limit 5
gh run list --workflow=publish-alpha.yml --limit 3
```

Summarise in a few lines: is a sync due, how much is pending, is there an open
sync PR and what state is it in, and would any version change. Flag anything that
looks stuck — a `sync: needs human` label, a blocked run, or an open tracking
issue titled "Upstream sync automation needs attention".
