import { describe, expect, it } from 'vitest';
import { computeMetrics } from './computeMetrics.js';
import { buildGraphModel } from './graphModel.js';
import type { LabEdge, LabLayoutData, LabNode } from './types.js';

function node(id: string, extra: Partial<LabNode> = {}): LabNode {
  return { id, label: id, ...extra };
}

function edge(source: string, target: string, extra: Partial<LabEdge> = {}): LabEdge {
  return { id: `${source}-${target}`, start: source, end: target, ...extra };
}

function layout(nodes: LabNode[], edges: LabEdge[]): LabLayoutData {
  return { nodes, edges };
}

/** Place nodes on a grid so stress has something to chew on. */
function placed(nodes: LabNode[], positions: Record<string, [number, number]>): LabNode[] {
  return nodes.map((n) => {
    const p = positions[n.id];
    return p ? { ...n, x: p[0], y: p[1], width: 60, height: 40 } : n;
  });
}

describe('computeMetrics — size and ratios', () => {
  it('counts pure nodes and edges, excluding groups and label placeholders', () => {
    const { metrics } = computeMetrics(
      layout(
        [
          node('A'),
          node('B'),
          node('C'),
          node('sub', { isGroup: true }),
          node('edge-label-1', { isEdgeLabel: true }),
        ],
        [edge('A', 'B'), edge('B', 'C')]
      )
    );

    expect(metrics.nodeCount).toBe(3);
    expect(metrics.edgeCount).toBe(2);
    expect(metrics.groupCount).toBe(1);
    expect(metrics.edgeNodeRatio).toBeCloseTo(2 / 3);
  });

  it('reports the labelled-edge ratio over real edges only', () => {
    const { metrics } = computeMetrics(
      layout(
        [node('A'), node('B'), node('C'), node('D')],
        [
          edge('A', 'B', { label: 'yes' }),
          edge('B', 'C', { label: '   ' }),
          edge('C', 'D'),
          edge('D', 'A', { label: 'no' }),
        ]
      )
    );

    // Whitespace-only is not a label.
    expect(metrics.labeledEdgeRatio).toBeCloseTo(0.5);
  });

  it('returns null ratios rather than NaN on an empty diagram', () => {
    const { metrics } = computeMetrics(layout([], []));
    expect(metrics.edgeNodeRatio).toBeNull();
    expect(metrics.labeledEdgeRatio).toBeNull();
    expect(metrics.nodeCount).toBe(0);
    expect(metrics.stress).toBeNull();
  });

  it('measures the drawing box from positioned nodes', () => {
    const { metrics } = computeMetrics(
      layout(placed([node('A'), node('B')], { A: [0, 0], B: [200, 100] }), [edge('A', 'B')])
    );

    // Centres 200 apart, each node 60 wide → 260 across, 40 tall each → 140 down.
    expect(metrics.drawingWidth).toBeCloseTo(260);
    expect(metrics.drawingHeight).toBeCloseTo(140);
    expect(metrics.drawingArea).toBeCloseTo(260 * 140);
  });

  it('leaves the drawing box null before layout has run', () => {
    const { metrics } = computeMetrics(layout([node('A'), node('B')], [edge('A', 'B')]));
    expect(metrics.drawingWidth).toBeNull();
    expect(metrics.drawingArea).toBeNull();
  });
});

