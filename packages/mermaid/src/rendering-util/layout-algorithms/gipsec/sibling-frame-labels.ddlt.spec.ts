import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

// Browser measurements captured before arranging private frame convergences.
const measurements = {
  classic: {
    process_C: [131.28125, 54],
    pppB: [95.796875, 54],
    pppA: [96.1875, 54],
    container_Beta: [169.171875, 54],
  },
  neo: {
    process_C: [103.28125, 48],
    pppB: [67.796875, 48],
    pppA: [68.1875, 48],
    container_Beta: [141.171875, 48],
  },
  handDrawn: {
    process_C: [133.67311096191406, 56.8928337097168],
    pppB: [98.77916717529297, 57.18074417114258],
    pppA: [98.77915954589844, 57.18074417114258],
    container_Beta: [171.66404724121094, 57.301544189453125],
  },
  classicRedux: {
    process_C: [126.921875, 51],
    pppB: [92.703125, 51],
    pppA: [92.703125, 51],
    container_Beta: [154.1875, 51],
  },
  neoRedux: {
    process_C: [98.921875, 45],
    pppB: [64.703125, 45],
    pppA: [64.703125, 45],
    container_Beta: [126.1875, 45],
  },
  handDrawnRedux: {
    process_C: [129.01568603515625, 54.467674255371094],
    pppB: [94.94438934326172, 54.161903381347656],
    pppA: [94.94438934326172, 54.161903381347656],
    container_Beta: [156.57467651367188, 54.467674255371094],
  },
};
const defaultTitles: Record<string, number> = {
  container_Alpha: 116.859375,
  container_Beta: 109.171875,
  process_A: 71.15625,
  process_B: 70.765625,
};
const reduxTitles: Record<string, number> = {
  container_Alpha: 101.1875,
  container_Beta: 94.1875,
  process_A: 66.15625,
  process_B: 66.15625,
};

async function measuredLayout(
  variant: keyof typeof measurements,
  direction = 'TB',
  framedTarget = false
) {
  const layout = await parseMmdFileToLayoutData(
    resolve(
      process.cwd(),
      `e2e/platform/dev-diagrams/test-dataset/SUBGRAPH knsv2-${framedTarget ? '08' : '07'}-flowchart-dagre-tb-subgraphs.mmd`
    ),
    { stampFlowchartRendererFields: true }
  );
  layout.direction = direction;
  const redux = variant.endsWith('Redux');
  const titles = redux ? reduxTitles : defaultTitles;
  const labelHeight = redux ? 21 : 24;
  for (const node of layout.nodes) {
    if (node.isGroup) {
      expect(titles[node.id], `title measurement for ${node.id}`).toBeDefined();
      node.labelBBox = { width: titles[node.id], height: labelHeight } as DOMRect;
    } else {
      const size = measurements[variant][node.id as keyof (typeof measurements)['classic']];
      expect(size, `measurement for ${node.id}`).toBeDefined();
      [node.width, node.height] = size;
    }
  }
  for (const edge of layout.edges) {
    edge.width =
      edge.label === 'via_AWSBatch' ? (redux ? 92.859375 : 99.03125) : redux ? 63.8125 : 66.609375;
    edge.height = labelHeight;
  }
  return layout;
}

describe('gipsec DDLT — labelled sibling-frame convergence', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['TB', 'BT', 'LR', 'RL'].flatMap((direction) =>
      [false, true].map((framedTarget) => ({ variant, direction, framedTarget }))
    )
  );
  it.each(cases)(
    'keeps frame-edge labels visible with $variant measurements in $direction (framed target: $framedTarget)',
    async ({ variant, direction, framedTarget }) => {
      const layout = await measuredLayout(variant, direction, framedTarget);
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(
        result.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);

      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      const target = nodes.get('container_Beta')!;
      if (framedTarget) {
        const member = nodes.get('process_C')!;
        expect(member.parentId).toBe(target.id);
        expect(member.x).toBeCloseTo(target.x!, 6);
        expect(member.y! - target.y!).toBeCloseTo(target.labelBBox!.height / 2, 6);
        const sourceXs = layout.edges.map((edge) => nodes.get(edge.start!)!.x!);
        expect(Math.min(...sourceXs)).toBeLessThan(target.x!);
        expect(Math.max(...sourceXs)).toBeGreaterThan(target.x!);
      }
      for (const edge of layout.edges) {
        const frame = nodes.get(edge.start!)!;
        const member = layout.nodes.find((node) => node.parentId === frame.id)!;
        expect(member.x).toBeCloseTo(frame.x!, 6);
        expect(member.y! - frame.y!).toBeCloseTo(frame.labelBBox!.height / 2, 6);
        expect(target.y).toBeCloseTo(frame.y!, 6);
        const gap = Math.abs(target.x! - frame.x!) - (target.width! + frame.width!) / 2;
        expect(gap).toBeGreaterThanOrEqual(edge.width! + 24 - 1e-6);
        expect(edge.points).toHaveLength(2);
      }
    }
  );

  it('does not treat two edges from the same frame as a private two-frame convergence', async () => {
    const layout = await measuredLayout('classic');
    layout.edges[1].start = layout.edges[0].start;
    expect(() => runStressAndGridLayoutCore(layout)).not.toThrow();
  });
});
