#!/usr/bin/env node
/**
 * Computes the fork's prerelease versions for whichever release line is being
 * cut.
 *
 * The fork publishes two lines, and they must not be crossed:
 *
 *   develop -> <base>-a.N   (alpha), dist tag `dev`
 *   main    -> <base>-b.N   (beta),  dist tag `latest`
 *
 * One rule serves both. Per package, the current version is read from the line's
 * OWN branch and compared against the base of whatever is flowing into it:
 *
 *   alpha:  current from origin/develop, incoming from os_repo/develop (upstream)
 *   beta:   current from origin/main,    incoming from origin/develop  (our alpha)
 *
 *   incoming base is higher  -> adopt it, restart the counter at 0
 *   otherwise (equal/ahead)  -> keep our base, increment the counter
 *
 * So promoting develop to main after upstream's 12.0.0 lands takes main from
 * `11.17.1-b.2` to `12.0.0-b.0`: develop's base is higher, so the base is
 * adopted and the beta counter restarts. A second promotion against the same
 * base gives `12.0.0-b.1`.
 *
 * Note `-a.N` sorts BELOW `-b.N` for the same base, because semver compares
 * prerelease identifiers alphabetically. That is intentional (an alpha precedes
 * the beta of the same base) and is why alphas must be published under a
 * non-`latest` dist tag.
 *
 * The current version always comes from the branch, never from the working
 * tree: after a merge the tree carries the OTHER line's version, which would
 * reset or corrupt the counter. Reading the branch also keeps a rolling PR from
 * inflating N — five runs before the PR merges all compute the same next
 * version.
 *
 * Usage:
 *   node version.mjs --check                 print the table, write nothing
 *   node version.mjs --write                 write package.json files
 *   node version.mjs --write --json          ...and emit machine-readable JSON
 *   node version.mjs --line beta --check     compute the beta line instead
 *   node version.mjs --list-publishable      emit the publishable packages with
 *                                            the versions in the working tree
 *
 * `--line` may also be given as FORK_SYNC_LINE, so that a wrapper which shells
 * out to this script without forwarding argv — guard.sh does — still agrees
 * with the line being cut.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Per line: the prerelease letter, which branch holds the current version, and
 * what flows into it. `incomingPath` differs because the alpha line compares
 * against upstream's tree, where our packages sit under their original names,
 * while the beta line compares against our own develop, where the paths are
 * simply our own.
 */
const LINES = {
  alpha: {
    tag: 'a',
    forkRef: 'origin/develop',
    incomingRef: 'os_repo/develop',
    incomingPath: (pkg) => pkg.upstream,
    incomingLabel: 'upstream',
  },
  beta: {
    tag: 'b',
    forkRef: 'origin/main',
    incomingRef: 'origin/develop',
    incomingPath: (pkg) => pkg.dir,
    incomingLabel: 'develop',
  },
};

const readLine = () => {
  const i = argv.indexOf('--line');
  const name = (i === -1 ? process.env.FORK_SYNC_LINE : argv[i + 1]) ?? 'alpha';
  if (!Object.hasOwn(LINES, name)) {
    throw new Error(
      `Unknown --line ${JSON.stringify(name)}. Expected one of: ${Object.keys(LINES).join(', ')}`
    );
  }
  return name;
};

const LINE = readLine();
const { tag: TAG, incomingPath, incomingLabel } = LINES[LINE];
const FORK_REF = process.env.FORK_SYNC_FORK_REF ?? LINES[LINE].forkRef;
const UPSTREAM_REF = process.env.FORK_SYNC_UPSTREAM_REF ?? LINES[LINE].incomingRef;

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
 * The rule, shared by both lines. `incomingBase` is null for packages with no
 * counterpart on the incoming side, which then simply advance their own
 * counter.
 *
 * `tag` is the prerelease letter of the line being computed — 'a' for the
 * develop alpha line, 'b' for the main beta line. It is deliberately the only
 * thing that differs: a beta promotion and an upstream sync are the same
 * operation pointed at different refs.
 */
export const nextVersion = (currentVersion, incomingBase, tag = 'a', label = 'upstream') => {
  const current = parseVersion(currentVersion);
  const line = tag === 'b' ? 'beta' : 'alpha';

  if (incomingBase && compareBase(incomingBase, current.base) > 0) {
    // The incoming side moved to a higher base (patch, minor or major) — adopt
    // it and restart the counter. This is what turns main's 11.17.1-b.2 into
    // 12.0.0-b.0 when develop has already reached 12.0.0.
    return {
      version: `${incomingBase}-${tag}.0`,
      reason: `adopted ${label} ${incomingBase}`,
    };
  }

  if (current.tag === tag && current.n !== null) {
    return {
      version: `${current.base}-${tag}.${current.n + 1}`,
      reason: `bumped ${line} ${current.n} -> ${current.n + 1}`,
    };
  }

  // Coming from the other line's suffix or a bare release: start this line at 0.
  return {
    version: `${current.base}-${tag}.0`,
    reason: current.tag
      ? `started ${line} line from -${current.tag}.${current.n}`
      : `started ${line} line`,
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

    const cmpPath = incomingPath(pkg);
    let upstreamBase = null;
    let upstreamVersion = null;
    if (cmpPath) {
      const upstreamPkg = readJsonAt(UPSTREAM_REF, cmpPath);
      // Must not be soft. A missing read looks identical to "the incoming side
      // is behind" and quietly keeps the fork base, so layout-tidy-tree would
      // stay at 0.2.1 while upstream shipped 0.2.2 — the exact drift this rule
      // exists to fix.
      if (!upstreamPkg?.version) {
        throw new Error(
          `Cannot read ${cmpPath}/package.json at ${UPSTREAM_REF}. ` +
            `Fetch that ref, or set FORK_SYNC_UPSTREAM_REF to one that exists.`
        );
      }
      upstreamVersion = upstreamPkg.version;
      upstreamBase = parseVersion(upstreamPkg.version).base;
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
      next = nextVersion(forkPkg.version, upstreamBase, TAG, incomingLabel);
    }

    results.push({
      dir: pkg.dir,
      name: forkPkg.name,
      current: forkPkg.version,
      upstreamName: cmpPath ? (readJsonAt(UPSTREAM_REF, cmpPath)?.name ?? null) : null,
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
      JSON.stringify(
        { line: LINE, forkRef: FORK_REF, upstreamRef: UPSTREAM_REF, packages: results },
        null,
        2
      )
    );
  } else {
    const pad = (s, n) => String(s).padEnd(n);
    console.log(`line: ${LINE}   current from ${FORK_REF}   incoming from ${UPSTREAM_REF}`);
    console.log(
      `${pad('package', 34)}${pad('current', 16)}${pad(incomingLabel, 12)}${pad('next', 16)}reason`
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