describe('computeMetrics — degrees', () => {
  it('reports max and median over pure nodes', () => {
    // Star: hub touches 4 edges, each leaf touches 1.
    const { metrics } = computeMetrics(
      layout(
        [node('hub'), node('a'), node('b'), node('c'), node('d')],
        [edge('hub', 'a'), edge('hub', 'b'), edge('hub', 'c'), edge('hub', 'd')]
      )
    );

    expect(metrics.degreeMax).toBe(4);
    // Degrees [4,1,1,1,1] → sorted [1,1,1,1,4] → median 1.
    expect(metrics.degreeMedian).toBe(1);
  });

  it('averages the two middle values for an even node count', () => {
    const { metrics } = computeMetrics(
      layout(
        [node('a'), node('b'), node('c'), node('d')],
        [edge('a', 'b'), edge('b', 'c'), edge('c', 'd'), edge('b', 'd')]
      )
    );
    // Degrees a:1 b:3 c:2 d:2 → sorted [1,2,2,3] → median 2.
    expect(metrics.degreeMedian).toBe(2);
    expect(metrics.degreeMax).toBe(3);
  });

  it('counts a self-loop twice and parallel edges separately', () => {
    const { metrics } = computeMetrics(
      layout(
        [node('a'), node('b')],
        [edge('a', 'a'), edge('a', 'b'), { ...edge('a', 'b'), id: 'dup' }]
      )
    );
    expect(metrics.degreeMax).toBe(4); // 2 from the loop + 2 parallel edges
  });
});

describe('computeMetrics — topology', () => {
  it('recognises a tree', () => {
    const { metrics } = computeMetrics(
      layout(
        [node('r'), node('a'), node('b'), node('c')],
        [edge('r', 'a'), edge('r', 'b'), edge('a', 'c')]
      )
    );
    expect(metrics.isTree).toBe(true);
    expect(metrics.isForest).toBe(true);
    expect(metrics.componentCount).toBe(1);
    expect(metrics.nonPlanar).toBe(false);
  });

  it('is not a tree when a cycle closes', () => {
    const { metrics } = computeMetrics(
      layout([node('a'), node('b'), node('c')], [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')])
    );
    expect(metrics.isTree).toBe(false);
    expect(metrics.isForest).toBe(false);
  });

  it('treats a two-node cycle A→B, B→A as a cycle, not a tree', () => {
    const { metrics } = computeMetrics(
      layout([node('a'), node('b')], [edge('a', 'b'), edge('b', 'a')])
    );
    // Undirected, and the parallel edge is dropped before the test, so this is
    // a single edge between two nodes — still a tree.
    expect(metrics.isTree).toBe(true);
  });

  it('is a forest but not a tree when disconnected', () => {
    const { metrics } = computeMetrics(
      layout([node('a'), node('b'), node('c'), node('d')], [edge('a', 'b'), edge('c', 'd')])
    );
    expect(metrics.isTree).toBe(false);
    expect(metrics.isForest).toBe(true);
    expect(metrics.componentCount).toBe(2);
  });

  it('flags a K3,3 flowchart as non-planar', () => {
    const nodes = ['a0', 'a1', 'a2', 'b0', 'b1', 'b2'].map((id) => node(id));
    const edges: LabEdge[] = [];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        edges.push(edge(`a${i}`, `b${j}`));
      }
    }
    const { metrics } = computeMetrics(layout(nodes, edges));
    expect(metrics.nonPlanar).toBe(true);
    expect(metrics.edgeCount).toBe(9);
  });
});

