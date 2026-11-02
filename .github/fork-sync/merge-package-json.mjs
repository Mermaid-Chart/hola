/**
 * Three-way merge one conflicted package.json from its git stages.
 *
 * Exists because package.json conflicts on essentially every upstream release —
 * upstream's changeset bumps `version`, and so does this fork's alpha line — and
 * a naive "is ours identical to theirs apart from version" test is useless here:
 * the fork permanently renames the package, retargets `repository`, and adds
 * fork-only scripts, so the two sides always differ in many fields.
 *
 * The question that actually matters is narrower: which fields do BOTH sides
 * change, differently, relative to the merge base? Everything else has an
 * unambiguous answer. If `version` is the only such field, the conflict carries
 * no decision and a human adds nothing by looking at it.
 *
 * Writes the merged file and prints JSON describing what it did. Exits non-zero
 * without touching the file if any field other than `version` genuinely
 * conflicts — the caller then defers that path to a human.
 *
 * Arrays and scalars are compared whole; no element-level merge is attempted,
 * so two sides reordering the same array is a conflict, deliberately.
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

const path = argv[2];
if (!path) {
  console.error('usage: merge-package-json.mjs <path>');
  exit(2);
}

/** A stage may be absent (added on one side only); that is not an error. */
const stage = (n) => {
  try {
    return JSON.parse(execFileSync('git', ['show', `:${n}:${path}`], { encoding: 'utf8' }));
  } catch {
    return undefined;
  }
};

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

const conflicts = [];

/** Standard three-way merge: whichever side moved wins; if both moved, recurse or conflict. */
const merge = (base, ours, theirs, trail = []) => {
  if (same(ours, theirs)) {
    return ours;
  }
  if (same(ours, base)) {
    return theirs; // only upstream moved
  }
  if (same(theirs, base)) {
    return ours; // only the fork moved
  }
  if (isPlainObject(ours) && isPlainObject(theirs)) {
    const out = {};
    const keys = [
      ...new Set([...Object.keys(ours), ...Object.keys(theirs), ...Object.keys(base ?? {})]),
    ];
    for (const k of keys) {
      const merged = merge(isPlainObject(base) ? base[k] : undefined, ours[k], theirs[k], [
        ...trail,
        k,
      ]);
      // `undefined` means the key is deleted on the winning side.
      if (merged !== undefined) {
        out[k] = merged;
      }
    }
    return out;
  }
  conflicts.push(trail.join('.') || '<root>');
  return ours;
};

const base = stage(1);
const ours = stage(2);
const theirs = stage(3);

if (ours === undefined || theirs === undefined) {
  console.log(JSON.stringify({ path, resolved: false, reason: 'add/add or delete/modify' }));
  exit(1);
}

const merged = merge(base, ours, theirs);
const unexpected = conflicts.filter((c) => c !== 'version');

if (unexpected.length > 0) {
  console.log(JSON.stringify({ path, resolved: false, conflicts, reason: 'non-version conflict' }));
  exit(1);
}

// `version` is deliberately left at the fork's value. version.mjs runs next and
// computes the real alpha from `origin/develop`, not from the working tree, so
// whatever sits here is overwritten — it only has to be valid JSON.
writeFileSync(path, JSON.stringify(merged, null, 2) + '\n');
console.log(JSON.stringify({ path, resolved: true, conflicts }));
