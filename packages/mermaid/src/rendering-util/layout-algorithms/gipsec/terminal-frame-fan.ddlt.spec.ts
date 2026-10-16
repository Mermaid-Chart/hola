import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeTerminalFrameFan } from './terminalFrameFan.js';

addDiagrams();

// Browser leaf/title/label measurements captured before this placement fix.
const ids = ['C', 'D', 'F', 'I', 'J', 'K'];
const measurements = {
  classic: [
    [69.578125, 54],
    [147.1875, 147.1875],
    [197.875, 54],
    [64.453125, 54],
    [175.5, 54],
    [210.015625, 54],
  ],
  classicRedux: [
    [70.125, 51],
    [142.0625, 142.0625],
    [182.171875, 51],
    [63.890625, 51],
    [158.828125, 51],
    [189.96875, 51],
  ],
  neo: [
    [41.578125, 48],
    [147.1875, 147.1875],
    [169.875, 48],
    [36.453125, 48],
    [147.5, 48],
    [182.015625, 48],
  ],
  neoRedux: [
    [42.125, 45],
    [142.0625, 142.0625],
    [154.171875, 45],
    [35.890625, 45],
    [130.828125, 45],
    [161.96875, 45],
  ],
  handDrawn: [
    [71.63421630859375, 57.48651123046875],
    [148.7676239013672, 148.48768615722656],
    [200.71238708496094, 57.55194854736328],
    [66.7660903930664, 56.83366394042969],
    [178.2246551513672, 57.301544189453125],
    [212.7819366455078, 57.55194854736328],
  ],
  handDrawnRedux: [
    [72.44281768798828, 53.82040023803711],
    [143.6426239013672, 143.36268615722656],
    [184.48851013183594, 54.53311538696289],
    [65.88655853271484, 53.85440444946289],
    [161.0821533203125, 53.83464431762695],
    [192.7733917236328, 54.161903381347656],
  ],
};

async function measuredLayout(variant: keyof typeof measurements) {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SUBRAPH decision small.mmd'),
    { stampFlowchartRendererFields: true }
  );
  const redux = variant.endsWith('Redux');
  for (const node of layout.nodes) {
    if (node.isGroup) {
      node.labelBBox = { width: redux ? 97.296875 : 110.59375, height: redux ? 21 : 24 } as DOMRect;
    } else {
      expect(ids, `measurement for ${node.id}`).toContain(node.id);
      [node.width, node.height] = measurements[variant][ids.indexOf(node.id)];
    }
  }
  for (const edge of layout.edges) {
    if (edge.label) {
      edge.width =
        edge.label === 'No' ? (redux ? 17.90625 : 18.796875) : redux ? 22.84375 : 22.65625;
      edge.height = redux ? 21 : 24;
    }
  }
  return layout;
}