describe('computeMetrics — edge-label placeholder collapsing', () => {
  it('collapses source → label → target back into one edge', () => {
    const { metrics, model } = computeMetrics(
      layout(
        [node('A'), node('B'), node('edge-label-0', { isLabelNode: true, label: 'maybe' })],
        [
          { id: 'e0-a', start: 'A', end: 'edge-label-0' },
          { id: 'e0-b', start: 'edge-label-0', end: 'B' },
        ]
      )
    );

    expect(metrics.nodeCount).toBe(2);
    expect(metrics.edgeCount).toBe(1);
    expect(metrics.degreeMax).toBe(1);
    expect(metrics.labeledEdgeRatio).toBe(1);
    expect(model.edges[0]).toMatchObject({ source: 'A', target: 'B', label: 'maybe' });
    expect(model.collapsedLabelNodeIds).toEqual(['edge-label-0']);
  });

  it('gives the same structural answers with and without placeholder injection', () => {
    const plain = computeMetrics(
      layout(
        [node('A'), node('B'), node('C')],
        [edge('A', 'B', { label: 'x' }), edge('B', 'C', { label: 'y' })]
      )
    ).metrics;

    const injected = computeMetrics(
      layout(
        [
          node('A'),
          node('B'),
          node('C'),
          node('edge-label-0', { isLabelNode: true, label: 'x' }),
          node('edge-label-1', { isLabelNode: true, label: 'y' }),
        ],
        [
          { id: 'e0-a', start: 'A', end: 'edge-label-0' },
          { id: 'e0-b', start: 'edge-label-0', end: 'B' },
          { id: 'e1-a', start: 'B', end: 'edge-label-1' },
          { id: 'e1-b', start: 'edge-label-1', end: 'C' },
        ]
      )
    ).metrics;

    for (const key of [
      'nodeCount',
      'edgeCount',
      'degreeMax',
      'degreeMedian',
      'edgeNodeRatio',
      'labeledEdgeRatio',
      'isTree',
      'nonPlanar',
    ] as const) {
      expect(injected[key], key).toEqual(plain[key]);
    }
  });

  it('reads the label from a routed label node', () => {
    const { model } = computeMetrics(
      layout(
        [node('A'), node('B'), node('edge-label-0', { isEdgeLabel: true, label: 'via' })],
        [{ id: 'e0', start: 'A', end: 'B', labelNodeId: 'edge-label-0' }]
      )
    );
    expect(model.edges[0].label).toBe('via');
  });

  it('drops layout-only virtual edges', () => {
    const { metrics } = computeMetrics(
      layout(
        [node('A'), node('B'), node('C')],
        [edge('A', 'B'), { ...edge('A', 'C'), isLayoutOnly: true }]
      )
    );
    expect(metrics.edgeCount).toBe(1);
  });
});

describe('computeMetrics — subgraphs', () => {
  const nodes = [
    node('sub', { isGroup: true }),
    node('inner1', { parentId: 'sub' }),
    node('inner2', { parentId: 'sub' }),
    node('outside'),
  ];

  it('reports no subgraphs when there are none', () => {
    const { metrics } = computeMetrics(layout([node('A'), node('B')], [edge('A', 'B')]));
    expect(metrics.hasSubgraphs).toBe(false);
    expect(metrics.hasSubgraphBoundaryEdges).toBe(false);
    expect(metrics.piercedSubgraphIds).toEqual([]);
  });

  it('does not flag a boundary crossing for an edge wholly inside a subgraph', () => {
    const { metrics } = computeMetrics(layout(nodes, [edge('inner1', 'inner2')]));
    expect(metrics.hasSubgraphs).toBe(true);
    expect(metrics.hasSubgraphBoundaryEdges).toBe(false);
  });

  it('flags an edge from outside into a node inside the subgraph', () => {
    const { metrics } = computeMetrics(layout(nodes, [edge('outside', 'inner1')]));
    expect(metrics.hasSubgraphBoundaryEdges).toBe(true);
    expect(metrics.subgraphBoundaryEdgeCount).toBe(1);
    expect(metrics.piercedSubgraphIds).toEqual(['sub']);
  });

  it('treats an edge landing on the subgraph frame as not piercing it', () => {
    const { metrics } = computeMetrics(layout(nodes, [edge('outside', 'sub')]));
    expect(metrics.hasSubgraphBoundaryEdges).toBe(false);
    // The group became a vertex of the topology graph, but not a counted node.
    expect(metrics.nodeCount).toBe(3);
    expect(metrics.edgeCount).toBe(1);
  });

  it('reports every nested frame an outside edge pierces', () => {
    const nested = [
      node('outer', { isGroup: true }),
      node('inner', { isGroup: true, parentId: 'outer' }),
      node('deep', { parentId: 'inner' }),
      node('outside'),
    ];
    const { metrics } = computeMetrics(layout(nested, [edge('outside', 'deep')]));
    expect(metrics.subgraphBoundaryEdgeCount).toBe(1);
    expect(metrics.piercedSubgraphIds).toEqual(['outer', 'inner']);
  });
});

