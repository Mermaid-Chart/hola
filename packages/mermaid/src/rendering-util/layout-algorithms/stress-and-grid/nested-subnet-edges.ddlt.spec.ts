import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('stress-and-grid DDLT — nested subnet edges', () => {
  it('keeps sibling subnet frames disjoint and routes their boundary edges cleanly', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-sb-edges-in-out.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'nested-sb-edges-in-out.sizes.json'))
    );
    runStressAndGridLayoutCore(layout);

    const structuralIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(structuralIssues).toEqual([]);
  });
});
