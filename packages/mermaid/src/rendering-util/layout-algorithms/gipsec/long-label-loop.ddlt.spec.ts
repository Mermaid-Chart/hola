import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData, Node } from '../../types.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

async function runLongLabelLoop(): Promise<LayoutData> {
  const mmdPath = resolve(
    process.cwd(),
    FIXTURES_DIR,
    'GRAPH - hola 4 nodes loop + trees - Long Labels.mmd'
  );
  const sizes = loadSizesFixture(
    resolve(
      process.cwd(),
      FIXTURES_DIR,
      'GRAPH - hola 4 nodes loop + trees - Long Labels.sizes.json'
    )
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

function bounds(nodes: Node[]) {
  return nodes.reduce(
    (result, node) => ({
      left: Math.min(result.left, node.x! - node.width! / 2),
      right: Math.max(result.right, node.x! + node.width! / 2),
    }),
    { left: Infinity, right: -Infinity }
  );
}

describe('stress-and-grid DDLT — long-label loop with trees', () => {
  it('packs an orphan without stretching the connected component grid', async () => {
    const layout = await runLongLabelLoop();
    const orphan = layout.nodes.find((node) => node.id === 'C5')!;
    const connectedNodes = layout.nodes.filter(
      (node) => node.isGroup !== true && node.id !== orphan.id
    );
    const main = bounds(connectedNodes);
    const orphanLeft = orphan.x! - orphan.width! / 2;
    const c1 = layout.nodes.find((node) => node.id === 'C1')!;
    const c4 = layout.nodes.find((node) => node.id === 'C4')!;

    expect(orphanLeft - main.right).toBeGreaterThanOrEqual(0);
    expect(orphanLeft - main.right).toBeLessThanOrEqual(160);
    expect(Math.abs(c1.y! - c4.y!)).toBeLessThanOrEqual(600);
    expect(validateLayout(layout).issues).toEqual([]);
  });
});
