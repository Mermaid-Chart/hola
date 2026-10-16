import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { routeStressAndGridEdges } from './routing.js';

function node(
  id: string,
  x: number,
  y: number,
  width: number,
  height: number,
  shape = 'rect'
): Node {
  return { id, x, y, width, height, isGroup: false, shape } as Node;
}

describe('stress-and-grid routing', () => {
  it.each([40, 160, 280])(
    'orders a vertical nested diamond bridge to x=%s without short stubs or crossed lanes',
    (targetX) => {
      const parent = { ...node('parent', 120, 320, 600, 640), isGroup: true } as Node;
      const sourceFrame = {
        ...node('sourceFrame', 120, 200, 240, 160),
        isGroup: true,
        parentId: parent.id,
      } as Node;
      const targetFrame = {
        ...node('targetFrame', targetX - 40, 460, 240, 160),
        isGroup: true,
        parentId: parent.id,
      } as Node;
      const source = {
        ...node('source', 160, 212, 64, 64, 'question'),
        parentId: sourceFrame.id,
      } as Node;
      const target = {
        ...node('target', targetX, 472, 64, 64, 'question'),
        parentId: targetFrame.id,
      } as Node;
      const layout = {
        nodes: [
          parent,
          sourceFrame,
          targetFrame,
          source,
          target,
          { ...node('sourceSibling', 55, 212, 70, 54), parentId: sourceFrame.id },
          { ...node('targetSibling', targetX - 105, 472, 70, 54), parentId: targetFrame.id },
        ],
        edges: [0, 2, 3].map((index) => ({
          id: `parallel-${index}`,
          start: source.id,
          end: target.id,
        })),
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 120);
      const result = validateLayout(layout);
      expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(layout.edges.every((edge) => edge.points!.length === 4)).toBe(true);
    }
  );
  it('moves a diagonal label off its endpoint even without previously routed edges', () => {
    const layout = {
      nodes: [node('source', 0, 0, 260, 78), node('target', 310, -60, 260, 78)],
      edges: [
        {
          id: 'labelled',
          start: 'source',
          end: 'target',
          label: 'Another long label',
          width: 132,
          height: 24,
        },
      ],
      config: {},
    } as LayoutData;
    routeStressAndGridEdges(layout, 100);
    expect(validateLayout(layout).issues).toEqual([]);
    expect(layout.edges[0].points).toHaveLength(4);
  });
  it('keeps three side ports away from short rectangular side corners', () => {
    const source = node('source', 0, 0, 232, 66);
    const layout = {
      nodes: [
        source,
        node('top', 400, -120, 232, 66),
        node('middle', 400, 0, 232, 66),
        node('bottom', 400, 120, 232, 66),
      ],
      edges: ['top', 'middle', 'bottom'].map((id) => ({
        id,
        start: source.id,
        end: id,
      })),
      config: {},
    } as LayoutData;
    routeStressAndGridEdges(layout, 100);
    for (const edge of layout.edges) {
      const fraction = (edge.points![0].y + source.height! / 2) / source.height!;
      expect(fraction).toBeGreaterThanOrEqual(0.15);
      expect(fraction).toBeLessThanOrEqual(0.85);
    }
    expect(validateLayout(layout).issues).toEqual([]);
  });
  it('connects top-aligned frames within their shared vertical span', () => {
    const source = { ...node('source', 0, 40, 100, 80), isGroup: true } as Node;
    const target = { ...node('target', 300, 160, 100, 320), isGroup: true } as Node;
    const layout = {
      nodes: [source, target],
      edges: [{ id: 'bridge', start: source.id, end: target.id }],
      direction: 'LR',
      config: {},
    } as LayoutData;
    routeStressAndGridEdges(layout, 100);
    const points = layout.edges[0].points!;
    expect(points).toHaveLength(2);
    expect(points[0].x).toBe(source.x! + source.width! / 2);
    expect(points[1].x).toBe(target.x! - target.width! / 2);
    expect(points[0].y).toBe(points[1].y);
    expect(points[0].y).toBeGreaterThan(10);
    expect(points[0].y).toBeLessThan(70);
  });
  it.each(['LR', 'RL', 'TB', 'BT'])(
    'attaches mixed parallel edges to trapezoid and parallelogram outlines in %s',
    (direction) => {
      const vertical = direction === 'TB' || direction === 'BT';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const layout = {
        nodes: [
          node('D', 0, 0, 156, 40, 'trap-b'),
          node('I', vertical ? 0 : 320 * sign, vertical ? 320 * sign : 0, 110, 40, 'lean-l'),
        ],
        edges: [
          { id: 'L_D_I_0', start: 'D', end: 'I', label: 'Mermaid js' },
          { id: 'L_D_I_2', start: 'D', end: 'I' },
          { id: 'L_D_I_3', start: 'D', end: 'I' },
        ],
        direction,
        config: {},
      } as LayoutData;
      const rectangularBaseline = {
        ...layout,
        nodes: layout.nodes.map((endpoint) => ({ ...endpoint, shape: 'rect' })),
        edges: layout.edges.map((edge) => ({ ...edge })),
      } as LayoutData;
      routeStressAndGridEdges(rectangularBaseline, 100);
      routeStressAndGridEdges(layout, 100);
      for (const edge of layout.edges) {
        for (const [port, endpoint] of [
          [edge.points![0], layout.nodes[0]],
          [edge.points!.at(-1)!, layout.nodes[1]],
        ] as const) {
          const x = port.x - endpoint.x!;
          const y = port.y - endpoint.y!;
          const halfWidth = endpoint.width! / 2;
          // Independent equations of the fixture's rendered polygon sides.
          const sideX = endpoint.shape === 'trap-b' ? halfWidth - 10 + y / 2 : halfWidth - 10;
          const slopeX = endpoint.shape === 'trap-b' ? Math.abs(x) : Math.abs(x - y / 2);
          const onSlope = Math.abs(slopeX - sideX) < 1e-6 && Math.abs(y) <= 20;
          const onCap = Math.abs(Math.abs(y) - 20) < 1e-6 && slopeX <= sideX;
          expect(onSlope || onCap, `${edge.id} on ${endpoint.id} outline`).toBe(true);
        }
        for (let i = 1; i < edge.points!.length; i++) {
          const a = edge.points![i - 1];
          const b = edge.points![i];
          expect(a.x === b.x || a.y === b.y).toBe(true);
        }
      }
      expect(validateLayout(layout).issues).toEqual([]);
      // Arbitrary four-direction probe layouts retain their existing lanes;
      // extending endpoints must not introduce any additional crossings.
      // The real rendered fixture below is separately pinned to zero crossings.
      expect(validateLayout(layout).breakdown.crossings).toBeLessThanOrEqual(
        validateLayout(rectangularBaseline).breakdown.crossings
      );
    }
  );
  it.each(['rect', 'trap-b', 'lean-l'])(
    'keeps mixed parallel edges away from short %s side corners',
    (shape) => {
      const layout = {
        nodes: [node('D', 0, 0, 156, 39, shape), node('I', 260, 0, 110, 39, shape)],
        edges: [
          { id: 'L_D_I_0', start: 'D', end: 'I', label: 'Mermaid js' },
          { id: 'L_D_I_2', start: 'D', end: 'I' },
          { id: 'L_D_I_3', start: 'D', end: 'I' },
        ],
        direction: 'LR',
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      expect(validateLayout(layout).issues).toEqual([]);
      for (const edge of layout.edges) {
        for (const port of [edge.points![0], edge.points!.at(-1)!]) {
          expect(Math.abs(port.y)).toBeLessThan(39 / 2 - 3);
        }
      }
    }
  );
  it.each(['TB', 'BT', 'LR', 'RL'])(
    'keeps mixed bidirectional diamond edges in distinct lanes in %s',
    (direction) => {
      const vertical = direction === 'TB' || direction === 'BT';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const layout = {
        nodes: [
          node('D', 0, 0, 160, 140, 'question'),
          node('I', vertical ? 0 : 320 * sign, vertical ? 320 * sign : 0, 120, 100, 'question'),
        ],
        edges: [
          { id: 'L_D_I_0', start: 'D', end: 'I', label: 'Mermaid js' },
          { id: 'L_I_D_0', start: 'I', end: 'D' },
          { id: 'L_I_D_2', start: 'I', end: 'D' },
        ],
        direction,
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      const validation = validateLayout(layout);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
    }
  );
  it.each(['diamond', 'decision', 'diam', 'question'])(
    'anchors mixed labelled parallel edges on %s outlines',
    (shape) => {
      const layout = {
        nodes: [node('a', 0, 0, 120, 100, shape), node('b', 320, 0, 160, 140, shape)],
        edges: [
          { id: 'labelled', start: 'a', end: 'b', label: 'Mermaid js' },
          { id: 'plain-1', start: 'a', end: 'b' },
          { id: 'plain-2', start: 'a', end: 'b' },
        ],
        direction: 'LR',
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      for (const edge of layout.edges) {
        for (const [point, endpoint] of [
          [edge.points![0], layout.nodes[0]],
          [edge.points!.at(-1)!, layout.nodes[1]],
        ] as const) {
          expect(
            Math.abs(point.x - endpoint.x!) / (endpoint.width! / 2) +
              Math.abs(point.y - endpoint.y!) / (endpoint.height! / 2)
          ).toBeCloseTo(1);
        }
      }
      expect(validateLayout(layout).issues).toEqual([]);
    }
  );
  it.each(['TB', 'BT', 'LR', 'RL'])(
    'keeps diamond split fans outside both endpoints in %s',
    (direction) => {
      const vertical = direction === 'TB' || direction === 'BT';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const layout = {
        nodes: [
          node('decision', 0, 0, 120, 80, 'diamond'),
          node('a', vertical ? -160 : 240 * sign, vertical ? 240 * sign : -160, 40, 40),
          node('b', vertical ? 160 : 240 * sign, vertical ? 240 * sign : 160, 40, 40),
        ],
        edges: ['a', 'b'].map((end) => ({ id: end, start: 'decision', end })),
        direction,
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      expect(validateLayout(layout).issues).toEqual([]);
      for (const edge of layout.edges) {
        expect(Math.abs(edge.points![0].x)).toBeCloseTo(30);
        expect(Math.abs(edge.points![0].y)).toBeCloseTo(20);
      }
    }
  );
  it('keeps a single input vertex distinct from an output slope independently of edge order', () => {
    const makeLayout = (reverse: boolean): LayoutData => {
      const edges = [
        { id: 'in', start: 'a', end: 'decision' },
        { id: 'out', start: 'decision', end: 'b' },
      ];
      return {
        nodes: [
          node('decision', 0, 0, 160, 120, 'diamond'),
          node('a', 300, 80, 40, 40),
          node('b', 300, 200, 40, 40),
        ],
        edges: reverse ? edges.reverse() : edges,
        direction: 'LR',
        config: {},
      } as LayoutData;
    };
    const layouts = [makeLayout(false), makeLayout(true)];
    for (const layout of layouts) {
      routeStressAndGridEdges(layout, 100);
    }
    const ports = layouts.map((layout) => {
      const incoming = layout.edges.find((edge) => edge.id === 'in')!.points!.at(-1)!;
      const outgoing = layout.edges.find((edge) => edge.id === 'out')!.points![0];
      expect(incoming).toEqual({ x: 80, y: 0 });
      expect(outgoing).toEqual({ x: 40, y: 30 });
      expect(validateLayout(layout).issues).toEqual([]);
      return [incoming, outgoing];
    });
    expect(ports[0]).toEqual(ports[1]);
  });
  it.each(['TB', 'BT', 'LR', 'RL'])(
    'uses a vertex for a single input and a sloped midpoint for an output in %s',
    (direction) => {
      const vertical = direction === 'TB' || direction === 'BT';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const layout = {
        nodes: [
          node('before', vertical ? 0 : -240 * sign, vertical ? -240 * sign : 0, 40, 40),
          node('decision', 0, 0, 120, 80, 'diamond'),
          node('after', vertical ? 0 : 240 * sign, vertical ? 240 * sign : 0, 40, 40),
        ],
        edges: [
          { id: 'in', start: 'before', end: 'decision' },
          { id: 'out', start: 'decision', end: 'after' },
        ],
        direction,
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      expect(layout.edges[0].points!.at(-1)).toEqual(
        vertical ? { x: 0, y: -40 * sign } : { x: -60 * sign, y: 0 }
      );
      const point = layout.edges[1].points![0];
      expect(Math.abs(point.x)).toBeCloseTo(30);
      expect(Math.abs(point.y)).toBeCloseTo(20);
      expect(validateLayout(layout).issues).toEqual([]);
    }
  );

  it('keeps three outgoing edges on one slope distinct, ordered, and clear of corners', () => {
    const layout = {
      nodes: [
        node('decision', 0, 0, 160, 120, 'diamond'),
        node('a', 300, 80, 40, 40),
        node('b', 300, 160, 40, 40),
        node('c', 300, 240, 40, 40),
      ],
      edges: ['a', 'b', 'c'].map((end) => ({ id: end, start: 'decision', end })),
      direction: 'LR',
      config: {},
    } as LayoutData;
    routeStressAndGridEdges(layout, 100);
    const ports = layout.edges.map((edge) => edge.points![0]);
    expect(ports[0].y).toBeLessThan(ports[1].y);
    expect(ports[1].y).toBeLessThan(ports[2].y);
    for (const point of ports) {
      expect(point.x / 80 + point.y / 60).toBeCloseTo(1);
      expect(point.x).toBeGreaterThan(8);
      expect(point.y).toBeGreaterThan(8);
    }
    expect(ports[1]).toEqual({ x: 40, y: 30 });
    expect(validateLayout(layout).issues).toEqual([]);
  });

  it.each(['TB', 'BT', 'LR', 'RL'])(
    'uses free vertices for an aligned continuation into a merge in %s',
    (direction) => {
      const vertical = direction === 'TB' || direction === 'BT';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const layout = {
        nodes: [
          node('decision', 0, 0, 100, 100, 'diamond'),
          node('merge', vertical ? 0 : 350 * sign, vertical ? 350 * sign : 0, 60, 60),
          node('sibling', vertical ? 250 : 180 * sign, vertical ? 180 * sign : 250, 60, 60),
        ],
        edges: [
          { id: 'continuation', start: 'decision', end: 'merge' },
          { id: 'branch', start: 'decision', end: 'sibling' },
          { id: 'rejoin', start: 'sibling', end: 'merge' },
        ],
        direction,
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      expect(layout.edges[0].points).toEqual(
        vertical
          ? [
              { x: 0, y: 50 * sign },
              { x: 0, y: 320 * sign },
            ]
          : [
              { x: 50 * sign, y: 0 },
              { x: 320 * sign, y: 0 },
            ]
      );
      expect(layout.edges[1].points![0]).toEqual(vertical ? { x: 50, y: 0 } : { x: 0, y: 50 });
      expect(validateLayout(layout).issues).toEqual([]);
    }
  );

  it.each(['shared-side', 'occupied-vertex', 'explicit-side'])(
    'keeps distributed slope ports for an aligned merge with %s',
    (guard) => {
      const layout = {
        nodes: [
          node('decision', 0, 0, 100, 100, 'diamond'),
          node('merge', 0, 350, 60, 60),
          node('sibling', guard === 'shared-side' ? 80 : 250, 180, 60, 60),
          ...(guard === 'occupied-vertex' ? [node('before', 100, 80, 40, 40)] : []),
        ],
        edges: [
          { id: 'continuation', start: 'decision', end: 'merge' },
          {
            id: 'branch',
            start: 'decision',
            end: 'sibling',
            ...(guard === 'explicit-side' ? { startSide: 'right' } : {}),
          },
          { id: 'rejoin', start: 'sibling', end: 'merge' },
          ...(guard === 'occupied-vertex'
            ? [{ id: 'arrival', start: 'before', end: 'decision' }]
            : []),
        ],
        direction: 'TB',
        config: {},
      } as LayoutData;
      routeStressAndGridEdges(layout, 100);
      const port = layout.edges[1].points![0];
      expect(Math.abs(port.x)).toBeGreaterThan(0);
      expect(Math.abs(port.y)).toBeGreaterThan(0);
      expect(Math.abs(port.x) / 50 + Math.abs(port.y) / 50).toBeCloseTo(1);
    }
  );

  it('does not use a foreign node border as a straight routing corridor', () => {
    const edge = { id: 'L_source_target_0', start: 'source', end: 'target' } as Edge;
    const layout = {
      nodes: [
        node('source', 0, 0, 40, 40),
        // The route sits 1.5px above the blocker. This is visually tangent
        // after antialiasing and inside the validator's border-hug tolerance.
        node('blocker', 100, 21.5, 60, 40),
        node('target', 200, 0, 40, 40),
      ],
      edges: [edge],
      direction: 'LR',
      config: {},
    } as LayoutData;

    routeStressAndGridEdges(layout, 100);

    expect(validateLayout(layout).issues).toEqual([]);
    expect(edge.points!.length).toBeGreaterThan(2);
  });

  it('gives multiple left-side inputs of a diamond distinct attachment points', () => {
    const layout = {
      nodes: [
        node('Start', 0, 0, 80, 40),
        node('Parse', 0, 200, 100, 40),
        node('Validate', 300, 100, 100, 100, 'diamond'),
      ],
      edges: [
        { id: 'L_Start_Validate_0', start: 'Start', end: 'Validate', label: 'blue label' },
        { id: 'L_Parse_Validate_0', start: 'Parse', end: 'Validate', label: 'green label' },
      ],
      direction: 'LR',
      config: {},
    } as LayoutData;

    routeStressAndGridEdges(layout, 100);

    const validation = validateLayout(layout);
    expect(
      validation.issues.filter(
        (issue) =>
          issue.type === 'edge-same-port-departure' || issue.type === 'edge-shared-attachment-point'
      )
    ).toEqual([]);
  });
});
