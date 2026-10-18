import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import {
  alignHorizontallyBridgedSiblingFrames,
  alignPrivateParallelFrameBridge,
  arrangePrivateSiblingFrameConvergences,
} from './index.js';

// These small fixtures exercise pure placement helpers, not a substitute
// layout pipeline. Parser-driven DDLT and browser tests cover orchestration.
function node(id: string, x: number, y: number, parentId?: string): Node {
  return { id, x, y, parentId, isGroup: false, shape: 'rect', width: 80, height: 40 } as Node;
}

function frame(id: string, x: number, y: number, parentId?: string): Node {
  return {
    ...node(id, x, y, parentId),
    isGroup: true,
    width: 160,
    height: 136,
    labelBBox: { width: 80, height: 24 },
  } as Node;
}

function edge(id: string, start: string, end: string): Edge {
  return { id, start, end, type: 'arrow', label: '', width: 0, height: 0 } as Edge;
}

function convergence(framedTarget = false): LayoutData {
  return {
    config: {},
    nodes: [
      { ...frame('outer', 0, 0), width: 900, height: 600 },
      { ...frame('parent', 0, 0, 'outer'), width: 700, height: 400 },
      framedTarget ? frame('target', 0, 0, 'parent') : node('target', 0, 0, 'parent'),
      frame('left', -300, 70, 'parent'),
      node('left-member', -300, 82, 'left'),
      frame('right', 300, 90, 'parent'),
      node('right-member', 300, 102, 'right'),
      ...(framedTarget ? [node('target-member', 0, 12, 'target')] : []),
      frame('unrelated', 4000, 0),
      node('unrelated-member', 4000, 12, 'unrelated'),
    ],
    edges: [
      { ...edge('left-target', 'left', 'target'), label: 'Feed A', width: 48, height: 24 },
      { ...edge('right-target', 'right', 'target'), label: 'Feed B', width: 48, height: 24 },
    ],
  };
}

function parallelBridge(): LayoutData {
  return {
    config: {},
    nodes: [
      { ...frame('outer', 0, 200), width: 1200, height: 900 },
      { ...frame('parent', 0, 200, 'outer'), width: 900, height: 700 },
      frame('left', -200, 0, 'parent'),
      node('left-member', -250, 100, 'left'),
      node('left-note', -150, 150, 'left'),
      frame('right', 250, 400, 'parent'),
      node('right-member', 200, 350, 'right'),
      node('right-note', 300, 450, 'right'),
      node('outsider', 2000, 2000),
    ],
    edges: [
      edge('bridge-0', 'left-member', 'right-member'),
      edge('bridge-1', 'left-member', 'right-member'),
    ],
  };
}

function horizontalBridge(): LayoutData {
  return {
    config: {},
    nodes: [
      { ...frame('outer', 250, 300), width: 1200, height: 900 },
      { ...frame('parent', 250, 300, 'outer'), width: 900, height: 700 },
      frame('left', 0, 100, 'parent'),
      node('left-member', 0, 112, 'left'),
      frame('right', 500, 300, 'parent'),
      node('right-member', 500, 312, 'right'),
      frame('inner', 500, 320, 'right'),
      node('inner-member', 510, 322, 'inner'),
      node('outsider', 2000, 2000),
    ],
    edges: [edge('bridge', 'left-member', 'right-member')],
  };
}

const byId = (data: LayoutData) => new Map(data.nodes.map((member) => [member.id, member]));
const passes = [
  {
    name: 'leaf convergence',
    build: () => convergence(),
    run: (data: LayoutData) => arrangePrivateSiblingFrameConvergences(data, byId(data)),
    movedMember: 'right-member',
  },
  {
    name: 'framed convergence',
    build: () => convergence(true),
    run: (data: LayoutData) => arrangePrivateSiblingFrameConvergences(data, byId(data)),
    movedMember: 'right-member',
  },
  {
    name: 'parallel frame bridge',
    build: parallelBridge,
    run: (data: LayoutData) => {
      const nodes = byId(data);
      alignPrivateParallelFrameBridge(
        nodes.get('left')!,
        nodes.get('right')!,
        nodes.get('left-member')!,
        nodes.get('right-member')!,
        data,
        nodes
      );
    },
    movedMember: 'right-member',
  },
  {
    name: 'horizontal sibling bridge',
    build: horizontalBridge,
    run: alignHorizontallyBridgedSiblingFrames,
    movedMember: 'inner-member',
  },
];

