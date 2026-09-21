import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests';

addDiagrams();

async function runDeployPipeline(): Promise<LayoutData> {
  const mmdPath = resolve(process.cwd(), FIXTURES_DIR, 'deploy-pipeline.mmd');
  const sizes = loadSizesFixture(
    resolve(process.cwd(), FIXTURES_DIR, 'deploy-pipeline.sizes.json')
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — deploy-pipeline.mmd', () => {
  it('routes boundary-anchored grid paths without hitting nodes', async () => {
    const layout = await runDeployPipeline();
    const result = validateLayout(layout);
    const routingIssues = result.issues.filter(
      (issue) =>
        issue.type !== 'group-dead-space' &&
        issue.type !== 'grid-misalignment' &&
        // The shared validator models a diamond as its bounding rectangle.
        // Sloped-side ports intentionally fall inside that rectangle while
        // remaining on the actual diamond outline.
        issue.type !== 'port-off-diamond-corner' &&
        !(
          issue.type === 'edge-intersects-obstacle' &&
          ((issue.edgeId === 'L_C_D_0' && issue.nodeIds?.[0] === 'D') ||
            (issue.edgeId === 'L_H_I_0' && issue.nodeIds?.[0] === 'I'))
        )
    );

    expect(routingIssues).toEqual([]);
  });

  it('uses both grid axes rather than stretching the feedback loop into one column', async () => {
    const layout = await runDeployPipeline();
    const leaves = layout.nodes.filter((node) => node.isGroup !== true);
    const uniqueX = new Set(leaves.map((node) => Math.round(node.x!))).size;
    const uniqueY = new Set(leaves.map((node) => Math.round(node.y!))).size;

    expect(uniqueX).toBeGreaterThanOrEqual(3);
    expect(uniqueY).toBeGreaterThanOrEqual(3);
  });

  it('attaches decision edges at the middle of a sloped diamond side', async () => {
    const layout = await runDeployPipeline();
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    for (const edgeId of ['L_D_E_0', 'L_D_F_0', 'L_I_J_0', 'L_I_K_0']) {
      const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
      const node = nodeById.get(edge.start!)!;
      const port = edge.points![0];

      expect(Math.abs(port.x - node.x!)).toBeCloseTo(node.width! / 4, 5);
      expect(Math.abs(port.y - node.y!)).toBeCloseTo(node.height! / 4, 5);
    }
  });

  it('attaches incoming decision edges at their diamond vertex', async () => {
    const layout = await runDeployPipeline();
    const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));

    for (const edgeId of ['L_C_D_0', 'L_H_I_0']) {
      const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
      const node = nodeById.get(edge.end!)!;
      const port = edge.points!.at(-1)!;

      expect(
        (Math.abs(port.x - node.x!) <= 1e-6 && Math.abs(port.y - node.y!) === node.height! / 2) ||
          (Math.abs(port.y - node.y!) <= 1e-6 && Math.abs(port.x - node.x!) === node.width! / 2)
      ).toBe(true);
    }
  });
});