describe('computeMetrics — stress', () => {
  it('is zero for a drawing that realises its graph distances exactly', () => {
    // Path A–B–C drawn on a straight line with equal spacing: every pairwise
    // euclidean distance is exactly proportional to its hop distance.
    const { metrics } = computeMetrics(
      layout(placed([node('A'), node('B'), node('C')], { A: [0, 0], B: [100, 0], C: [200, 0] }), [
        edge('A', 'B'),
        edge('B', 'C'),
      ])
    );

    expect(metrics.stress).toBeCloseTo(0, 6);
    expect(metrics.stressNormalized).toBeCloseTo(0, 6);
    expect(metrics.stressOptimalEdgeLength).toBeCloseTo(100);
  });

  it('is scale-invariant', () => {
    const positions = { A: [0, 0], B: [100, 10], C: [190, 0] } as Record<string, [number, number]>;
    const scaled = Object.fromEntries(
      Object.entries(positions).map(([k, [x, y]]) => [k, [x * 7, y * 7]])
    ) as Record<string, [number, number]>;
    const edges = [edge('A', 'B'), edge('B', 'C')];

    const base = computeMetrics(
      layout(placed([node('A'), node('B'), node('C')], positions), edges)
    ).metrics;
    const bigger = computeMetrics(
      layout(placed([node('A'), node('B'), node('C')], scaled), edges)
    ).metrics;

    expect(bigger.stressNormalized).toBeCloseTo(base.stressNormalized!, 9);
    expect(bigger.stressOptimalEdgeLength).toBeCloseTo(base.stressOptimalEdgeLength! * 7, 6);
  });

  it('scores a bad placement worse than a good one', () => {
    const nodes = [node('A'), node('B'), node('C')];
    const edges = [edge('A', 'B'), edge('B', 'C')];

    const good = computeMetrics(
      layout(placed(nodes, { A: [0, 0], B: [100, 0], C: [200, 0] }), edges)
    ).metrics;
    // C folded back on top of A: two hops away but drawn at zero distance.
    const bad = computeMetrics(
      layout(placed(nodes, { A: [0, 0], B: [100, 0], C: [0, 0] }), edges)
    ).metrics;

    expect(bad.stressNormalized!).toBeGreaterThan(good.stressNormalized!);
  });

  it('skips pairs in different components instead of reporting infinity', () => {
    const { metrics } = computeMetrics(
      layout(
        placed([node('A'), node('B'), node('X'), node('Y')], {
          A: [0, 0],
          B: [100, 0],
          X: [0, 500],
          Y: [100, 500],
        }),
        [edge('A', 'B'), edge('X', 'Y')]
      )
    );
    expect(Number.isFinite(metrics.stress!)).toBe(true);
    expect(metrics.stress).toBeCloseTo(0, 6);
  });

  it('is null when nothing is positioned', () => {
    const { metrics } = computeMetrics(layout([node('A'), node('B')], [edge('A', 'B')]));
    expect(metrics.stress).toBeNull();
    expect(metrics.stressNormalized).toBeNull();
  });
});

describe('buildGraphModel — robustness', () => {
  it('counts an edge naming an unknown node as dangling rather than inventing a vertex', () => {
    const model = buildGraphModel(layout([node('A')], [edge('A', 'ghost')]));
    expect(model.danglingEdgeCount).toBe(1);
    expect(model.edges).toHaveLength(0);
    expect(model.nodeIds).toEqual(['A']);
  });

  it('accepts source/target as well as start/end', () => {
    const model = buildGraphModel(
      layout([node('A'), node('B')], [{ id: 'e', source: 'A', target: 'B' }])
    );
    expect(model.edges).toHaveLength(1);
  });

  it('survives a parentId cycle without hanging', () => {
    const model = buildGraphModel(
      layout(
        [
          node('g1', { isGroup: true, parentId: 'g2' }),
          node('g2', { isGroup: true, parentId: 'g1' }),
        ],
        []
      )
    );
    expect(model.groupIds).toEqual(['g1', 'g2']);
  });
});
