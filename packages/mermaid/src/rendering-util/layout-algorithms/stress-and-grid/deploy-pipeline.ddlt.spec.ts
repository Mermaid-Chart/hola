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

  it('pads a group around its title and places a lone exit beside its source', async () => {
    const layout = await runDeployPipeline();
    const node = new Map(layout.nodes.map((candidate) => [candidate.id, candidate]));
    const group = node.get('subGraph0')!;
    const children = layout.nodes.filter((candidate) => candidate.parentId === group.id);
    const left = group.x! - group.width! / 2;
    const right = group.x! + group.width! / 2;
    const top = group.y! - group.height! / 2;
    const bottom = group.y! + group.height! / 2;
    const minimumFrameMargin = Math.min(
      ...children.flatMap((child) => [
        child.x! - child.width! / 2 - left,
        right - (child.x! + child.width! / 2),
        child.y! - child.height! / 2 - top,
        bottom - (child.y! + child.height! / 2),
      ])
    );
    expect(minimumFrameMargin).toBeGreaterThanOrEqual(35.9);

    const production = node.get('K')!;
    const success = node.get('L')!;
    const successEdge = layout.edges.find((edge) => edge.id === 'L_K_L_0')!;
    expect(success.y).toBeCloseTo(production.y!, 5);
    expect(success.x).toBeGreaterThan(right + success.width! / 2);
    expect(successEdge.points).toHaveLength(2);
  });

  it('uses compact vertical lanes inside a group without moving its entry row', async () => {
    const layout = await runDeployPipeline();
    const node = new Map(layout.nodes.map((candidate) => [candidate.id, candidate]));
    const verticalGap = (upperId: string, lowerId: string) => {
      const upper = node.get(upperId)!;
      const lower = node.get(lowerId)!;
      return lower.y! - lower.height! / 2 - (upper.y! + upper.height! / 2);
    };

    expect(verticalGap('G', 'H')).toBeLessThanOrEqual(100);
    expect(verticalGap('I', 'K')).toBeLessThanOrEqual(100);
    expect(verticalGap('B', 'C')).toBeLessThanOrEqual(100);
    expect(verticalGap('C', 'D')).toBeLessThanOrEqual(100);

    const noBranch = layout.edges.find((edge) => edge.id === 'L_D_E_0')!;
    const feedback = layout.edges.find((edge) => edge.id === 'L_E_A_0')!;
    expect(Math.abs(noBranch.points!.at(-1)!.x - feedback.points![0].x)).toBeGreaterThanOrEqual(20);

    for (const edgeId of ['L_D_E_0', 'L_D_F_0', 'L_I_J_0', 'L_I_K_0']) {
      const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
      const finalSegmentStart = edge.points!.at(-2)!;
      const finalSegmentEnd = edge.points!.at(-1)!;
      expect(edge.y).toBeCloseTo((finalSegmentStart.y + finalSegmentEnd.y) / 2, 5);
    }
  });

  it('makes both test decisions symmetric and keeps the deployment stages straight', async () => {
    const layout = await runDeployPipeline();
    const node = new Map(layout.nodes.map((candidate) => [candidate.id, candidate]));
    const edge = new Map(layout.edges.map((candidate) => [candidate.id, candidate]));

    for (const [decisionId, leftId, rightId] of [
      ['D', 'F', 'E'],
      ['I', 'J', 'K'],
    ]) {
      const decision = node.get(decisionId)!;
      const left = node.get(leftId)!;
      const right = node.get(rightId)!;
      expect(left.y).toBeCloseTo(right.y!, 5);
      expect((left.x! + right.x!) / 2).toBeCloseTo(decision.x!, 5);
      expect(left.x).toBeLessThan(decision.x!);
      expect(right.x).toBeGreaterThan(decision.x!);
    }

    expect(node.get('F')!.y).toBeCloseTo(node.get('G')!.y!, 5);
    expect(node.get('G')!.x).toBeCloseTo(node.get('H')!.x!, 5);
    expect(node.get('H')!.y).toBeCloseTo(node.get('I')!.y!, 5);
    for (const edgeId of ['L_F_G_0', 'L_G_H_0', 'L_H_I_0']) {
      expect(edge.get(edgeId)!.points).toHaveLength(2);
    }
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
