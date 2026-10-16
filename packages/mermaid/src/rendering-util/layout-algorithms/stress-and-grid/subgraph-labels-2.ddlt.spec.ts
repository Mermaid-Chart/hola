import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('stress-and-grid DDLT — labelled subgraph bundle', () => {
  it('routes repeated labelled edges in separate, centred lanes', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'subgraph-labels-2.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'subgraph-labels-2.sizes.json'))
    );

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    const hardIssues = validation.issues.filter((issue) => issue.type !== 'group-dead-space');
    const bundle = layout.edges.filter((edge) => edge.start === 'a1' && edge.end === 'a2');
    const frame = layout.nodes.find((node) => node.id === 'one')!;
    const loop = layout.edges.find((edge) => edge.start === 'a3' && edge.end === 'a3')!;
    const densityIssue = validation.issues.find(
      (issue) => issue.type === 'group-dead-space' && issue.nodeIds?.includes('one')
    );

    expect(hardIssues).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
    expect(Math.min(...loop.points!.map((point) => point.x)) - (frame.x! - frame.width! / 2)).toBe(
      20
    );
    expect((densityIssue?.details?.fill as number | undefined) ?? 1).toBeGreaterThanOrEqual(0.22);
    expect(bundle).toHaveLength(2);
    expect(bundle.every((edge) => edge.points!.length === 2)).toBe(true);
    const laneCoordinates = bundle.map((edge) => {
      const [start, end] = edge.points!;
      return Math.abs(start.x - end.x) < 1e-6 ? start.x : start.y;
    });
    expect(new Set(laneCoordinates.map((coordinate) => coordinate.toFixed(3))).size).toBe(
      bundle.length
    );
  });
});
