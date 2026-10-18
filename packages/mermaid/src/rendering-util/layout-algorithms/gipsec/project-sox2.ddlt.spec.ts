import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests';

addDiagrams();

describe('gipsec DDLT — layered project workflow', () => {
  it('lays out the acyclic fork-and-merge graph in compact downward ranks', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'project-sox2.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'project-sox2.sizes.json'))
    );

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
    const bounds = layout.nodes.reduce(
      (result, node) => ({
        left: Math.min(result.left, node.x! - node.width! / 2),
        right: Math.max(result.right, node.x! + node.width! / 2),
      }),
      { left: Number.POSITIVE_INFINITY, right: Number.NEGATIVE_INFINITY }
    );

    expect(validation.issues).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
    expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(100);
    expect(bounds.right - bounds.left).toBeLessThan(1800);
    for (const edge of layout.edges) {
      expect(nodes.get(edge.end!)!.y!).toBeGreaterThan(nodes.get(edge.start!)!.y!);
      expect(edge.points!.length).toBeLessThanOrEqual(6);
    }
    expect(nodes.get('D')!.y).toBeCloseTo(nodes.get('E')!.y!);
    expect(nodes.get('E')!.y).toBeCloseTo(nodes.get('F')!.y!);
    expect(nodes.get('I')!.y).toBeCloseTo(nodes.get('J')!.y!);
    expect(nodes.get('J')!.y).toBeCloseTo(nodes.get('K')!.y!);
    expect(nodes.get('K')!.y).toBeCloseTo(nodes.get('N')!.y!);
  });
});