describe('gipsec DDLT — symmetric framed terminal fork', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['TB', 'BT', 'LR', 'RL'].map((direction) => ({ variant, direction }))
  );
  it.each(cases)(
    'keeps entry straight and branches mirrored with $variant in $direction',
    async ({ variant, direction }) => {
      const layout = await measuredLayout(variant);
      layout.direction = direction;
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
      const edge = (id: string) => layout.edges.find((candidate) => candidate.id === id)!;
      const horizontal = direction === 'LR' || direction === 'RL';
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const size = horizontal ? 'width' : 'height';
      const acrossSize = horizontal ? 'height' : 'width';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      expect((node('J')[across]! + node('K')[across]!) / 2).toBeCloseTo(node('I')[across]!, 6);
      expect(node('J')[along]! - (sign * node('J')[size]!) / 2).toBeCloseTo(
        node('K')[along]! - (sign * node('K')[size]!) / 2,
        6
      );
      expect(edge('L_D_F_0').points).toHaveLength(2);
      const departure = edge('L_D_F_0').points![0];
      expect(departure[across] - node('D')[across]!).toBeCloseTo(node('D')[acrossSize]! / 4, 6);
      expect(departure[along] - node('D')[along]!).toBeCloseTo((sign * node('D')[size]!) / 4, 6);
      expect(edge('L_C_D_0').points).toHaveLength(2);
      expect(node('C')[across]).toBeCloseTo(node('D')[across]!, 6);

      const first = edge('L_I_J_0').points!;
      const second = edge('L_I_K_0').points!;
      expect(first.length).toBeLessThanOrEqual(4);
      expect(second).toHaveLength(first.length);
      first.forEach((point, index) => {
        expect(point[along]).toBeCloseTo(second[index][along], 6);
        expect((point[across] + second[index][across]) / 2).toBeCloseTo(node('I')[across]!, 6);
      });
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(10);
      for (const member of layout.nodes) {
        expect(member.parentId).toBe(parents.get(member.id));
      }
    }
  );

  it('matches longer entry/predecessor chains and renamed nodes, not diagram-specific IDs', async () => {
    const layout = await measuredLayout('classic');
    const entry = layout.nodes.find((node) => node.id === 'F')!;
    const predecessor = layout.nodes.find((node) => node.id === 'C')!;
    layout.nodes.push({ ...entry, id: 'stage', width: 90 }, { ...predecessor, id: 'root' });
    const internal = layout.edges.find((edge) => edge.start === 'F')!;
    internal.end = 'stage';
    layout.edges.push(
      { ...internal, id: 'next-stage', start: 'stage', end: 'I' },
      { ...internal, id: 'root-entry', start: 'root', end: 'C' }
    );
    const renamed = new Map(layout.nodes.map((node, index) => [node.id, `fan-node-${index}`]));
    for (const node of layout.nodes) {
      node.id = renamed.get(node.id)!;
      if (node.parentId) {
        node.parentId = renamed.get(node.parentId)!;
      }
    }
    for (const edge of layout.edges) {
      edge.start = renamed.get(edge.start!)!;
      edge.end = renamed.get(edge.end!)!;
    }
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBe(10);
    expect(layout.edges.find((edge) => edge.id === 'L_D_F_0')!.points).toHaveLength(2);
  });

  it.each([
    'start-port',
    'end-port',
    'minlen',
    'frame-direction',
    'extra-link',
    'frame-link',
    'nonterminal-branch',
    'nested-frame',
    'unaccounted-member',
    'invalid-endpoint',
    'missing-size',
  ])('leaves non-private or explicitly constrained geometry unchanged (%s)', async (constraint) => {
    const layout = await measuredLayout('classic');
    runStressAndGridLayoutCore(layout);
    const edge = layout.edges.find((candidate) => candidate.id === 'L_D_F_0')!;
    const frame = layout.nodes.find((node) => node.isGroup)!;
    const branch = layout.nodes.find((node) => node.id === 'J')!;
    if (constraint === 'start-port') {
      edge.startSide = 'bottom';
    }
    if (constraint === 'end-port') {
      edge.endSide = 'top';
    }
    if (constraint === 'minlen') {
      edge.minlen = 2;
    }
    if (constraint === 'frame-direction') {
      frame.dir = 'LR';
    }
    if (constraint === 'extra-link') {
      layout.edges.push({ ...edge, id: 'extra', start: 'C', end: 'I' });
    }
    if (constraint === 'frame-link') {
      layout.edges.push({ ...edge, id: 'frame', start: frame.id, end: 'D' });
    }
    if (constraint === 'nonterminal-branch') {
      layout.edges.push({ ...edge, id: 'next', start: 'J', end: 'C' });
    }
    if (constraint === 'nested-frame') {
      layout.nodes.push({ ...frame, id: 'outer' });
      frame.parentId = 'outer';
    }
    if (constraint === 'unaccounted-member') {
      layout.nodes.push({ ...branch, id: 'orphan-member' });
    }
    if (constraint === 'invalid-endpoint') {
      edge.end = 'missing';
    }
    if (constraint === 'missing-size') {
      branch.width = undefined;
    }
    const before = JSON.stringify(layout);
    expect(arrangeTerminalFrameFan(layout)).toBe(false);
    expect(JSON.stringify(layout)).toBe(before);
  });

  it('rolls back the entire placement when unrelated content obstructs it', async () => {
    const layout = await measuredLayout('classic');
    runStressAndGridLayoutCore(layout);
    const entry = layout.nodes.find((node) => node.id === 'F')!;
    layout.nodes.push({ ...entry, id: 'obstacle', parentId: undefined });
    const before = JSON.stringify(layout);
    expect(arrangeTerminalFrameFan(layout)).toBe(false);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
