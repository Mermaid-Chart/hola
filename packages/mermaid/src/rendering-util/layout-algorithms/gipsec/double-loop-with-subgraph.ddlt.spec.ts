import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

async function runDoubleLoop(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'double-loop-with-subgraph.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'double-loop-with-subgraph.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('gipsec DDLT — double loop with side subgraphs', () => {
  it('does not route the central loop edge along a subgraph border', async () => {
    const layout = await runDoubleLoop();
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(hardIssues).toEqual([]);
    expect(
      layout.edges.find((edge) => edge.id === 'L_T1_T3_0')?.points?.length
    ).toBeLessThanOrEqual(4);
  });
});
