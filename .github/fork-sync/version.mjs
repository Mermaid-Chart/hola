#!/usr/bin/env node
/**
 * Computes the fork's alpha versions for the `develop` line.
 *
 * The fork publishes two release lines:
 *   develop -> <base>-a.N   (alpha)
 *   main    -> <base>-b.N   (beta)
 *
 * Per package, the base version is compared against that package's own upstream
 * counterpart on os_repo/develop:
 *
 *   upstream base is higher  -> adopt upstream's base, suffix -a.0
 *   otherwise (equal/ahead)  -> keep our base, increment the alpha counter
 *
 * Note `-a.N` sorts BELOW `-b.N` for the same base, because semver compares
 * prerelease identifiers alphabetically. That is intentional (an alpha precedes
 * the beta of the same base) and is why alphas must be published under a
 * non-`latest` dist tag.
 *
 * The current version is read from `origin/develop`, never from the working
 * tree: after a merge the tree may carry upstream's version, which would reset
 * the counter. Reading the branch also keeps a rolling PR from inflating N —
 * five runs before the PR merges all compute the same next version.
 *
 * Usage:
 *   node version.mjs --check              print the table, write nothing
 *   node version.mjs --write              write package.json files
 *   node version.mjs --write --json       ...and emit machine-readable JSON
 *   node version.mjs --list-publishable   emit the publishable packages with the
 *                                         versions currently in the working tree
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const FORK_REF = process.env.FORK_SYNC_FORK_REF ?? 'origin/develop';
const UPSTREAM_REF = process.env.FORK_SYNC_UPSTREAM_REF ?? 'os_repo/develop';

/**
 * `upstream: null` means the package has no upstream counterpart to compare
 * against. Those track the mermaid package so the fork's versions stay
 * consistent, which is what the manual "Update alana version to ..." commits
 * have always done.
 */
const PACKAGES = [
  { dir: 'packages/mermaid', upstream: 'packages/mermaid', publish: true },
  { dir: 'packages/mermaid-layout-elk', upstream: 'packages/mermaid-layout-elk', publish: true },
  {
    dir: 'packages/mermaid-layout-tidy-tree',
    upstream: 'packages/mermaid-layout-tidy-tree',
    publish: true,
  },
  // @mermaid-js/tiny is upstream's npm name — bumped for consistency, never published.
  { dir: 'packages/tiny', upstream: null, tracks: 'packages/mermaid', publish: false },
];

const git = (args) => execFileSync('git', args, { encoding: 'utf8' });

const readJsonAt = (ref, path) => {
  try {
    return JSON.parse(git(['show', `${ref}:${path}/package.json`]));
  } catch {
    return undefined;
  }
};

/** Splits `11.17.1-a.2` into `{ base: '11.17.1', tag: 'a', n: 2 }`. */
export const parseVersion = (version) => {
  const match = /^(\d+\.\d+\.\d+)(?:-([A-Za-z]+)\.(\d+))?/.exec(version ?? '');
  if (!match) {
    throw new Error(`Cannot parse version: ${JSON.stringify(version)}`);
  }
  return {
    base: match[1],
    tag: match[2] ?? null,
    n: match[3] === undefined ? null : Number(match[3]),
  };
};

/** Numeric compare of two `x.y.z` bases. Returns -1, 0 or 1. */
export const compareBase = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) {
      return pa[i] < pb[i] ? -1 : 1;
    }
  }
  return 0;
};

/**
 * The rule. `upstreamBase` is null for packages with no upstream counterpart,
 * which then simply advance their own alpha counter.
 */
export const nextAlpha = (currentVersion, upstreamBase) => {
  const current = parseVersion(currentVersion);

  if (upstreamBase && compareBase(upstreamBase, current.base) > 0) {
    // Upstream moved to a higher base (patch, minor or major) — adopt it and
    // restart the counter.
    return { version: `${upstreamBase}-a.0`, reason: `adopted upstream ${upstreamBase}` };
  }

  if (current.tag === 'a' && current.n !== null) {
    return {
      version: `${current.base}-a.${current.n + 1}`,
      reason: `bumped alpha ${current.n} -> ${current.n + 1}`,
    };
  }

  // Coming from a `-b.N` beta or a bare release: start the alpha line at 0.
  return {
    version: `${current.base}-a.0`,
    reason: current.tag
      ? `started alpha line from -${current.tag}.${current.n}`
      : 'started alpha line',
  };
};

