# Pulling from the upstream OSS repo

This is now automated. [`sync-oss-develop.yml`](.github/workflows/sync-oss-develop.yml)
runs daily, merges upstream `develop` into a rolling `chore/sync-oss-develop`
branch, and keeps one pull request open against `develop`.

**If you are doing a merge by hand**, read
[`.github/fork-sync/GUIDE.md`](.github/fork-sync/GUIDE.md) first. It records the
recurring conflict categories, the fork-only invariants that upstream code
routinely breaks without any conflict being reported, and the verification traps.

The remote is `os_repo`, and we track its `develop`:

```bash
git remote add os_repo git@github.com:mermaid-js/mermaid.git   # once
git fetch os_repo develop
git switch -c chore/pull-in-<something> develop
git merge os_repo/develop
bash .github/fork-sync/verify.sh --tier full
```
