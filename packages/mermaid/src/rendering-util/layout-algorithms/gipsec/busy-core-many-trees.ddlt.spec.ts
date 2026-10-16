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

async function runBusyCoreManyTrees(): Promise<LayoutData> {
  const mmdPath = resolve(process.cwd(), FIXTURES_DIR, 'busy-core-many-trees.mmd');
  const sizes = loadSizesFixture(
    resolve(process.cwd(), FIXTURES_DIR, 'busy-core-many-trees.sizes.json')
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — busy core with many trees', () => {
  it('routes without crossing nodes, shared segments, or distant detours', async () => {
    const layout = await runBusyCoreManyTrees();
    const hubToA = layout.edges.find((edge) => edge.id === 'L_hub_a_0')!;
    const routeLength = (edgeId: string) => {
      const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
      return edge
        .points!.slice(1)
        .reduce(
          (length, point, index) =>
            length +
            Math.abs(point.x - edge.points![index].x) +
            Math.abs(point.y - edge.points![index].y),
          0
        );
    };
    const validation = validateLayout(layout);
    expect(validation.issues).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
    expect(routeLength(hubToA.id)).toBeLessThan(400);
    expect(routeLength('L_hub_c_0')).toBeLessThan(300);
    for (const edgeId of ['L_hub_leaf2_0', 'L_b_hub_0', 'L_d_hub_0', 'L_a_b_0']) {
      expect(layout.edges.find((edge) => edge.id === edgeId)!.points).toHaveLength(2);
    }
    for (const edgeId of ['L_hub_a_0', 'L_hub_c_0', 'L_hub_leaf1_0']) {
      expect(layout.edges.find((edge) => edge.id === edgeId)!.points!.length).toBeLessThanOrEqual(
        4
      );
    }
  });
});
