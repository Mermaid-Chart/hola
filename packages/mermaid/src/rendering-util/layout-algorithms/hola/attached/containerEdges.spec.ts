import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../../types.js';
import type { Bounds } from '../core/model.js';
import { polylineHitsBounds } from './geometry.js';
import {
  preserveContainerTerminalRuns,
  rerouteEdgesAroundForeignFrames,
  straightenAlignedContainerBridges,
} from './containerEdges.js';
import { resolveGridAttachedOptions } from './options.js';

function leaf(id: string, x: number, y: number, parentId?: string): Node {
  return { id, isGroup: false, x, y, width: 80, height: 50, ...(parentId ? { parentId } : {}) };
}

function group(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  parentId?: string
): Node {
  return { id, isGroup: true, x, y, width, height, ...(parentId ? { parentId } : {}) };
}

function edge(id: string, start: string, end: string, points: { x: number; y: number }[]): Edge {
  return { id, start, end, points };
}

describe('post-frame subgraph routing', () => {
  it('retains a full rounded terminal run after a frame edge is re-routed', () => {
    const routed = edge('three-two', 'three', 'two', [
      { x: 44, y: 111 },
      { x: 44, y: 145 },
      { x: 239, y: 145 },
      { x: 239, y: 162 },
    ]);

    preserveContainerTerminalRuns([{ edge: routed, startContainer: 'three', endContainer: 'two' }]);

    expect(routed.points?.at(-2)?.y).toBe(128);
    expect(routed.points?.at(-1)?.y).toBe(162);
  });

  it('uses a clear shared corridor for a straight frame-to-frame bridge', () => {
    const nodes = [
      group('three', 316, 100, 472, 123),
      group('two', 476, 270, 260, 92),
      leaf('c1', 127, 126, 'three'),
      leaf('c2', 507, 126, 'three'),
      leaf('b1', 393, 280, 'two'),
      leaf('b2', 559, 280, 'two'),
    ];
    const bridge = edge('three-two', 'three', 'two', [
      { x: 127, y: 161 },
      { x: 127, y: 193 },
      { x: 393, y: 193 },
      { x: 393, y: 224 },
    ]);
    const data = {
      nodes,
      edges: [bridge],
      config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
    } as unknown as LayoutData;

    straightenAlignedContainerBridges(
      [{ edge: bridge, startContainer: 'three', endContainer: 'two' }],
      new Map([
        ['three', { minX: 80, minY: 38, maxX: 552, maxY: 161 }],
        ['two', { minX: 346, minY: 224, maxX: 606, maxY: 316 }],
      ]),
      nodes,
      data.edges,
      resolveGridAttachedOptions(data)
    );

    expect(bridge.points).toHaveLength(2);
    expect(bridge.points![0].x).toBeCloseTo(bridge.points![1].x, 6);
    expect(bridge.points![0].x).toBeGreaterThan(346);
    expect(bridge.points![0].x).toBeLessThan(552);
    expect(bridge.points![0].y).toBe(161);
    expect(bridge.points![1].y).toBe(224);
  });

  it('uses a separate frame port when another route already owns the centre lane', () => {
    const nodes = [group('three', 316, 100, 472, 123), group('two', 476, 270, 260, 92)];
    const bridge = edge('three-two', 'three', 'two', [
      { x: 127, y: 161 },
      { x: 127, y: 193 },
      { x: 393, y: 193 },
      { x: 393, y: 224 },
    ]);
    const twoToC2 = edge('two-c2', 'two', 'c2', [
      { x: 449, y: 224 },
      { x: 449, y: 180 },
    ]);
    const data = {
      nodes,
      edges: [bridge, twoToC2],
      config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
    } as unknown as LayoutData;

    straightenAlignedContainerBridges(
      [{ edge: bridge, startContainer: 'three', endContainer: 'two' }],
      new Map([
        ['three', { minX: 80, minY: 38, maxX: 552, maxY: 161 }],
        ['two', { minX: 346, minY: 224, maxX: 606, maxY: 316 }],
      ]),
      nodes,
      data.edges,
      resolveGridAttachedOptions(data)
    );

    expect(bridge.points).toHaveLength(2);
    expect(bridge.points![0].x).not.toBeCloseTo(twoToC2.points![0].x, 6);
  });

  it('keeps the existing route when every shared corridor is obstructed', () => {
    const blocker = { ...leaf('blocker', 449, 192), width: 240 };
    const nodes = [group('three', 316, 100, 472, 123), group('two', 476, 270, 260, 92), blocker];
    const original = [
      { x: 127, y: 161 },
      { x: 127, y: 193 },
      { x: 393, y: 193 },
      { x: 393, y: 224 },
    ];
    const bridge = edge('three-two', 'three', 'two', original);
    const data = {
      nodes,
      edges: [bridge],
      config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
    } as unknown as LayoutData;

    straightenAlignedContainerBridges(
      [{ edge: bridge, startContainer: 'three', endContainer: 'two' }],
      new Map([
        ['three', { minX: 80, minY: 38, maxX: 552, maxY: 161 }],
        ['two', { minX: 346, minY: 224, maxX: 606, maxY: 316 }],
      ]),
      nodes,
      data.edges,
      resolveGridAttachedOptions(data)
    );

    expect(bridge.points).toEqual(original);
  });

  it('spreads ports when two re-routed edges meet the same node', () => {
    const nodes = [
      group('project', 150, 125, 320, 250),
      group('subnet1', 45, 130, 90, 100, 'project'),
      group('subnet2', 140, 130, 90, 140, 'project'),
      leaf('nat', 260, 130, 'project'),
      leaf('internet', 260, 20),
    ];
    const inbound = edge('subnet1-nat', 'subnet1', 'nat', [
      { x: 90, y: 130 },
      { x: 220, y: 130 },
    ]);
    const outbound = edge('nat-internet', 'nat', 'internet', [
      { x: 220, y: 130 },
      { x: 140, y: 130 },
      { x: 140, y: 20 },
      { x: 220, y: 20 },
    ]);
    const data = {
      nodes,
      edges: [inbound, outbound],
      config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
    } as unknown as LayoutData;
    const subnet2: Bounds = { minX: 95, minY: 60, maxX: 185, maxY: 200 };

    rerouteEdgesAroundForeignFrames(
      data.edges,
      new Map([
        ['project', { minX: -10, minY: 0, maxX: 310, maxY: 250 }],
        ['subnet1', { minX: 0, minY: 80, maxX: 90, maxY: 180 }],
        ['subnet2', subnet2],
      ]),
      data.nodes,
      resolveGridAttachedOptions(data)
    );

    expect(polylineHitsBounds(inbound.points!, subnet2)).toBe(false);
    expect(polylineHitsBounds(outbound.points!, subnet2)).toBe(false);
    const inboundAtNat = inbound.points!.at(-1)!;
    const outboundAtNat = outbound.points![0];
    expect(
      Math.hypot(inboundAtNat.x - outboundAtNat.x, inboundAtNat.y - outboundAtNat.y)
    ).toBeGreaterThanOrEqual(8);
  });
});
