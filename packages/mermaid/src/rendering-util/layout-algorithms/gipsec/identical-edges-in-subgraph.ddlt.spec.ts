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

async function runIdenticalEdges(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'identical-edges-in-subgraph.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'identical-edges-in-subgraph.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — identical reciprocal edges in a subgraph', () => {
  it('uses four ordered, straight lanes between the two nodes', async () => {
    const layout = await runIdenticalEdges();
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );
    const edges = layout.edges.filter(
      (edge) => (edge.start === 'A' && edge.end === 'B') || (edge.start === 'B' && edge.end === 'A')
    );

    expect(hardIssues).toEqual([]);
    expect(edges).toHaveLength(4);
    expect(edges.every((edge) => edge.points?.length === 2)).toBe(true);
    expect(new Set(edges.map((edge) => edge.points![0].x.toFixed(3))).size).toBe(edges.length);
    expect(edges.every((edge) => edge.points![0].x === edge.points![1].x)).toBe(true);
  });
});
