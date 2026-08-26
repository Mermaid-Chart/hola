# Syncing upstream OSS mermaid into this fork

> Last verified against `os_repo/develop` on 2026-08-24. Fork tip ~948 commits
> ahead of upstream. Unit suite: ~6100 tests in ~267 files on `develop`.

Two audiences read this: the CI resolver in
[`sync-oss-develop.yml`](../workflows/sync-oss-develop.yml), which is pointed at it
on every run, and whoever is doing a merge by hand. It is the accumulated result of
every previous merge — please don't re-derive what it already records.

**Keeping it true.** Any merge that turns up a new recurring delta should add it
here, in the same pull request, as its own commit. The resolver is told to propose
wording rather than edit this file itself. Section 11 marks which sections are
expected to change.

---

## 1. Fork topology

|           |                                                                   |
| --------- | ----------------------------------------------------------------- |
| `origin`  | `Mermaid-Chart/alana-mermaid` — private, default branch `develop` |
| `os_repo` | `mermaid-js/mermaid` — upstream, we track its `develop`           |

Upstream moves 5–10 commits a day. A weekday sync pulls 5–50; a two-week gap pulls
around 100 (the scale of `a24470c6f4`: 100 commits, 15 conflicted files).

Package renames — the single most productive fact in this document:

| Fork                                     | Upstream                       |
| ---------------------------------------- | ------------------------------ |
| `@mermaid-chart/mermaid`                 | `mermaid`                      |
| `@mermaid-chart/layout-elk`              | `@mermaid-js/layout-elk`       |
| `@mermaid-chart/layout-tidy-tree`        | `@mermaid-js/layout-tidy-tree` |
| `@mermaid-js/tiny`, `@mermaid-js/parser` | same name upstream             |

**Corollary with teeth:** any upstream-authored `pnpm --filter mermaid …` matches
**zero** packages in this fork. That is the root cause of essentially every
conflict under `docs/config/setup/**`, and the pattern is still live in
`lint.yml` and the `run` script.

## 2. Orientation in 60 seconds

```bash
git fetch os_repo develop
git merge-base --is-ancestor os_repo/develop HEAD && echo "nothing new"
git rev-list --left-right --count HEAD...os_repo/develop   # ours / theirs
git log --oneline HEAD..os_repo/develop                    # what is coming
git diff --name-only --diff-filter=U                       # after merging: conflicts
```

Before resolving anything, check whether upstream went anywhere near fork-owned
territory:

```bash
git log --oneline HEAD..os_repo/develop -- \
  packages/mermaid/src/themes/ packages/mermaid/src/Diagram.ts \
  packages/mermaid/src/mermaidAPI.ts packages/mermaid/src/preprocess.ts \
  packages/mermaid/src/schemas/config.schema.yaml .github/workflows/e2e.yml
```

During a merge, `--ours` is **the fork** and `--theirs` is **upstream**.

## 3. Conflict taxonomy

| Category         | How to recognise it                             | Rule                                                    |
| ---------------- | ----------------------------------------------- | ------------------------------------------------------- |
| Generated        | Path is in section 4                            | Regenerate. Never hand-merge                            |
| Lockfile         | `pnpm-lock.yaml`                                | Regenerate, then prove with `--frozen-lockfile`         |
| Dependency union | Both sides added deps to a `package.json`       | Take **both**, unless genuinely exclusive               |
| Import specifier | `@mermaid-chart/*` vs `mermaid`/`@mermaid-js/*` | Upstream's import **list**, fork's **specifier**        |
| Workflow         | `.github/workflows/**`                          | Upstream's body, re-apply every fork delta in section 5 |
| Trivial          | Comment or whitespace drift                     | Take upstream and move on                               |
| Semantic         | Real logic on both sides                        | Read both fully. See below                              |
| Test expectation | Upstream test asserts something false here      | Section 5, then retarget — never weaken                 |
| Delete/modify    | `git status` shows `DU` or `UD`                 | Almost always keep the fork's deletion. **No markers**  |

