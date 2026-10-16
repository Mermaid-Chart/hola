import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — multiple edges', () => {
  it('keeps an aligned multi-edge pair in distinct, straight lanes', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'multiple-edges.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'multiple-edges.sizes.json'))
    );
    runStressAndGridLayoutCore(layout);

    const bundle = layout.edges.filter(
      (edge) => (edge.start === 'a' && edge.end === 'b') || (edge.start === 'b' && edge.end === 'a')
    );
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );
    const laneCoordinates = bundle.map((edge) => {
      const [start, end] = edge.points!;
      return Math.abs(start.x - end.x) < 1e-6 ? start.x : start.y;
    });

    expect(hardIssues).toEqual([]);
    expect(bundle).toHaveLength(4);
    expect(bundle.every((edge) => edge.points?.length === 2)).toBe(true);
    expect(new Set(laneCoordinates.map((coordinate) => coordinate.toFixed(3))).size).toBe(4);
  });
});
