import { describe, expect, it, vi } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import * as captionGeometry from './captionGeometry.js';
import { arrangeNestedFrameEntry, nestedFrameEntryRoutes } from './nestedFrameEntry.js';
import { routeStressAndGridEdges } from './routing.js';

function rows(outerLength = 2, innerLength = 2): LayoutData {
  const frame = (id: string, parentId?: string): Node =>
    ({
      id,
      parentId,
      isGroup: true,
      x: 100,
      y: 100,
      width: 400,
      height: 400,
      labelBBox: { width: 60, height: 24 },
    }) as Node;
  const members = (length: number, parentId: string, prefix: string, y: number): Node[] =>
    Array.from({ length }, (_, index) => ({
      id: `${prefix}${index}`,
      parentId,
      isGroup: false,
      shape: 'rect',
      x: index * 160,
      y,
      width: 80,
      height: 40,
    })) as Node[];
  const outer = members(outerLength, 'outer', 'source', 0);
  const inner = members(innerLength, 'inner', 'target', 200);
  const link = (start: string, end: string, label = ''): Edge =>
    ({ id: `${start}-${end}`, start, end, label, width: 64, height: 24, type: 'arrow' }) as Edge;
  return {
    direction: 'LR',
    config: {},
    nodes: [frame('outer'), frame('inner', 'outer'), ...outer, ...inner],
    edges: [
      ...outer.slice(1).map((node, index) => link(outer[index].id, node.id)),
      ...inner.slice(1).map((node, index) => link(inner[index].id, node.id)),
      link(outer[0].id, inner[0].id, 'entry'),
      link(outer.at(-1)!.id, 'inner', 'frame'),
    ],
  };
}

