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

async function runDecisionFlow(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'decision-flow.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'decision-flow.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — decision flow', () => {
  it('routes split branches from diamond vertices without crossing task nodes', async () => {
    const layout = await runDecisionFlow();
    const split = layout.nodes.find((node) => node.id === 'Split')!;
    const taskA = layout.nodes.find((node) => node.id === 'T1')!;
    const taskB = layout.nodes.find((node) => node.id === 'T2')!;
    const splitToA = layout.edges.find((edge) => edge.start === 'Split' && edge.end === 'T1')!;
    const splitToB = layout.edges.find((edge) => edge.start === 'Split' && edge.end === 'T2')!;

    expect(validateLayout(layout).issues).toEqual([]);
    expect(taskA.y).toBeCloseTo(taskB.y!, 5);
    expect((taskA.x! + taskB.x!) / 2).toBeCloseTo(split.x!, 5);
    expect(taskA.x).toBeLessThan(split.x!);
    expect(taskB.x).toBeGreaterThan(split.x!);
    expect(splitToA.points![0].x).toBeLessThan(split.x!);
    expect(splitToB.points![0].x).toBeGreaterThan(split.x!);
    expect((splitToA.points![0].x + splitToB.points![0].x) / 2).toBeCloseTo(split.x!, 5);
    for (const edge of [splitToA, splitToB]) {
      const port = edge.points![0];
      expect(Math.abs(port.x - split.x!)).toBeCloseTo(split.width! / 4, 5);
      expect(port.y).toBeCloseTo(split.y! + split.height! / 4, 5);
      expect(edge.points).toHaveLength(3);
    }
  });
});