describe('compound frame proposal rollback', () => {
  it.each(passes)(
    'accepts valid $name geometry without changing containment or edges',
    ({ build, run }) => {
      const data = build();
      const before = structuredClone(data.nodes);
      const edges = structuredClone(data.edges);
      run(data);
      expect(data.nodes).not.toStrictEqual(before);
      data.nodes.forEach((member, index) => expect(member.parentId).toBe(before[index].parentId));
      expect(data.edges).toStrictEqual(edges);
    }
  );

  it.each(
    passes.flatMap((pass) => ['translation', 'ancestor-refit'].map((phase) => ({ ...pass, phase })))
  )(
    'restores all $name geometry after a $phase write exception',
    ({ build, run, movedMember, phase }) => {
      const data = build();
      const target = byId(data).get(phase === 'translation' ? movedMember : 'outer')!;
      Object.defineProperty(target, phase === 'translation' ? 'y' : 'height', { writable: false });
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

  it.each(passes)('rejects a damaged $name subtree atomically', ({ build, run, movedMember }) => {
    const data = build();
    byId(data).get(movedMember)!.x = NaN;
    const before = structuredClone(data);
    run(data);
    expect(data).toStrictEqual(before);
  });

  it.each(passes)(
    'rejects an invalid $name ancestor title without partial changes',
    ({ build, run }) => {
      const data = build();
      byId(data).get('parent')!.labelBBox = { width: 80, height: Infinity } as DOMRect;
      const before = structuredClone(data);
      run(data);
      expect(data).toStrictEqual(before);
    }
  );

  it.each(
    passes.flatMap((pass) =>
      (['width', 'height'] as const).flatMap((size) =>
        [NaN, Infinity, -1].map((measurement) => ({ ...pass, size, measurement }))
      )
    )
  )(
    'rejects $name edge $size $measurement without changing geometry',
    ({ build, run, size, measurement }) => {
      const data = build();
      data.edges[0][size] = measurement;
      const before = structuredClone(data);
      run(data);
      expect(data).toStrictEqual(before);
    }
  );

  it.each(passes)(
    'rolls back $name when every proposed position is blocked',
    ({ name, build, run, movedMember }) => {
      const proposed = build();
      run(proposed);
      const data = build();
      if (name.endsWith('convergence')) {
        const root = byId(proposed).get('outer')!;
        // Only the centre is initially blocking. Four other leaves occupy the
        // axis-only escape candidates, so no partial refit or shift can commit.
        const dx = root.width! / 2 + 80 / 2 + 36;
        const dy = root.height! / 2 + 40 / 2 + 36;
        data.nodes.push(
          ...[
            [0, 0],
            [dx, 0],
            [-dx, 0],
            [0, dy],
            [0, -dy],
          ].map(([x, y], index) => node(`blocker-${index}`, root.x! + x, root.y! + y))
        );
      } else {
        const member = byId(proposed).get(movedMember)!;
        data.nodes.push(node('blocker', member.x!, member.y!));
      }
      const before = structuredClone(data);
      run(data);
      expect(data).toStrictEqual(before);
    }
  );

  it.each([
    { startSide: 'right' },
    { endSide: 'left' },
    { minlen: 2 },
    { isLayoutOnly: true },
  ] as Partial<Edge>[])(
    'keeps horizontal sibling alignment independent of fan-only exclusions: %j',
    (constraint) => {
      const expected = horizontalBridge();
      alignHorizontallyBridgedSiblingFrames(expected);
      const data = horizontalBridge();
      Object.assign(data.edges[0], constraint);
      const before = structuredClone(data.edges);
      alignHorizontallyBridgedSiblingFrames(data);
      expect(data.nodes).toStrictEqual(expected.nodes);
      expect(data.edges).toStrictEqual(before);
    }
  );
});