/**
 * The publishable set, read from the working tree rather than from git. Used by
 * publish-alpha.yml so that "which packages do we publish" is defined in exactly
 * one place. @mermaid-js/* names are upstream's and are never published here.
 */
const listPublishable = () => {
  const out = PACKAGES.filter((p) => p.publish).map((p) => {
    const pkg = JSON.parse(readFileSync(`${p.dir}/package.json`, 'utf8'));
    return { dir: p.dir, name: pkg.name, version: pkg.version };
  });
  console.log(JSON.stringify(out));
};

const main = () => {
  if (argv.includes('--list-publishable')) {
    listPublishable();
    return;
  }
  const write = process.argv.includes('--write');
  const asJson = process.argv.includes('--json');
  const results = [];

  for (const pkg of PACKAGES) {
    const forkPkg = readJsonAt(FORK_REF, pkg.dir);
    if (!forkPkg) {
      throw new Error(`Cannot read ${pkg.dir}/package.json at ${FORK_REF}`);
    }

    let upstreamBase = null;
    let upstreamVersion = null;
    if (pkg.upstream) {
      const upstreamPkg = readJsonAt(UPSTREAM_REF, pkg.upstream);
      if (upstreamPkg?.version) {
        upstreamVersion = upstreamPkg.version;
        upstreamBase = parseVersion(upstreamPkg.version).base;
      }
    }

    let next;
    if (pkg.tracks) {
      // Take the tracked package's computed version verbatim so the pair never drifts.
      const tracked = results.find((r) => r.dir === pkg.tracks);
      if (!tracked) {
        throw new Error(`${pkg.dir} tracks ${pkg.tracks}, which has not been computed yet`);
      }
      next = { version: tracked.next, reason: `tracks ${tracked.name}` };
    } else {
      next = nextAlpha(forkPkg.version, upstreamBase);
    }

    results.push({
      dir: pkg.dir,
      name: forkPkg.name,
      current: forkPkg.version,
      upstreamName: pkg.upstream ? (readJsonAt(UPSTREAM_REF, pkg.upstream)?.name ?? null) : null,
      upstream: upstreamVersion,
      next: next.version,
      reason: next.reason,
      publish: pkg.publish,
      changed: forkPkg.version !== next.version,
    });
  }

  if (write) {
    for (const r of results) {
      const file = `${r.dir}/package.json`;
      const raw = readFileSync(file, 'utf8');
      // Rewrite only the top-level "version" string, so formatting, key order
      // and trailing newline survive untouched — a JSON round-trip through
      // JSON.stringify would reformat the file and fight prettier/autofix.ci.
      const updated = raw.replace(
        /^(\s*"version"\s*:\s*")[^"]*(")/m,
        (_m, prefix, suffix) => `${prefix}${r.next}${suffix}`
      );
      if (!updated.includes(`"version": "${r.next}"`)) {
        throw new Error(`Failed to rewrite the version field in ${file}`);
      }
      writeFileSync(file, updated);
    }
  }

  if (asJson) {
    console.log(
      JSON.stringify({ forkRef: FORK_REF, upstreamRef: UPSTREAM_REF, packages: results }, null, 2)
    );
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(
      `${pad('package', 34)}${pad('current', 16)}${pad('upstream', 12)}${pad('next', 16)}reason`
    );
    for (const r of results) {
      console.log(
        `${pad(r.name, 34)}${pad(r.current, 16)}${pad(r.upstream ?? '-', 12)}${pad(r.next, 16)}${r.reason}`
      );
    }
  }
};

// Only run when executed directly, so the unit test can import the pure helpers
// without shelling out to git.
if (argv[1] && resolve(argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
