import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import { arrangeCardinalDiamondFans, cardinalDiamondFanPorts } from './cardinalDiamondFan.js';
import { alignSiblingFrameRows, arrangeExternalSiblingFrameCycles } from './frameGrid.js';
import { arrangeTerminalFrameFan } from './terminalFrameFan.js';

// Tiny fixtures exercise individual pure helpers. Parser-produced DDLT and
// browser tests separately cover the complete production pipeline.
function node(id: string, x = 0, y = 0, parentId?: string, isGroup = false): Node {
  return { id, x, y, parentId, isGroup, shape: 'rect', width: 80, height: 40 } as Node;
}

function edge(start: string, end: string): Edge {
  return {
    id: `${start}-${end}`,
    start,
    end,
    type: 'arrow',
    label: '',
    width: 0,
    height: 0,
  } as Edge;
}

function cardinal(): LayoutData {
  return {
    direction: 'LR',
    config: {},
    nodes: [
      { ...node('source'), shape: 'diamond' } as Node,
      node('first', 1000, 1000),
      node('second', 1100, 1100),
      node('third', 1200, 1200),
    ],
    edges: ['first', 'second', 'third'].map((id) => edge('source', id)),
  };
}

function terminal(): LayoutData {
  return {
    direction: 'TB',
    config: {},
    nodes: [
      { ...node('frame', 500, 500, undefined, true), width: 400, height: 400 },
      { ...node('decision'), shape: 'diamond' } as Node,
      node('entry', 400, 400, 'frame'),
      node('fork', 500, 600, 'frame'),
      node('first', 1000, 1000, 'frame'),
      node('second', 1100, 1100, 'frame'),
    ],
    edges: [
      edge('decision', 'entry'),
      edge('entry', 'fork'),
      edge('fork', 'first'),
      edge('fork', 'second'),
    ],
  };
}

function rows(): LayoutData {
  return {
    config: {},
    nodes: [0, 1, 2].map((index) => ({
      ...node(`frame${index}`, 80 + index * 320, 100 + index * 10, undefined, true),
      width: 160,
      height: 160,
    })),
    edges: [],
  };
}

function cycle(): LayoutData {
  return {
    config: {},
    nodes: [
      { ...node('outer', 250, 200, undefined, true), width: 700, height: 300 },
      { ...node('left', 0, 200, 'outer', true), width: 160, height: 160 },
      { ...node('right', 500, 200, 'outer', true), width: 160, height: 160 },
      node('outside', 900, 0),
    ],
    edges: [edge('left', 'outside'), edge('outside', 'right'), edge('right', 'left')],
  };
}

const passes = [
  {
    name: 'cardinal diamond fan',
    build: cardinal,
    run: arrangeCardinalDiamondFans,
    locked: 'second',
  },
  { name: 'terminal frame fan', build: terminal, run: arrangeTerminalFrameFan, locked: 'second' },
  { name: 'sibling frame row', build: rows, run: alignSiblingFrameRows, locked: 'frame1' },
  {
    name: 'external sibling frame cycle',
    build: cycle,
    run: arrangeExternalSiblingFrameCycles,
    locked: 'outside',
  },
];

describe('shared rollback contract for local placement passes', () => {
  it.each(passes)('still accepts a valid $name proposal', ({ build, run }) => {
    const data = build();
    const before = structuredClone(data.nodes);
    run(data);
    expect(data.nodes).not.toStrictEqual(before);
    expect(
      data.nodes.every((member) =>
        [member.x, member.y, member.width, member.height].every(Number.isFinite)
      )
    ).toBe(true);
  });

  it.each(passes)(
    'restores $name geometry before propagating a write failure',
    ({ build, run, locked }) => {
      const data = build();
      // The terminal decision moves after its frame has already been refitted.
      const targetId = build === terminal ? 'decision' : locked;
      const target = data.nodes.find((member) => member.id === targetId)!;
      // Fail on a later write, after x or other members have already moved.
      Object.defineProperty(target, 'y', { writable: false });
      const before = data.nodes.map((member) => Object.getOwnPropertyDescriptors(member));
      const nodes = [...data.nodes];
      const edges = structuredClone(data.edges);
      expect(() => run(data)).toThrow(TypeError);
      expect(data.nodes.map((member) => Object.getOwnPropertyDescriptors(member))).toStrictEqual(
        before
      );
      data.nodes.forEach((member, index) => expect(member).toBe(nodes[index]));
      expect(data.edges).toStrictEqual(edges);
    }
  );

  it.each(passes)(
    'rejects non-finite $name coordinates without moving the other participants',
    ({ build, run, locked }) => {
      const data = build();
      data.nodes.find((member) => member.id === locked)!.x = NaN;
      const before = structuredClone(data);
      run(data);
      expect(data).toStrictEqual(before);
    }
  );

  it.each(passes)(
    'rejects an invalid $name title measurement without changing geometry',
    ({ build, run, locked }) => {
      const data = build();
      data.nodes.find((member) => member.id === locked)!.labelBBox = {
        width: Infinity,
        height: 24,
      } as DOMRect;
      const before = structuredClone(data);
      run(data);
      expect(data).toStrictEqual(before);
    }
  );
});

describe('shared measured fan admission', () => {
  const fans = [
    { name: 'cardinal', build: cardinal, run: arrangeCardinalDiamondFans },
    { name: 'terminal', build: terminal, run: arrangeTerminalFrameFan },
  ];

  it.each(
    fans.flatMap((fan) =>
      (['width', 'height'] as const).flatMap((size) =>
        [NaN, Infinity, -1].map((measurement) => ({ ...fan, size, measurement }))
      )
    )
  )('rejects $name caption $size $measurement atomically', ({ build, run, size, measurement }) => {
    const data = build();
    data.edges[0].label = 'Measured caption';
    data.edges[0][size] = measurement;
    const before = structuredClone(data);
    expect(run(data)).toBe(false);
    expect(data).toStrictEqual(before);
    if (build === cardinal) {
      expect(cardinalDiamondFanPorts(data).size).toBe(0);
    }
  });
});
