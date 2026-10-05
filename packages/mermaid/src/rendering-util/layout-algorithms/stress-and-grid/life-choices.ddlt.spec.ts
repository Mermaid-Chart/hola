import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests';

addDiagrams();

describe('stress-and-grid DDLT — life-choices', () => {
  it.each([
    ['classic size capture', 'life-choices.sizes.json'],
    ['neo size capture', 'hola/life-choices.sizes.json'],
  ])('keeps converging choices on separate routes for %s', async (_appearance, sizesFile) => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'life-choices.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, sizesFile))
    );

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    expect(validation.issues).toEqual([]);
    expect(validation.score).toBeGreaterThan(0);
    expect(validation.breakdown.crossings).toBeLessThan(6);
    for (const edgeId of ['L_B_n0_0', 'L_B_nl_0', 'L_B_nm_0', 'L_B_n3_0']) {
      expect(validation.breakdown.edges.find((edge) => edge.id === edgeId)?.crossings, edgeId).toBe(
        0
      );
    }
    const betterWorkToHappyLife = layout.edges.find((edge) => edge.id === 'L_nh_ne_0')!;
    expect(Math.max(...betterWorkToHappyLife.points.map((point) => point.x))).toBeLessThan(20);
    expect(betterWorkToHappyLife.points).toHaveLength(4);
  });
});