describe('local nested-frame entry constraints', () => {
  it('restores geometry before propagating a failed proposal calculation', () => {
    const data = rows(3, 3);
    const before = structuredClone(data);
    const source = data.nodes.find((node) => node.id === 'source1')!;
    const initialX = source.x;
    const original = captionGeometry.captionDimensions;
    const failure = new Error('caption calculation failed after placement');
    const spy = vi.spyOn(captionGeometry, 'captionDimensions').mockImplementation((...args) => {
      if (source.x !== initialX) {
        throw failure;
      }
      return original(...args);
    });
    try {
      expect(() => arrangeNestedFrameEntry(data)).toThrow(failure);
      expect(data).toStrictEqual(before);
    } finally {
      spy.mockRestore();
    }
  });

  it.each(['LR', 'RL', 'TB', 'BT'])('aligns arbitrary-length chains in %s', (direction) => {
    const data = rows(4, 3);
    data.direction = direction;
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(nestedFrameEntryRoutes(data).size).toBe(data.edges.length);
    routeStressAndGridEdges(data, 180);
    expect(data.edges.every((edge) => edge.points?.length === 2)).toBe(true);
    expect(validateLayout(data).ok).toBe(true);
    expect(validateLayout(data).breakdown.crossings).toBe(0);
  });

  it.each(['outer', 'inner'])('allows an additional unrelated child in %s', (parentId) => {
    const data = rows();
    data.nodes.push({
      ...data.nodes.find((node) => node.id === 'target0')!,
      id: 'extra',
      parentId,
      x: -400,
      y: 200,
    });
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(nestedFrameEntryRoutes(data).size).toBe(4);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('reserves captions on internal chain edges, not only entry edges', () => {
    const data = rows(3, 4);
    for (const edge of data.edges) {
      edge.label = 'Long caption<br/>on two lines';
      edge.width = 240;
      edge.height = 48;
    }
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    const result = validateLayout(data);
    expect(result.ok).toBe(true);
    expect(result.issues.filter((issue) => issue.type.startsWith('edge-label'))).toEqual([]);
    expect(result.breakdown.crossings).toBe(0);
  });

  it('supports rounded rectangular members', () => {
    const data = rows(3, 3);
    for (const node of data.nodes.filter((node) => !node.isGroup)) {
      node.shape = 'roundedRect';
    }
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('works inside an ancestor and keeps all children contained', () => {
    const data = rows(3, 3);
    const outer = data.nodes.find((node) => node.id === 'outer')!;
    data.nodes.push({ ...outer, id: 'ancestor', parentId: undefined });
    outer.parentId = 'ancestor';
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('finds a free row around an unrelated child without moving it', () => {
    const data = rows();
    const extra = {
      ...data.nodes.find((node) => node.id === 'source0')!,
      id: 'extra',
      x: 80,
      y: 140,
    };
    data.nodes.push(extra);
    const before = { ...extra };
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(extra).toEqual(before);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('aligns from the earliest source row instead of expanding into a sibling frame', () => {
    const data = rows();
    const outer = data.nodes.find((node) => node.id === 'outer')!;
    data.nodes.find((node) => node.id === 'source0')!.y = 600;
    const ancestor = { ...outer, id: 'ancestor', parentId: undefined };
    const sibling = { ...outer, id: 'sibling', parentId: 'ancestor', x: 80, y: 900 };
    data.nodes.push(ancestor, sibling, {
      ...data.nodes.find((node) => node.id === 'source1')!,
      id: 'sibling-child',
      parentId: 'sibling',
      x: 80,
      y: 900,
    });
    outer.parentId = ancestor.id;
    const before = { ...sibling };
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(sibling).toEqual(before);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('reserves a title-free port when an unrelated child centers the title on an entry', () => {
    const data = rows();
    data.nodes.find((node) => node.id === 'inner')!.labelBBox = { width: 160, height: 24 };
    data.nodes.push({
      ...data.nodes.find((node) => node.id === 'target0')!,
      id: 'extra',
      x: 220,
      y: 200,
    });
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    expect(data.edges.every((edge) => edge.points?.length === 2)).toBe(true);
    expect(validateLayout(data).ok).toBe(true);
  });

  it.each([NaN, Infinity, -10])('rejects invalid frame title measurements: %s', (width) => {
    const data = rows();
    data.nodes.find((node) => node.id === 'inner')!.labelBBox = { width, height: 24 };
    const before = structuredClone(data);
    expect(arrangeNestedFrameEntry(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('is idempotent and derives ports after translation', () => {
    const data = rows(3, 3);
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    const before = structuredClone(data);
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(data).toEqual(before);
    const routes = nestedFrameEntryRoutes(data);
    for (const node of data.nodes) {
      node.x! += 300;
      node.y! += 180;
    }
    for (const [id, route] of routes) {
      expect(nestedFrameEntryRoutes(data).get(id)?.points).toEqual(
        route.points.map((point) => ({ x: point.x + 300, y: point.y + 180 }))
      );
    }
  });

  it('reserves planned measured captions before shorter unrelated edges', () => {
    const data = rows();
    const entry = data.edges.find((edge) => edge.end === 'target0')!;
    entry.width = 320;
    entry.height = 400;
    const frameEntry = data.edges.find((edge) => edge.end === 'inner')!;
    frameEntry.label = '';
    frameEntry.width = 0;
    frameEntry.height = 0;
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    const caption = nestedFrameEntryRoutes(data).get(entry.id)!.labelPoint!;
    const member = data.nodes.find((node) => node.id === 'source0')!;
    data.nodes.push(
      { ...member, id: 'foreign-start', x: -220, y: caption.y, width: 40 },
      { ...member, id: 'foreign-end', x: 220, y: caption.y, width: 40 }
    );
    data.nodes.find((node) => node.id === 'outer')!.width! += 240;
    data.edges.unshift({
      ...entry,
      id: 'foreign',
      start: 'foreign-start',
      end: 'foreign-end',
      label: '',
      width: 0,
      height: 0,
    });
    expect(nestedFrameEntryRoutes(data).has(entry.id)).toBe(true);
    routeStressAndGridEdges(data, 180);
    expect(
      validateLayout(data).issues.filter((issue) => issue.type.startsWith('edge-label'))
    ).toEqual([]);
  });

  it('keeps earlier caption reservations when another nested entry refits the same ancestor', () => {
    const data = rows();
    data.edges.find((edge) => edge.end === 'target0')!.width = 700;
    const other = rows();
    for (const node of other.nodes.filter((node) => node.id !== 'outer')) {
      node.id = `other-${node.id}`;
      node.parentId = node.parentId === 'outer' ? 'outer' : `other-${node.parentId}`;
      node.x! += 1200;
      data.nodes.push(node);
    }
    for (const edge of other.edges) {
      edge.id = `other-${edge.id}`;
      edge.start = `other-${edge.start}`;
      edge.end = `other-${edge.end}`;
      data.edges.push(edge);
    }
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(nestedFrameEntryRoutes(data).size).toBe(8);
    routeStressAndGridEdges(data, 180);
    expect(
      validateLayout(data).issues.filter((issue) => issue.type.startsWith('edge-label'))
    ).toEqual([]);
    expect(validateLayout(data).ok).toBe(true);
  });

  it('separates wide captions from the routes of another local pattern', () => {
    const data = rows();
    data.edges.find((edge) => edge.end === 'target0')!.width = 1000;
    const other = rows();
    other.edges.find((edge) => edge.end === 'target0')!.width = 1000;
    for (const node of other.nodes.filter((node) => node.id !== 'outer')) {
      node.id = `other-${node.id}`;
      node.parentId = node.parentId === 'outer' ? 'outer' : `other-${node.parentId}`;
      node.x! += 1000;
      data.nodes.push(node);
    }
    for (const edge of other.edges) {
      edge.id = `other-${edge.id}`;
      edge.start = `other-${edge.start}`;
      edge.end = `other-${edge.end}`;
      data.edges.push(edge);
    }
    expect(arrangeNestedFrameEntry(data)).toBe(true);
    expect(nestedFrameEntryRoutes(data).size).toBe(8);
    routeStressAndGridEdges(data, 180);
    expect(validateLayout(data).ok).toBe(true);
    expect(validateLayout(data).breakdown.crossings).toBe(0);
  });

  it.each(['startSide', 'endSide', 'minlen', 'dir', 'parallel', 'contradictory columns'])(
    'rejects an unsafe local adjustment atomically: %s',
    (constraint) => {
      const data = rows(3, 3);
      const tail = data.edges.find((edge) => edge.end === 'source2')!;
      if (constraint === 'startSide' || constraint === 'endSide') {
        tail[constraint] = 'left';
      } else if (constraint === 'minlen') {
        tail.minlen = 3;
      } else if (constraint === 'dir') {
        data.nodes.find((node) => node.id === 'source2')!.dir = 'TB';
      } else if (constraint === 'parallel') {
        data.edges.push({ ...tail, id: 'parallel' });
      } else {
        data.edges.push({
          ...tail,
          id: 'contradictory',
          start: 'source2',
          end: 'target0',
        });
      }
      const before = structuredClone(data);
      expect(arrangeNestedFrameEntry(data)).toBe(false);
      expect(data).toEqual(before);
      expect(nestedFrameEntryRoutes(data).size).toBe(0);
    }
  );
});
