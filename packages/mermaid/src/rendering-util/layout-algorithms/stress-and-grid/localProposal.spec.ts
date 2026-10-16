import { describe, expect, it, vi } from 'vitest';
import type { Edge, Node } from '../../types.js';
import {
  acceptLocalGeometryProposal,
  constrainedLocalEdge,
  measuredLocalEdge,
  measuredLocalNode,
} from './localProposal.js';

function measuredNode(id = 'node'): Node {
  return { id, x: 0, y: 0, width: 80, height: 40 } as Node;
}

describe('local geometry proposal transaction', () => {
  it('commits accepted geometry on the original objects without touching metadata', () => {
    const node = measuredNode();
    const title = { width: 40, height: 24 };
    node.labelBBox = title;
    node.parentId = 'frame';
    expect(
      acceptLocalGeometryProposal([node, node], () => {
        Object.assign(node, { x: 100, y: 200, width: 120 });
        return true;
      })
    ).toBe(true);
    expect(node).toMatchObject({ x: 100, y: 200, width: 120, height: 40, parentId: 'frame' });
    expect(node.labelBBox).toBe(title);
  });

  it.each(['reject', 'throw'] as const)(
    'restores moved nodes and refitted frames on %s',
    (kind) => {
      const node = measuredNode();
      const frame = measuredNode('frame');
      frame.isGroup = true;
      const before = structuredClone([node, frame]);
      const failure = new Error('proposal failed');
      const apply = () =>
        acceptLocalGeometryProposal([node, frame], () => {
          node.x = 100;
          frame.width = 500;
          if (kind === 'throw') {
            throw failure;
          }
          return false;
        });
      if (kind === 'throw') {
        expect(apply).toThrow(failure);
      } else {
        expect(apply()).toBe(false);
      }
      expect([node, frame]).toStrictEqual(before);
    }
  );

  it('restores inherited geometry and property descriptors exactly', () => {
    const node = Object.create(measuredNode()) as Node;
    Object.defineProperty(node, 'y', { value: 0, writable: true, configurable: true });
    const before = Object.getOwnPropertyDescriptors(node);
    expect(
      acceptLocalGeometryProposal([node], () => {
        node.x = 100;
        delete node.y;
        node.y = 200;
        return false;
      })
    ).toBe(false);
    expect(Object.getOwnPropertyDescriptors(node)).toStrictEqual(before);
    expect(Object.hasOwn(node, 'x')).toBe(false);
    expect(node.x).toBe(0);
  });

  it.each([
    ['x', NaN],
    ['y', Infinity],
    ['width', -1],
    ['height', 0],
  ] as const)('rejects invalid accepted geometry: %s = %s', (field, value) => {
    const node = measuredNode();
    const before = { ...node };
    expect(
      acceptLocalGeometryProposal([node], () => {
        node[field] = value;
        return true;
      })
    ).toBe(false);
    expect(node).toStrictEqual(before);
  });

  it('does not run a proposal on unmeasured input', () => {
    const node = measuredNode();
    delete node.width;
    const propose = vi.fn(() => true);
    expect(acceptLocalGeometryProposal([node], propose)).toBe(false);
    expect(propose).not.toHaveBeenCalled();
  });

  it('keeps a prior accepted proposal when a later one fails', () => {
    const node = measuredNode();
    expect(
      acceptLocalGeometryProposal([node], () => {
        node.x = 100;
        return true;
      })
    ).toBe(true);
    expect(
      acceptLocalGeometryProposal([node], () => {
        node.x = 200;
        return false;
      })
    ).toBe(false);
    expect(node.x).toBe(100);
  });
});

describe('shared local proposal admission', () => {
  it.each([
    { startSide: 'left' },
    { endSide: 'bottom' },
    { minlen: 2 },
    { isLayoutOnly: true },
  ] as Partial<Edge>[])(
    'keeps measurement admission separate from caller constraints: %j',
    (constraint) => {
      const edge = { id: 'edge', width: 0, height: 0, ...constraint } as Edge;
      expect(measuredLocalEdge(edge)).toBe(true);
      expect(constrainedLocalEdge(edge)).toBe(true);
    }
  );
  it.each([
    { startSide: 'left' },
    { endSide: 'bottom' },
    { minlen: 2 },
    { isLayoutOnly: true },
    { width: NaN },
    { height: Infinity },
    { width: -1 },
    { height: -1 },
  ] as Partial<Edge>[])('protects caller constraints and invalid label sizes: %j', (constraint) => {
    expect(constrainedLocalEdge({ id: 'edge', ...constraint } as Edge)).toBe(true);
  });

  it('allows an unconstrained edge with absent or zero label dimensions', () => {
    expect(constrainedLocalEdge({ id: 'edge' } as Edge)).toBe(false);
    expect(constrainedLocalEdge({ id: 'edge', width: 0, height: 0, minlen: 1 } as Edge)).toBe(
      false
    );
  });

  it.each([
    { x: undefined },
    { y: NaN },
    { width: Infinity },
    { height: 0 },
    { labelBBox: { width: -1, height: 24 } },
    { labelBBox: { width: 40, height: NaN } },
  ])('rejects invalid node/title measurements: %j', (measurement) => {
    expect(measuredLocalNode({ ...measuredNode(), ...measurement })).toBe(false);
  });

  it('allows absent and zero-size frame titles', () => {
    expect(measuredLocalNode(measuredNode())).toBe(true);
    expect(measuredLocalNode({ ...measuredNode(), labelBBox: { width: 0, height: 0 } })).toBe(true);
  });
});
