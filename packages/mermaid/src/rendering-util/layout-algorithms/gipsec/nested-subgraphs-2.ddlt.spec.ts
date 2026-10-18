import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — nested subgraph paint order', () => {
  it('orders outer frames before nested frames for the common painter', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-subgraphs-2.mmd'),
      { stampFlowchartRendererFields: true }
    );
    const sizes = loadSizesFixture(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-subgraphs-2.sizes.json')
    );
    applyFixtureContentSizesStrict(layout, sizes);
    for (const node of layout.nodes) {
      if (node.isGroup === true) {
        node.labelBBox = { width: 0, height: 21 };
      }
    }

    runStressAndGridLayoutCore(layout);

    expect(layout.nodes.filter((node) => node.isGroup).map((node) => node.id)).toEqual([
      'O',
      'A',
      'B',
    ]);
  });
});
