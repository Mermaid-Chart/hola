# Task: finish the in-progress merge of upstream into this fork

`git merge` has already been run and left its result in the working tree. Your job
is to make that result correct and verifiably green, then write up what you did.

During a merge, `--ours` is **the fork** and `--theirs` is **upstream**.

## Step 0 — load the institutional knowledge first

Read `.github/fork-sync/GUIDE.md` in full before touching anything. It carries the
conflict taxonomy, the fork-only invariants that upstream code routinely breaks,
the regeneration recipes, and the verification traps. It is the distilled result of
every previous merge — do not re-derive what it already tells you.

## Step 1 — classify, then resolve

For each conflicted file, assign a category from the guide and apply that
category's rule. Write the classification down before you start editing; do not
fall into a file-by-file diff-editing loop.

In particular:

- **Generated files and the lockfile:** regenerate, never hand-merge.
- **`package.json` dependency conflicts:** take the union, unless the two
  dependencies are genuinely mutually exclusive.
- **Import-specifier conflicts:** take upstream's import list, keep the fork's
  `@mermaid-chart/*` specifiers.
- **Semantic source conflicts:** read both sides in full. Where both sides
  independently invented the same abstraction, adopt upstream's typed version and
  re-attach the fork's extra capabilities on top. Preserve every fork-only export,
  parameter and return field.

## Step 2 — hunt the clean auto-merges

This is the step that actually matters, and it applies **even when there were zero
conflicts**. `git merge` silently drops fork-only code when upstream rewrites the
surrounding lines.

1. For each file in the guide's fork-owned hot list, run
   `git diff ORIG_HEAD...HEAD -- <path>` and confirm no fork-only code was
   replaced by upstream's version. Look specifically for dropped imports, dropped
   parameters and dropped call arguments.
2. Grep each fork-only identifier the guide names and confirm it still exists and
   is still reachable.
3. Treat any upstream test that asserts an exhaustive property — _every_ theme
   defines X, config defaults equal exactly Y, behaviour Z never happens — as
   false in this fork until you have checked it.

## Step 3 — verify

Run `bash .github/fork-sync/verify.sh --tier full` and iterate until it passes. Do
not run e2e, Playwright or Argos; they run on the pull request.

Read the guide's verification section before concluding that any failure is
pre-existing or spurious. Several of these commands have known traps, and a wrong
call there is precisely how silent breakage ships.

Every failure is one of:

- **(a)** a bad resolution → fix the resolution;
- **(b)** a fork-adaptation gap: upstream's new code is right, and the fork's
  parallel implementation is missing something → **add** the missing thing to the
  fork (define the missing theme variable, opt the fork's DB into the new flag);
- **(c)** an upstream test whose premise is false in this fork → retarget the test
  to a subject where the premise holds, keeping the assertion exactly as strong,
  and say so in your report;
- **(d)** a genuine behavioural conflict → **stop**. Report it. Do not pick.

Never (e): make it pass by making it assert less.

## Step 4 — write your account

Write `resolution.md` into the scratch directory named below. It becomes part of
the pull request body, so write it for a reviewer who has not read the log:

```
### Conflict resolutions (N files)
- `path` — what was kept from which side, and why

### Follow-on fixes the merge required
- `path` — the clean-merge breakage, its root cause, the fix

### Unresolved / needs a decision
- `path` — the question, the options, and why it is not mechanically decidable
```

Keep it short and specific. If a section is empty, say so in one line rather than
padding it.

Do **not** edit `GUIDE.md` yourself. If you found a recurring delta it does not
document, propose the wording at the end of `resolution.md` under
`### Proposed guide addition` and a human will apply it.

## Anti-goals — violating any of these fails the run

- Do not switch, create, reset or delete branches. Do not touch `develop`.
- Do not commit, push, amend, rebase or `git reset`. The workflow does that.
- Do not create git worktrees; one inside the repo breaks the vitest run.
- Do not delete, skip, rename away or weaken any test to reach green.
- Do not edit `.gitignore`, `.prettierignore`, `eslint.config.js`, `cspell.config.yaml`,
  any `tsconfig*.json`, `vite.config.ts`, `vitest.workspace.ts`, `playwright.config.ts`,
  or any `exclude`/`testIgnore` list. Those are the hiding places, and touching one
  fails the run automatically.
- Do not hand-edit any version number. `version.mjs` owns those, and the workflow
  checks the files against what it computes.
- Do not hand-edit `pnpm-lock.yaml`, `packages/mermaid/src/config.type.ts`, anything
  under `docs/`, or anything under a `generated/` directory. Regenerate instead.
- Do not change fork behaviour to match upstream, or upstream behaviour to match the
  fork, because it makes a test pass. Preserve both; if impossible, escalate.
- Do not use the network beyond the package registry that `pnpm install` uses.
