import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import { separateBridgedGroupFrames } from './index.js';

function frame(id: string, x: number, y: number): Node {
  return {
    id,
    x,
    y,
    isGroup: true,
    width: 160,
    height: 136,
    labelBBox: { width: 80, height: 24 },
  } as Node;
}

function member(owner: Node): Node {
  return {
    id: `${owner.id}-member`,
    parentId: owner.id,
    isGroup: false,
    shape: 'rect',
    x: owner.x,
    y: owner.y! + 12,
    width: 80,
    height: 40,
  } as Node;
}

function bridge(start: string, end: string): Edge {
  return {
    id: `${start}-${end}`,
    start: `${start}-member`,
    end: `${end}-member`,
    type: 'arrow',
    label: '',
    width: 0,
    height: 0,
  } as Edge;
}

function layout(edges: Edge[], x = 0, y = 200): LayoutData {
  const upper = frame('upper', 0, 0),
    lower = frame('lower', x, y);
  return {
    config: {},
    direction: 'LR',
    nodes: [upper, lower, member(upper), member(lower)],
    edges,
  };
}

describe('settled frame bridge safety', () => {
  it('does not reorder already separated frames for a return connection', () => {
    const data = layout([bridge('lower', 'upper')], 0, 300);
    const before = structuredClone(data);
    separateBridgedGroupFrames(data);
    expect(data).toStrictEqual(before);
  });

  it.each([false, true])('separates a reciprocal pair only once (reverse order: %s)', (reverse) => {
    const edges = [bridge('upper', 'lower'), bridge('lower', 'upper')];
    const data = layout(reverse ? edges.reverse() : edges);
    separateBridgedGroupFrames(data);
    expect(data.nodes[0].y).toBe(0);
    expect(data.nodes[1].y).toBe(232);
    expect(data.nodes[3].y).toBe(244);
  });

  it('leaves a predominantly horizontal frame pair on its existing axis', () => {
    const data = layout([bridge('upper', 'lower')], 110, 30);
    const before = structuredClone(data);
    separateBridgedGroupFrames(data);
    expect(data).toStrictEqual(before);
  });

  it('rejects a bridge move that takes clearance from an unrelated frame', () => {
    const data = layout([bridge('upper', 'lower')]);
    const blocker = frame('unrelated', 0, 370);
    data.nodes.push(blocker, member(blocker));
    const before = structuredClone(data);
    separateBridgedGroupFrames(data);
    expect(data).toStrictEqual(before);
  });

  it.each([
    { startSide: 'right' },
    { endSide: 'left' },
    { minlen: 2 },
    { isLayoutOnly: true },
  ] as Partial<Edge>[])('does not replace explicit routing constraints: %j', (constraint) => {
    const data = layout([{ ...bridge('upper', 'lower'), ...constraint }]);
    const before = structuredClone(data);
    separateBridgedGroupFrames(data);
    expect(data).toStrictEqual(before);
  });
});
