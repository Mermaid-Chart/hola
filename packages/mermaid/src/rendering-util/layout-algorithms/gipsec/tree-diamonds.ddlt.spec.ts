import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeCardinalDiamondFans, cardinalDiamondFanPorts } from './cardinalDiamondFan.js';

addDiagrams();

// Browser measurements captured before the cardinal terminal-fan fix. Both
// framed components have the same content sizes as the unframed component.
const measurements = {
  classic: {
    A: [95.015625, 54],
    B: [94.015625, 54],
    C: [115.75, 115.75],
    D: [121.140625, 54],
    E: [121.140625, 54],
    F: [141.96875, 54],
  },
  classicRedux: {
    A: [89.578125, 51],
    B: [86.046875, 51],
    C: [105.484375, 105.484375],
    D: [112.9375, 51],
    E: [112.9375, 51],
    F: [130.828125, 51],
  },
  neo: {
    A: [67.015625, 48],
    B: [94.015625, 54],
    C: [115.75, 115.75],
    D: [93.140625, 48],
    E: [93.140625, 48],
    F: [113.96875, 48],
  },
  neoRedux: {
    A: [61.578125, 45],
    B: [86.046875, 51],
    C: [105.484375, 105.484375],
    D: [84.9375, 45],
    E: [84.9375, 45],
    F: [102.828125, 45],
  },
  handDrawn: {
    A: [97.93311309814453, 56.814491271972656],
    B: [96.90704345703125, 55.62480926513672],
    C: [117.33011627197266, 117.05017852783203],
    D: [123.76592254638672, 57.48651123046875],
    E: [123.76592254638672, 57.48651123046875],
    F: [144.759796142578125, 57.301544189453125],
  },
  handDrawnRedux: {
    A: [92.21857452392578, 54.16190719604492],
    B: [88.52108001708984, 53.360679626464844],
    C: [107.06449127197266, 106.94708251953125],
    D: [115.55493927001953, 53.78736877441406],
    E: [115.55493927001953, 53.78736877441406],
    F: [133.01702880859375, 53.886505126953125],
  },
};
const contentIds: Record<string, keyof typeof measurements.classic> = {
  A: 'A',
  B: 'B',
  C: 'C',
  D: 'D',
  E: 'E',
  F: 'F',
  n1: 'C',
  n2: 'D',
  n3: 'E',
  n4: 'F',
  n5: 'C',
  n6: 'D',
  n7: 'E',
  n8: 'F',
};
const labels: Record<string, [number, number]> = {
  'Some text': [72.546875, 63.03125],
  One: [28.25, 26.46875],
  Two: [27.578125, 25.6875],
  Three: [41.703125, 36.578125],
};

async function measuredLayout(variant: keyof typeof measurements) {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/TREE diamonds.mmd'),
    { stampFlowchartRendererFields: true }
  );
  const redux = variant.endsWith('Redux');
  for (const node of layout.nodes) {
    if (node.isGroup) {
      node.labelBBox = { width: redux ? 109.75 : 128, height: redux ? 21 : 24 } as DOMRect;
    } else {
      expect(contentIds[node.id], `measurement for ${node.id}`).toBeDefined();
      [node.width, node.height] = measurements[variant][contentIds[node.id]];
    }
  }
  for (const edge of layout.edges) {
    if (edge.label) {
      expect(labels[edge.label], `measurement for ${edge.label}`).toBeDefined();
      edge.width = labels[edge.label][redux ? 1 : 0];
      edge.height = redux ? 21 : 24;
    }
  }
  return layout;
}

