import { describe, expect, it, vi } from 'vitest';
import type { LayoutData, Node } from '../../types.js';
import * as projection from '../layout-utils/ipsep-cola/solver/project.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { separateSettledFrameBoxes } from './index.js';

// Pure packing-helper fixtures; the real parser/renderer pipeline is exercised
// separately by verbose-nodes-within-subgraphs.ddlt.spec.ts and browser tests.
function frame(id: string, x: number, y = 0, parentId?: string): Node {
  return {
    id,
    x,
    y,
    parentId,
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

function layout(...frames: Node[]): LayoutData {
  return { config: {}, nodes: frames.flatMap((owner) => [owner, member(owner)]), edges: [] };
}

function expectClear(data: LayoutData): void {
  expect(
    validateLayout(data).issues.filter((issue) =>
      [
        'node-overlap',
        'node-too-close-to-group',
        'group-group-padding',
        'group-inside-group-padding',
        'node-outside-group',
      ].includes(issue.type)
    )
  ).toEqual([]);
}

describe('final fitted frame box separation', () => {
  it.each(['x', 'y'] as const)('repairs fitted overlaps on %s with rigid subtree moves', (axis) => {
    const data =
      axis === 'x'
        ? layout(frame('a', 0), frame('b', 130))
        : layout(frame('a', 0), frame('b', 0, 110));
    const before = structuredClone(data);
    separateSettledFrameBoxes(data);
    expectClear(data);
    for (const owner of data.nodes.filter((node) => node.isGroup)) {
      const child = data.nodes.find((node) => node.parentId === owner.id)!;
      const previous = before.nodes.find((node) => node.id === owner.id)!;
      const previousChild = before.nodes.find((node) => node.id === child.id)!;
      expect(child.x! - owner.x!).toBe(previousChild.x! - previous.x!);
      expect(child.y! - owner.y!).toBe(previousChild.y! - previous.y!);
      expect(owner.width).toBe(previous.width);
      expect(owner.height).toBe(previous.height);
    }
  });

  it('resolves collisions created by separating another pair', () => {
    const data = layout(frame('a', 0), frame('b', 130), frame('c', 300));
    separateSettledFrameBoxes(data);
    expectClear(data);
    expect(data.nodes.filter((node) => node.isGroup).map((node) => node.y)).toEqual([0, 0, 0]);
  });

  it('reserves leaf-to-frame clearance without moving the leaf into a container', () => {
    const data = layout(frame('a', 0));
    data.nodes.push({ ...member(data.nodes[0]), id: 'outside', parentId: undefined, x: 130 });
    separateSettledFrameBoxes(data);
    expectClear(data);
    expect(data.nodes.at(-1)!.parentId).toBeUndefined();
  });

  it.each([10, 60])('honours configured node-to-frame clearance: %s', (clearance) => {
    const data = layout(frame('a', 0));
    data.nodes.push({ ...member(data.nodes[0]), id: 'outside', parentId: undefined, x: 155 });
    Object.assign(data.config, { flowchart: { nodeGroupClearance: clearance } });
    const before = structuredClone(data);
    separateSettledFrameBoxes(data);
    expectClear(data);
    if (clearance === 10) {
      expect(data).toStrictEqual(before);
    }
  });

  it.each(['x', 'y'] as const)('leaves a valid labelled entry corridor untouched on %s', (axis) => {
    const owner = frame('target', 0);
    const source = {
      ...member(owner),
      id: 'source',
      parentId: undefined,
      x: 0,
      y: -140,
    };
    const outside = { ...source, id: 'outside', y: 118 };
    const data = layout(owner);
    data.nodes.push(source, outside);
    data.edges.push({
      id: 'entry',
      start: source.id,
      end: data.nodes[1].id,
      label: 'caption',
      width: 64,
      height: 24,
    });
    if (axis === 'x') {
      for (const node of data.nodes) {
        [node.x, node.y] = [node.y, node.x];
        [node.width, node.height] = [node.height, node.width];
      }
    }
    const corridor = owner[axis]! - source[axis];
    const before = structuredClone(data);
    separateSettledFrameBoxes(data);
    expectClear(data);
    expect(owner[axis]! - source[axis]).toBeGreaterThanOrEqual(corridor - 1e-6);
    expect(data).toStrictEqual(before);
  });

  it('grows ancestors around moved children before separating outer siblings', () => {
    const outer = { ...frame('outer', 0), width: 350, height: 280 };
    const data = layout(
      frame('a', -30, 12, outer.id),
      frame('b', 100, 12, outer.id),
      frame('outside', 290)
    );
    data.nodes.unshift(outer);
    const title = outer.labelBBox;
    const childIds = data.nodes.map((node) => [node.id, node.parentId]);
    separateSettledFrameBoxes(data);
    expectClear(data);
    expect(outer.width).toBeGreaterThanOrEqual(350);
    expect(outer.height).toBeGreaterThanOrEqual(280);
    expect(outer.labelBBox).toBe(title);
    expect(data.nodes.map((node) => [node.id, node.parentId])).toEqual(childIds);
  });

  it('is idempotent and leaves already clear geometry untouched', () => {
    const data = layout(frame('a', 0), frame('b', 130));
    separateSettledFrameBoxes(data);
    const settled = structuredClone(data);
    separateSettledFrameBoxes(data);
    expect(data).toStrictEqual(settled);
    const clear = layout(frame('a', 0), frame('b', 300));
    const before = structuredClone(clear);
    separateSettledFrameBoxes(clear);
    expect(clear).toStrictEqual(before);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 0])(
    'rejects invalid measurements: %s',
    (width) => {
      const data = layout(frame('a', 0), frame('b', 130));
      data.nodes[0].width = width;
      const before = structuredClone(data);
      separateSettledFrameBoxes(data);
      expect(data).toStrictEqual(before);
    }
  );

  it.each(['missing', 'cycle'])('rejects malformed parent chains: %s', (kind) => {
    const data = layout(frame('a', 0), frame('b', 130));
    data.nodes[0].parentId = kind === 'missing' ? 'unknown' : 'b';
    if (kind === 'cycle') {
      data.nodes[2].parentId = 'a';
    }
    const before = structuredClone(data);
    separateSettledFrameBoxes(data);
    expect(data).toStrictEqual(before);
  });

  it('restores geometry and identities if projection throws', () => {
    const data = layout(frame('a', 0), frame('b', 130));
    const identities = [...data.nodes];
    const before = structuredClone(data);
    const failure = new Error('projection failed');
    const mock = vi.spyOn(projection, 'project').mockImplementationOnce(() => {
      throw failure;
    });
    try {
      expect(() => separateSettledFrameBoxes(data)).toThrow(failure);
      expect(data).toStrictEqual(before);
      data.nodes.forEach((node, index) => expect(node).toBe(identities[index]));
    } finally {
      mock.mockRestore();
    }
  });
});
