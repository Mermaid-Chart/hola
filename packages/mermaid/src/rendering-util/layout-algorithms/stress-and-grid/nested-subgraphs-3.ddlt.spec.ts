import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('stress-and-grid DDLT — nested three-frame cycle', () => {
  it('separates sibling frames after fitting their title-aware bounds', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-subgraphs-3.mmd'),
      { stampFlowchartRendererFields: true }
    );
    const sizes = loadSizesFixture(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-subgraphs-3.sizes.json')
    );
    applyFixtureContentSizesStrict(layout, sizes);
    for (const node of layout.nodes) {
      if (node.isGroup === true) {
        node.labelBBox = { width: 0, height: 21 };
      }
    }

    runStressAndGridLayoutCore(layout);

    const structuralIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );
    const x = layout.nodes.find((node) => node.id === 'X');
    const y = layout.nodes.find((node) => node.id === 'Y');
    const yToX = layout.edges.find((edge) => edge.start === 'Y' && edge.end === 'X');

    expect(structuralIssues).toEqual([]);
    expect(x).toBeDefined();
    expect(y).toBeDefined();
    expect(yToX).toBeDefined();
    const separatedHorizontally = Math.abs(x!.x! - y!.x!) >= (x!.width! + y!.width!) / 2;
    const separatedVertically = Math.abs(x!.y! - y!.y!) >= (x!.height! + y!.height!) / 2;
    expect(separatedHorizontally || separatedVertically).toBe(true);
    expect(yToX!.points).toHaveLength(2);
  });
});
