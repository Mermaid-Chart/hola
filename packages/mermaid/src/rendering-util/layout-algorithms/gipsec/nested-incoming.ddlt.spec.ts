import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — nested incoming groups', () => {
  it('connects aligned sibling frames directly without routing through either frame', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-incoming.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'nested-incoming.sizes.json'))
    );
    runStressAndGridLayoutCore(layout);

    const groupEdge = layout.edges.find((edge) => edge.id === 'L_sub_one_sub_two_0');
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(hardIssues).toEqual([]);
    expect(groupEdge).toMatchObject({ start: 'sub_one', end: 'sub_two' });
    expect(groupEdge?.points).toHaveLength(2);
    const [start, end] = groupEdge?.points ?? [];
    expect(Math.abs(end.x - start.x) + Math.abs(end.y - start.y)).toBeGreaterThanOrEqual(30);
  });
});
