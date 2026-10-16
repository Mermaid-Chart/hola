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

async function runLoopWithTrees(): Promise<LayoutData> {
  const mmdPath = resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - hola 4 nodes loop + trees.mmd');
  const sizes = loadSizesFixture(
    resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - hola 4 nodes loop + trees.sizes.json')
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — loop with trees', () => {
  it('does not leave an empty grid lane on the C1–C4 cycle edge', async () => {
    const layout = await runLoopWithTrees();
    const c1 = layout.nodes.find((node) => node.id === 'C1')!;
    const c4 = layout.nodes.find((node) => node.id === 'C4')!;

    expect(Math.abs(c1.y! - c4.y!)).toBeLessThanOrEqual(220);
    expect(validateLayout(layout).issues).toEqual([]);
  });
});
