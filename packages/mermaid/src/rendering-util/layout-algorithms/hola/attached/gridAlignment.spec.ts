import { describe, expect, it } from 'vitest';
import type { LayoutData, Node } from '../../../types.js';
import { settleNearbyGridLines } from './gridAlignment.js';
import { resolveGridAttachedOptions } from './options.js';

function node(id: string, x: number, y: number, overrides: Partial<Node> = {}): Node {
  return { id, x, y, width: 80, height: 40, isGroup: false, ...overrides } as Node;
}

function layout(nodes: Node[]): LayoutData {
  return {
    nodes,
    edges: [],
    direction: 'TB',
    config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
  } as LayoutData;
}

describe('settling nearby grid lines', () => {
  it('aligns nearby rows while preserving an existing receiving column', () => {
    const data = layout([
      node('a', 0, 0),
      node('b', 150, 7),
      node('c', 300, -9),
      node('sink', 150, 140),
    ]);
    settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
    expect(data.nodes[0].y).toBeCloseTo(data.nodes[1].y!, 6);
    expect(data.nodes[2].y).toBeCloseTo(data.nodes[1].y!, 6);
    expect(data.nodes[1].x).toBe(data.nodes[3].x);
  });

  it('moves exact columns as units when their members have unequal dimensions', () => {
    const data = layout([
      node('a', 0, 0),
      node('b', 20, 140),
      node('small', 20, 240, { width: 2 }),
    ]);
    settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
    expect(data.nodes[1].x).toBe(data.nodes[2].x);
    expect(data.nodes[0].x).toBe(0);
  });

  it("uses an existing row when the average would reduce a neighbour's clearance", () => {
    const data = layout([node('a', 0, 0), node('b', 150, 8), node('next', 0, 91)]);
    settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
    expect(data.nodes[0].y).toBe(0);
    expect(data.nodes[1].y).toBe(0);
    expect(data.nodes[2].y).toBe(91);
  });

  it('keeps a nearby row offset when alignment would consume required node clearance', () => {
    const data = layout([
      node('a', 0, 0),
      node('b', 150, 8),
      node('above-a', 0, -72, { height: 2 }),
      node('below-a', 0, 72, { height: 2 }),
      node('above-b', 150, -64, { height: 2 }),
      node('below-b', 150, 80, { height: 2 }),
    ]);
    settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
    expect(data.nodes[0].y).toBe(0);
    expect(data.nodes[1].y).toBe(8);
  });

  it('keeps a frame clear of foreign nodes even when leaf boxes would not collide', () => {
    const data = layout([
      node('a', 0, 0, { parentId: 'group' }),
      node('b', 200, -10, { parentId: 'other-group' }),
      node('foreign', 0, -53, { width: 10, height: 10 }),
      node('other-foreign', 200, 27, { width: 10, height: 10 }),
      {
        id: 'other-group',
        isGroup: true,
        labelBBox: { x: 0, y: 0, width: 40, height: 16 },
      } as Node,
      { id: 'group', isGroup: true, labelBBox: { x: 0, y: 0, width: 40, height: 16 } } as Node,
    ]);
    settleNearbyGridLines(
      data,
      data,
      resolveGridAttachedOptions(data, { nodeSpacing: 0, rankSpacing: 0 })
    );
    expect(data.nodes[0].y).toBe(0);
    expect(data.nodes[1].y).toBe(-10);
    expect(data.nodes.find((node) => node.id === 'group')!.x).toBeUndefined();
  });
});

it('aligns a cross-group bundle by translating the smaller group rigidly', () => {
  const data = layout([
    node('a', 0, 0, { parentId: 'left' }),
    node('c', 0, 140, { parentId: 'left' }),
    node('e', -150, 140, { parentId: 'left' }),
    node('b', 300, 140, { parentId: 'right' }),
    node('d', 300, 280, { parentId: 'right' }),
    { id: 'left', isGroup: true } as Node,
    { id: 'right', isGroup: true } as Node,
  ]);
  data.direction = 'LR';
  data.edges = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `bundle-${index}`, start: 'a', end: 'b' })),
    { id: 'branch', start: 'c', end: 'b' },
  ] as LayoutData['edges'];
  settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
  expect(data.nodes[3].y).toBe(data.nodes[0].y);
  expect(data.nodes[4].y! - data.nodes[3].y!).toBe(140);
  expect(data.nodes[0].y).toBe(0);
  expect(data.nodes[1].y).toBe(140);
});

it('keeps group ranks when either alignment would consume foreign-node clearance', () => {
  const data = layout([
    node('a', 0, 0, { parentId: 'left' }),
    node('c', -150, 0, { parentId: 'left' }),
    node('e', -300, 0, { parentId: 'left' }),
    node('b', 300, 140, { parentId: 'right' }),
    node('d', 300, 280, { parentId: 'right' }),
    node('above', 300, 0),
    node('below', 0, 140),
    { id: 'left', isGroup: true } as Node,
    { id: 'right', isGroup: true } as Node,
  ]);
  data.direction = 'LR';
  data.edges = Array.from({ length: 5 }, (_, index) => ({
    id: `bundle-${index}`,
    start: 'a',
    end: 'b',
  })) as LayoutData['edges'];
  settleNearbyGridLines(data, data, resolveGridAttachedOptions(data));
  expect(data.nodes[0].y).toBe(0);
  expect(data.nodes[3].y).toBe(140);
});