describe('stress-and-grid DDLT — three-way terminal diamond trees', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['LR', 'RL', 'TB', 'BT'].map((direction) => ({ variant, direction }))
  );
  it.each(cases)(
    'keeps all three components straight, symmetric, and label-safe with $variant in $direction',
    async ({ variant, direction }) => {
      const layout = await measuredLayout(variant);
      layout.direction = direction;
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
      const horizontal = direction === 'LR' || direction === 'RL';
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const alongSize = horizontal ? 'width' : 'height';
      const acrossSize = horizontal ? 'height' : 'width';
      const sign = direction === 'RL' || direction === 'BT' ? -1 : 1;
      for (const [source, before, forward, after] of [
        ['C', 'D', 'E', 'F'],
        ['n1', 'n2', 'n3', 'n4'],
        ['n5', 'n6', 'n7', 'n8'],
      ]) {
        const decision = node(source);
        expect(node(before)[along]).toBeCloseTo(decision[along]!, 6);
        expect(node(after)[along]).toBeCloseTo(decision[along]!, 6);
        expect(node(forward)[across]).toBeCloseTo(decision[across]!, 6);
        const firstFacing = node(before)[across]! + node(before)[acrossSize]! / 2;
        const lastFacing = node(after)[across]! - node(after)[acrossSize]! / 2;
        expect((firstFacing + lastFacing) / 2).toBeCloseTo(decision[across]!, 6);
        const edges = layout.edges.filter((edge) => edge.start === source);
        edges.forEach((edge, index) => {
          expect(edge.points).toHaveLength(2);
          const departure = edge.points![0];
          if (index === 1) {
            expect(departure[across]).toBeCloseTo(decision[across]!, 6);
            expect(departure[along] - decision[along]!).toBeCloseTo(
              (sign * decision[alongSize]!) / 2,
              6
            );
          } else {
            expect(departure[along]).toBeCloseTo(decision[along]!, 6);
            expect(departure[across] - decision[across]!).toBeCloseTo(
              ((index === 0 ? -1 : 1) * decision[acrossSize]!) / 2,
              6
            );
          }
        });
      }
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBe(0);
      expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
      for (const member of layout.nodes) {
        expect(member.parentId).toBe(parents.get(member.id));
      }
    }
  );

  it('uses topology rather than node IDs or specific branch labels', async () => {
    const layout = await measuredLayout('classic');
    const renamed = new Map(layout.nodes.map((node, index) => [node.id, `tree-node-${index}`]));
    for (const node of layout.nodes) {
      node.id = renamed.get(node.id)!;
      if (node.parentId) {
        node.parentId = renamed.get(node.parentId)!;
      }
    }
    for (const edge of layout.edges) {
      edge.start = renamed.get(edge.start!)!;
      edge.end = renamed.get(edge.end!)!;
      if (edge.label === 'One') {
        edge.label = 'Alternative';
        edge.width = 100;
      }
    }
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBe(0);
  });

  it('keeps fan geometry independent of the other disconnected components', async () => {
    const full = await measuredLayout('classic');
    const isolated = await measuredLayout('classic');
    isolated.nodes = isolated.nodes.filter((node) => !node.parentId && !node.isGroup);
    const ids = new Set(isolated.nodes.map((node) => node.id));
    isolated.edges = isolated.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
    runStressAndGridLayoutCore(full);
    runStressAndGridLayoutCore(isolated);
    const origin = full.nodes.find((node) => node.id === 'C')!;
    const isolatedOrigin = isolated.nodes.find((node) => node.id === 'C')!;
    for (const node of isolated.nodes) {
      const corresponding = full.nodes.find((candidate) => candidate.id === node.id)!;
      expect(node.x! - isolatedOrigin.x!).toBeCloseTo(corresponding.x! - origin.x!, 6);
      expect(node.y! - isolatedOrigin.y!).toBeCloseTo(corresponding.y! - origin.y!, 6);
    }
  });

  it.each([
    'start-port',
    'end-port',
    'minlen',
    'direction',
    'extra-incoming',
    'extra-outgoing',
    'reconverging',
    'invalid-endpoint',
    'missing-size',
  ])(
    'keeps constrained or non-private fans and their port policy unchanged (%s)',
    async (constraint) => {
      const layout = await measuredLayout('classic');
      layout.nodes = layout.nodes.filter((node) => !node.parentId && !node.isGroup);
      const ids = new Set(layout.nodes.map((node) => node.id));
      layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
      runStressAndGridLayoutCore(layout);
      const edge = layout.edges.find((candidate) => candidate.id === 'L_C_D_0')!;
      if (constraint === 'start-port') {
        edge.startSide = 'right';
      }
      if (constraint === 'end-port') {
        edge.endSide = 'left';
      }
      if (constraint === 'minlen') {
        edge.minlen = 2;
      }
      if (constraint === 'direction') {
        layout.nodes.find((node) => node.id === 'C')!.dir = 'TB';
      }
      if (constraint === 'extra-incoming') {
        layout.edges.push({ ...edge, id: 'extra', start: 'A', end: 'C' });
      }
      if (constraint === 'extra-outgoing') {
        layout.edges.push({ ...edge, id: 'extra', start: 'B', end: 'E' });
      }
      if (constraint === 'reconverging') {
        layout.edges.push({ ...edge, id: 'merge', start: 'D', end: 'F' });
      }
      if (constraint === 'invalid-endpoint') {
        edge.end = 'missing';
      }
      if (constraint === 'missing-size') {
        layout.nodes.find((node) => node.id === 'D')!.width = undefined;
      }
      const before = JSON.stringify(layout);
      expect(arrangeCardinalDiamondFans(layout)).toBe(false);
      expect(cardinalDiamondFanPorts(layout).size).toBe(0);
      expect(JSON.stringify(layout)).toBe(before);
    }
  );

  it.each(['nested', 'extra-member', 'frame-edge', 'frame-direction'])(
    'does not reshape a frame with additional ownership or constraints (%s)',
    async (constraint) => {
      const layout = await measuredLayout('classic');
      layout.nodes = layout.nodes.filter((node) => node.id === 's1' || node.parentId === 's1');
      const ids = new Set(layout.nodes.map((node) => node.id));
      layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
      runStressAndGridLayoutCore(layout);
      const frame = layout.nodes.find((node) => node.id === 's1')!;
      const source = layout.nodes.find((node) => node.id === 'n1')!;
      if (constraint === 'nested') {
        layout.nodes.push({ ...frame, id: 'outer' });
        frame.parentId = 'outer';
      }
      if (constraint === 'extra-member') {
        layout.nodes.push({ ...source, id: 'orphan-member' });
      }
      if (constraint === 'frame-edge') {
        layout.edges.push({
          ...layout.edges[0],
          id: 'frame-edge',
          start: frame.id,
          end: source.id,
        });
      }
      if (constraint === 'frame-direction') {
        frame.dir = 'TB';
      }
      const before = JSON.stringify(layout);
      expect(arrangeCardinalDiamondFans(layout)).toBe(false);
      expect(cardinalDiamondFanPorts(layout).size).toBe(0);
      expect(JSON.stringify(layout)).toBe(before);
    }
  );

  it('rolls back the whole fan if unrelated content blocks its new position', async () => {
    const layout = await measuredLayout('classic');
    layout.nodes = layout.nodes.filter((node) => !node.parentId && !node.isGroup);
    const ids = new Set(layout.nodes.map((node) => node.id));
    layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
    runStressAndGridLayoutCore(layout);
    const target = layout.nodes.find((node) => node.id === 'D')!;
    // Put the terminal away from the desired slot; the obstacle occupies that
    // slot. A partial move must not survive a rejected fan placement.
    layout.nodes.push({ ...target, id: 'obstacle' });
    target.x! += 500;
    const before = JSON.stringify(layout);
    expect(arrangeCardinalDiamondFans(layout)).toBe(false);
    expect(JSON.stringify(layout)).toBe(before);
  });
});
