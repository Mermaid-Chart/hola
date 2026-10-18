import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../../types.js';
import type { Bounds } from '../core/model.js';
import { polylineHitsBounds, polylineCrossesSegment } from './geometry.js';
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

it('replaces a clipped frame corner with a clear interior-face bridge inside an ancestor', () => {
  const nodes = [
    group('parent', 170, 120, 340, 240),
    group('frame', 100, 160, 160, 100, 'parent'),
    leaf('target', 180, 70, 'parent'),
  ];
  const bridge = edge('frame-target', 'frame', 'target', [
    { x: 180, y: 110 },
    { x: 180, y: 95 },
  ]);
  const data: LayoutData = { nodes, edges: [bridge], config: {} };
  straightenAlignedContainerBridges(
    [{ edge: bridge, startContainer: 'frame' }],
    new Map([
      ['parent', { minX: 0, minY: 0, maxX: 340, maxY: 240 }],
      ['frame', { minX: 20, minY: 110, maxX: 180, maxY: 210 }],
    ]),
    nodes,
    data.edges,
    resolveGridAttachedOptions(data)
  );
  expect(bridge.points).toHaveLength(2);
  expect(bridge.points![0].x).toBeLessThanOrEqual(154.4);
  expect(bridge.points![0].x).toBeGreaterThan(140);
  expect(bridge.points![0].x).toBe(bridge.points![1].x);
});

describe('safe restored ports', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const reverse of [false, true]) {
      it(`repairs both terminals at ${rotation} degrees, reversed=${reverse}`, () => {
        const turn = (point: { x: number; y: number }) =>
          rotation === 90
            ? { x: -point.y, y: point.x }
            : rotation === 180
              ? { x: -point.x, y: -point.y }
              : rotation === 270
                ? { x: point.y, y: -point.x }
                : point;
        const nodes = [
          group('parent', 170, 120, 400, 300),
          group('frame', 100, 160, 160, 100, 'parent'),
          leaf('target', 280, 70, 'parent'),
        ].map((node) => ({
          ...node,
          ...turn({ x: node.x!, y: node.y! }),
          width: rotation % 180 ? node.height : node.width,
          height: rotation % 180 ? node.width : node.height,
        }));
        const points = [
          { x: 180, y: 110 },
          { x: 210, y: 110 },
          { x: 210, y: 95 },
          { x: 240, y: 95 },
        ].map(turn);
        const bridge = edge(
          'frame-target',
          reverse ? 'target' : 'frame',
          reverse ? 'frame' : 'target',
          reverse ? [...points].reverse() : points
        );
        const data: LayoutData = { nodes, edges: [bridge], config: {} };
        const frames = new Map(
          nodes
            .filter((node) => node.isGroup)
            .map((node) => [
              node.id,
              {
                minX: node.x - node.width! / 2,
                maxX: node.x + node.width! / 2,
                minY: node.y - node.height! / 2,
                maxY: node.y + node.height! / 2,
              },
            ])
        );
        rerouteEdgesAroundForeignFrames(
          data.edges,
          frames,
          nodes,
          resolveGridAttachedOptions(data)
        );
        const atFrame = reverse ? bridge.points!.at(-1)! : bridge.points![0];
        const atLeaf = reverse ? bridge.points![0] : bridge.points!.at(-1)!;
        const corners = (xs: number[], ys: number[]) =>
          xs.flatMap((x) => ys.map((y) => turn({ x, y })));
        const distance = (point: { x: number; y: number }, points: { x: number; y: number }[]) =>
          Math.min(...points.map((other) => Math.hypot(point.x - other.x, point.y - other.y)));
        expect(distance(atFrame, corners([20, 180], [110, 210]))).toBeGreaterThanOrEqual(8);
        expect(distance(atLeaf, corners([240, 320], [45, 95]))).toBeGreaterThanOrEqual(8);
      });
    }
  }
});

it('coordinates a frame connector with an ordinary route crossing its corridor', () => {
  const nodes = [
    group('frame', 200, 200, 100, 100),
    leaf('sink', 200, 80),
    leaf('outside', 400, 80),
    leaf('router', 0, 330),
  ];
  const connector = edge('frame-sink', 'frame', 'sink', [
    { x: 200, y: 150 },
    { x: 200, y: 105 },
  ]);
  const through = edge('outside-router', 'outside', 'router', [
    { x: 400, y: 105 },
    { x: 400, y: 125 },
    { x: 0, y: 125 },
    { x: 0, y: 305 },
  ]);
  const data: LayoutData = { nodes, edges: [through, connector], config: {} };
  rerouteEdgesAroundForeignFrames(
    data.edges,
    new Map([['frame', { minX: 150, minY: 150, maxX: 250, maxY: 250 }]]),
    nodes,
    resolveGridAttachedOptions(data)
  );
  expect(
    connector
      .points!.slice(1)
      .some((point, index) =>
        polylineCrossesSegment(through.points!, { a: connector.points![index], b: point })
      )
  ).toBe(false);
});
