/**
 * Score sweep over the **Loop Fixtures** corpus — the instrument `/hola-improve-loop`
 * hill-climbs on.
 *
 * This is a sibling of `scoreSweep.spec.ts`, not a replacement. That file sweeps
 * `layout-tests/hola/`, a shared corpus whose floor is guarded by a `KNOWN_INVALID`
 * ratchet: a fixture that goes invalid there fails the build, because it is a
 * regression in work other people depend on.
 *
 * This file sweeps `layout-tests/Loop Fixtures/`, a corpus curated by hand to steer the
 * improvement loop. The difference that matters is the **absence of a floor**: an
 * invalid fixture here is the loop's next target, not a failure. Asserting a floor on a
 * corpus whose whole purpose is to contain unsolved cases would mean the loop could
 * never start — which is exactly the state the hola corpus is in.
 *
 * So what does this spec assert? Only that the sweep could run at all: that the corpus
 * is non-empty and every fixture parsed and laid out without throwing. A crash is a
 * broken instrument and must fail; a low score is data.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';
import { log, setLogLevel } from '../../../../logger.js';
import { combineValidateLayoutResults } from '../../ddlt/aggregateValidate.js';
import type { NamedValidateResult } from '../../ddlt/aggregateValidate.js';
import { applyFixtureEdgeLabelSizes } from '../../ddlt/backends.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../../ddlt/fixtureSizes.js';
import { layoutTestsDir } from '../../ddlt/paths.js';
import { parseMmdFileToLayoutData } from '../../ddlt/parseToLayoutData.js';
import { validateLayout } from '../../layout-utils/validateLayout.js';
import type { ValidateLayoutResult } from '../../layout-utils/validateLayout.js';
import { runGridAttachedLayoutCore } from './layoutCore.js';

const FIXTURE_DIR = join(layoutTestsDir(), 'Loop Fixtures');

interface DiscoveredFixtures {
  pairs: { name: string; sizes: string }[];
  /** `.mmd` files with no sizes companion — invisible to the sweep unless reported. */
  skipped: string[];
}

/**
 * Pair every `.mmd` with its captured sizes.
 *
 * A `.mmd` without a `.sizes.json` cannot be laid out DOM-free, so it is dropped. The
 * hola sweep drops it silently, which makes "I added a fixture and nothing happened" a
 * genuinely confusing five minutes. Here the drop is collected and reported instead.
 */
function discover(): DiscoveredFixtures {
  const files = readdirSync(FIXTURE_DIR);
  const pairs: { name: string; sizes: string }[] = [];
  const skipped: string[] = [];

  for (const name of files.filter((f) => f.endsWith('.mmd')).map((f) => f.replace(/\.mmd$/, ''))) {
    const sizes = [`${name}.sizes.json`, `${name}.json`].find((c) => files.includes(c));
    if (sizes) {
      pairs.push({ name, sizes });
    } else {
      skipped.push(name);
    }
  }

  pairs.sort((a, b) => a.name.localeCompare(b.name));
  skipped.sort();
  return { pairs, skipped };
}

/**
 * Per-issue counts and a few examples, for picking what to work on next.
 *
 * Off by default because the sweep's job is the total; set `LOOP_FIXTURES_ISSUES=1`
 * when choosing a target.
 */
function reportIssues(name: string, result: ValidateLayoutResult): void {
  if (!process.env.LOOP_FIXTURES_ISSUES || result.issues.length === 0) {
    return;
  }
  const counts = new Map<string, number>();
  for (const issue of result.issues) {
    counts.set(issue.type, (counts.get(issue.type) ?? 0) + 1);
  }
  const summary = [...counts].map(([type, n]) => `${type}×${n}`).join(' ');
  log.debug(`LOOP-FIXTURES-ISSUES: ${name} ${summary}`);
  for (const issue of result.issues.slice(0, 4)) {
    log.debug(`LOOP-FIXTURES-ISSUES:   ${name} | ${issue.type} | ${issue.message}`);
  }
}

describe('Loop Fixtures score sweep', () => {
  beforeAll(() => {
    setLogLevel('debug');
    addDiagrams();
  });

  it('scores every fixture and reports the total', async () => {
    const { pairs, skipped } = discover();

    for (const name of skipped) {
      log.debug(`LOOP-FIXTURES-AGG: skipped (no sizes) ${name}.mmd`);
    }

    // An empty corpus is not a passing sweep — it is a sweep with nothing to say. Fail
    // loudly and name the folder, rather than reporting a cheerful total of 0.
    expect(
      pairs.length,
      `No fixtures found in "${FIXTURE_DIR}". A fixture is a pair: <name>.mmd plus ` +
        `<name>.sizes.json. ${
          skipped.length > 0
            ? `Found ${skipped.length} .mmd file(s) with no sizes companion: ${skipped.join(', ')}.`
            : 'The folder has no .mmd files at all.'
        } See the folder's README.md for how to capture sizes.`
    ).toBeGreaterThan(0);

    const results: NamedValidateResult[] = [];
    for (const { name, sizes } of pairs) {
      const layout = await parseMmdFileToLayoutData(join(FIXTURE_DIR, `${name}.mmd`), {
        stampFlowchartRendererFields: true,
      });
      const captured = loadSizesFixture(join(FIXTURE_DIR, sizes));
      applyFixtureContentSizesStrict(layout, captured);
      applyFixtureEdgeLabelSizes(layout, captured);
      runGridAttachedLayoutCore(layout);
      const validated = validateLayout(layout);
      results.push({ id: name, result: validated });
      reportIssues(name, validated);
    }

    const report = combineValidateLayoutResults(results);

    log.debug('LOOP-FIXTURES-AGG: aggregate report', {
      total: report.totalScore,
      avg: Math.round(report.avgScore),
      min: report.minScore,
      invalid: report.invalidCount,
      cases: report.byCase.length,
      skipped: skipped.length,
    });
    for (const row of report.byCase) {
      log.debug(
        `LOOP-FIXTURES-AGG: ${row.id} score=${row.score} valid=${row.valid} issues=${
          row.issueTypes.join(',') || '-'
        }`
      );
    }

    // No floor assertion by design — see the file header. Reaching this line means every
    // fixture laid out and scored without throwing, which is all this spec claims.
  });
});
