import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — nested outgoing edges', () => {
  it('keeps a nested frame and its child inside their common parent', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-outgoing-edges.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'nested-outgoing-edges.sizes.json'))
    );
    runStressAndGridLayoutCore(layout);

    const structuralIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(structuralIssues).toEqual([]);
  });
});