**Delete/modify (`DU`/`UD`) deserves its own warning: it is the only conflict
category with no conflict marker anywhere.** The fork has deleted whole trees
upstream still carries — `cypress/` being the obvious one, removed by the Playwright
migration — so any upstream branch that predates a deletion, or that touches a file
the fork dropped, conflicts as `DU` (deleted by us, modified by them). Because
nothing is rewritten in place, `git grep` for `<<<<<<<` finds **nothing**, and a
blanket `git add -A` silently resolves it by **resurrecting the deleted file**.

Run 32751735165 is the worked example: `os_repo/4743-timeline-html-formatting`
modified `cypress/integration/rendering/timeline/timeline.spec.ts`, which this fork
had deleted. A `git add -A && git commit` in a later step completed the merge, the
Cypress spec reappeared in the tree, no marker existed to notice it, and the only
symptom was eslint failing 80 seconds later.

So: after any conflicted merge, run `git status --porcelain | grep -E '^(DU|UD)'`
explicitly. Do not rely on a marker scan. The rule is almost always "keep the
deletion" — `git rm` the path — but check first that the fork has not simply moved
the file, in which case upstream's change may need porting to the new location.

For **semantic** conflicts where both sides independently invented the same
abstraction — which happens more often than you would expect, because the same
people work on both repos — adopt upstream's typed version and re-attach the fork's
extra capabilities on top. `a24470c6f4` is the model: upstream and the fork had
built structurally identical `DiagramCode` interfaces, so the resolution took
upstream's typed `preserveCommentsWhenParsing` opt-in and its `maxTextSize` guard
while keeping the fork's `processRawText` branch.

## 4. Regenerate, never hand-merge

| Artifact                              | Regenerate with                                                      |
| ------------------------------------- | -------------------------------------------------------------------- |
| `docs/**` (159 tracked files)         | `pnpm --filter @mermaid-chart/mermaid docs:build`                    |
| `pnpm-lock.yaml`                      | `pnpm install --lockfile-only`, then verify with `--frozen-lockfile` |
| `packages/mermaid/src/config.type.ts` | `pnpm --filter @mermaid-chart/mermaid types:build-config`            |
| ANTLR parsers                         | `pnpm antlr:generate` (also runs on `postinstall`)                   |
| Langium `generated/`                  | langium-cli                                                          |

`docs:build` begins with `rimraf ../../docs`, so nothing hand-written survives
there. Conflicts in `docs/config/setup/**` are almost always just the package
rename plus line-number drift — regenerating resolves them and restores the fork's
`@mermaid-chart/mermaid` naming in one step.

### Auto-resolution (what the pipeline settles for you)

`.github/fork-sync/autoresolve.sh` applies the recipes above automatically during
a sync, so a handoff is reserved for conflicts that carry a decision:

| Conflict                              | Handled how                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/*/package.json`             | Three-way merged field by field. Only `version` may genuinely conflict; anything else defers to a human. `version.mjs` then sets the alpha. |
| `pnpm-lock.yaml`                      | `pnpm install --lockfile-only --ignore-scripts`                                                                                             |
| `docs/**`                             | `docs:build`                                                                                                                                |
| `packages/mermaid/src/config.type.ts` | `types:build-config`                                                                                                                        |

Two boundaries worth knowing when you are doing this by hand:

- **Generated and derived files only.** Nothing under `packages/*/src` (bar the
  generated `config.type.ts`), `e2e/`, or `.github/`. A wrong resolution in
  generated output is fixed by regenerating; a wrong one in source is the silent
  breakage this whole process exists to catch.
- **Regeneration needs a buildable tree.** `pnpm install` runs the root `prepare`,
  which builds, and a build cannot succeed while markers remain in source. So when
  source conflicts are still open, the generated files are deferred too — resolve
  the source first, then regenerate.

For `package.json` specifically, do not reach for "is ours the same as theirs apart
from the version". The fork permanently renames the package, retargets
`repository` and adds fork-only scripts, so the two sides always differ in many
fields. The question that matters is which fields **both** sides changed,
differently, relative to the merge base.

## 5. Fork-only invariants that upstream code breaks

The highest-value section. Each entry is "if upstream does X, this fork needs Y",
with the commit that taught it.

**New upstream e2e specs are Cypress-shaped.** Section 6 covers upstream text
merging _into_ an existing fork spec (`oldShapes.spec.ts`). A **new** upstream spec
is worse, because it lands with no conflict at all and neither tier of `verify.sh`
opens `e2e/`. Upstream branches that predate or sit beside the Playwright migration
add specs with bare `describe`/`it`, `import { imgSnapshotTest } from '../../helpers/util'`,
and an un-awaited `imgSnapshotTest(code, opts)`. In this fork the helper is
`e2e/helpers/util.ts` and its signature is `imgSnapshotTest(page, testInfo, code, opts)`,
so such a file resolves nothing and collects **zero tests** — passing silently.
After any merge, run
`git diff --name-only ORIG_HEAD..HEAD -- e2e/rendering` and check each added spec
imports `'../helpers/util.ts'` and takes `({ page }, testInfo)`. Port it, keeping
every case verbatim. Seen in `4c40dd406` (`sequenceDiagram-icon.spec.ts`,
`sequenceDiagram-image.spec.ts`).

**Fork-only DOM contracts on new render paths.** Every actor renderer in
`sequence/svgDraw.js` tags its group with `data-et`/`data-type`/`data-id` and its
life-line with `data-et="life-line"`; that is what the fork's code↔SVG sync
consumes (`SequenceASTBuilder` emits `[data-et="participant"][data-id="<id>"]` for
every `participant` statement). Upstream adding a new participant renderer sets
none of them, so the shape renders correctly and is then **invisible to editor
selection and highlight** — nothing fails. Whenever upstream adds a draw function
alongside fork-instrumented siblings, check the instrumentation carries over.

**Themes.** `packages/mermaid/src/themes/theme-mc.js` is fork-only and registered
in `themes/index.js`. Upstream periodically ships a spec asserting that _every
registered theme_ defines a new variable, and `theme-mc` is invisible to them. Two
hits so far: `xyChart.legendTextColor` (`9b95356233`) and `flowContainerStroke`
(`a24470c6f4`). **Whenever an upstream diff adds a theme variable, add it to
`theme-mc.js` before running the tests.**

**Config.** The fork adds a `parser` key to `BaseDiagramConfig` in
`config.schema.yaml` (`jison` | `antlr` | `langium`, default `jison`). Every
diagram config inherits it through `allOf`, so any upstream spec asserting _exact_
runtime config defaults needs `parser: 'jison'` added to its expectation — see
`config.usecase.spec.ts` in `a24470c6f4`.

**Comment-preserving parsing.** `FlowDB` and `agentflowDb` declare
`preserveCommentsWhenParsing = true` so Jison `@$` positions land in
original-source space for editor sync. Upstream's flowchart does **not**, so any
upstream test asserting "a flowchart never parses comments" is false here. Retarget
it to a diagram type that genuinely never does (a pie chart works) and keep the
assertion exactly as strong — `agentflow-max-text-size.spec.ts` in `a24470c6f4`.

**Core API extensions.** Preserve all of these:

- `Diagram.ts` — the `parser.features?.processRawText` branch, which takes
  precedence over the comment-preserving path.
- `preprocess.ts` — the `antlrDiagram` export.
- `mermaidAPI.ts` — the richer `parse()` return (`{ diagram, code, config, title,
success }` rather than upstream's `{ diagramType, config }`), the `positions`
  parameter on `render`, and the `parseOnly` security-level guard.
- `flowRenderer-v3-unified.ts` — the `Positions` import, the `positions`
  parameter, and the `render(data4Layout, svg, positions)` argument.

That last one is the canonical silent-drop: `9b95356233` records a clean auto-merge
that removed all three, which would have made fixed-layout flowcharts quietly
ignore caller-supplied positions. Re-check it on any merge touching the unified
renderer.

**`.github/workflows/e2e.yml`** must keep three fork deltas that upstream does not
carry. `guard.sh` asserts all three, but if you are merging by hand:

- both `github.repository == 'Mermaid-Chart/alana-mermaid'` guards;
- `runs-on: 2-core-advanced` — the private 8 GiB runner. Private repos otherwise
  get ~7 GiB with a ~2 GB default V8 heap; `ae005555b0` is a multi-hour e2e stall
  caused entirely by that. Symptoms: `FATAL ERROR: Reached heap limit`, shard exit
  134;
- the `workflow_call` trigger. Upstream dropped it but kept the caller, so
  `pr-labeled.yml`'s "CI: full argos" label depends on the fork restoring it.

**e2e assets.** `e2e/diagrams/**` holds ~1224 `.mmd` fixtures, swept automatically
by `e2e/rendering/mmd-snapshots.spec.ts` — new fixtures need no spec edit. But
`assertUniqueSnapshotNames` throws at collection time if two fixture paths collapse
to the same slug, which fails the whole shard. `e2e/sheet-order.json` is
script-owned and `.prettierignore`d; adding fixtures does **not** require
regenerating it.

## 6. The clean-auto-merge playbook

Both `fa9709de0f` and `9b95356233` independently identified conflict-free
auto-merges as the highest-risk category, and `a24470c6f4` confirmed it: its three
follow-on fixes all came from merges git reported as clean. Conflicts are the easy
half — they announce themselves.

After merging, and **even when there were no conflicts at all**:

```bash
# 1. Did upstream quietly replace fork-only code in a hot file?
git diff ORIG_HEAD...HEAD -- packages/mermaid/src/mermaidAPI.ts
#    Look for dropped imports, dropped parameters, dropped call arguments.

# 2. Do the fork-only identifiers still exist and are they still reachable?
git grep -n 'processRawText\|antlrDiagram\|preserveCommentsWhenParsing\|parseOnly'

# 3. Any upstream test asserting an exhaustive property is suspect until checked.
```

The pathological case, from `fa9709de0f`: `oldShapes.spec.ts` auto-merged with no
conflict, text-merging four Cypress `it(` blocks into a Playwright file. Collection
died entirely — 0 tests in 0 files — which a "did the tests pass?" glance sails
straight past. Vitest now exits non-zero on a spec that collects no tests, so the
fast gate catches this specific shape, but the class of failure is wider than the
one vitest can see.

## 7. Verification and its traps

Run `bash .github/fork-sync/verify.sh --tier full`. That script is the single
source of truth; what follows is _why_.

Two traps, both of which cost real time to rediscover:

**Prettier must run on tracked files only.** Use
`git ls-files -z | xargs -0 npx prettier --check`, which is what `verify.sh` does.
`docs:code` writes generated files into `packages/mermaid/src/docs/config/setup/`,
ignored only by the **nested** `packages/mermaid/.gitignore`. Prettier reads just
the root `.gitignore` plus `.prettierignore`, so `prettier --check .` reports ~54
failures for files that are not even tracked. **`pnpm lint` has this bug**, so do
not use it as the gate after a docs build.

**Vitest and scratch worktrees.** Local `.claude/worktrees/**` copies break the
vite json-schema plugin and inflate the run; `fa9709de0f` chased 173 phantom
failures to exactly this. A fresh CI checkout has none, so plain `npx vitest run`
is right there; locally, exclude them.

**`pnpm install` builds.** The root `prepare` is `husky && pnpm build`, so every
`pnpm install` runs a full build. Two consequences: `git commit --no-verify` is
mandatory during a merge, and the "fast" gate is never run on a tree that still
holds conflict markers — esbuild chokes on `<<<<<<<` and `install` fails for a
reason that says nothing about the merge.

**eslint needs an explicit heap.** Type-aware eslint over this fork exceeds node's
default limit (~2.2 GB on a 7 GiB runner) and aborts with
`FATAL ERROR: Ineffective mark-compacts near heap limit`. That is the `ae005555b0`
runner-memory shape, not a lint regression, and it reads exactly like a real
failure in the gate's JSON. `verify.sh` therefore runs eslint under
`NODE_OPTIONS=--max-old-space-size=5120`. If the step ever "fails" with no findings
printed, look for the OOM banner before hunting a rule violation. Also note
`--quiet` omits zero-message files from `--format json` output entirely, so an
empty `[]` means "no errors", not "nothing linted".

Expected shape of a healthy run: unit tests ~25 s, `tsc` 1–2 min, `build` 3–5 min.
A test count that _drops_ is a red flag, never a win — both upstream and the fork
only ever add tests.

**Not run here:** e2e, Playwright, Argos and Applitools. Too expensive; they run on
the pull request. Expect an Argos review for any new `.mmd` fixtures, and note that
sheet batching means adding fixtures re-tiles the affected group's last sheet, so a
handful of sheets legitimately show diffs.

## 8. Versioning and release lines

Two lines, and they must not be crossed:

| Branch    | Suffix               | npm dist tag |
| --------- | -------------------- | ------------ |
| `develop` | `<base>-a.N` (alpha) | `dev`        |
| `main`    | `<base>-b.N` (beta)  | `latest`     |

`version.mjs` owns this. Per package, it compares the base version against that
package's own upstream counterpart on `os_repo/develop`:

- upstream base is **higher** → adopt it, suffix `-a.0`;
- otherwise → keep our base and increment the alpha counter.

Two things worth knowing. First, upstream's `develop` package.json **lags** its own
releases, because changesets bumps on release — it read `11.17.0` while `11.17.1`
was already out. That is the deterministic signal and it is the intended one, but
don't be surprised by it. Second, `-a.N` sorts **below** `-b.N` for the same base,
because semver compares prerelease identifiers alphabetically. That is intentional
(an alpha precedes the beta of the same base), and it is exactly why alphas publish
under `dev`: `npm publish` moves `latest` regardless of ordering, so an untagged
alpha would become the default install ahead of the beta.

The alpha counter is computed from `origin/develop`, never from the sync branch, so
a rolling pull request open for five days stays at one version instead of drifting.

## 9. When to stop and ask

**Decidable** — resolve it and say what you did: a missing theme variable; a config
default expectation; an import specifier; an upstream test whose premise is false
here; anything the sections above already name.

**Ambiguous** — stop and report: upstream and the fork both implement a feature
with _different observable behaviour_ and only one can survive; upstream removes an
API the fork extends; the fork works around something upstream has now solved
differently and arguably better.

Rule of thumb: if choosing correctly requires knowing what Mermaid Chart's product
wants, it is ambiguous. A blocked run costs one review; a wrong silent resolution
costs a production regression.

## 10. Worked examples

`git show <sha>` these rather than re-deriving. The commit bodies are the real
documentation.

| Commit       | What it teaches                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `a24470c6f4` | 100 commits / 15 conflicts. Regenerate-not-merge; the `DiagramCode` convergence; three clean-merge breakages; the `FlowDB` opt-in that would otherwise have failed silently |
| `fa9709de0f` | Wholesale stack replacement (Cypress → Playwright); porting fork-only specs; the `oldShapes.spec.ts` text-merge disaster; the `e2e.yml` deltas                              |
| `9b95356233` | Silent drop of the `positions` plumbing; a theme-variable spec; import-specifier retargeting                                                                                |
| `ae005555b0` | Private-runner memory limits; lockfile regeneration discipline                                                                                                              |

## 11. Maintenance

**Stable** — change only when the fork's architecture does: sections 2, 3, 4, 6, 7, 9.

**Volatile** — expected to change, and a sync pull request may well touch them: the
"last verified" header, section 1's counts, **section 5 in full**, and section 10.

When adding to section 5, note the commit it came from. That is what lets a stale
entry be retired later with confidence instead of accreting forever.
