import { describe, expect, it } from 'vitest';
import { computeMetrics } from '../metrics/index.js';
import { graftPositions } from './runner.js';
import type { CapturedStructure } from './runner.js';

/**
 * The case that forced the two-capture design: dagre replaces
 * `data4Layout.edges` with the edges it renders at the top level, so a diagram
 * whose edges all live inside a subgraph comes out of the post-layout capture
 * with an empty edge list. Structure must come from the pre-layout snapshot.
 */
const structure: CapturedStructure = {
  capturedAt: 1,
  diagramType: 'flowchart-v2',
  nodes: [
    { id: 'D', isGroup: true },
    { id: 'A', parentId: 'D' },
    { id: 'B', parentId: 'D' },
  ],
  edges: [
    { id: 'e0', start: 'A', end: 'B' },
    { id: 'e1', start: 'B', end: 'A' },
  ],
};

describe('graftPositions', () => {
  it('keeps the pre-layout edges when the layout dropped them', () => {
    const grafted = graftPositions(structure, {
      nodes: [
        { id: 'D', x: 100, y: 100, width: 200, height: 160 },
        { id: 'A', x: 60, y: 60, width: 50, height: 30 },
        { id: 'B', x: 160, y: 60, width: 50, height: 30 },
      ],
      edges: [], // dagre's post-layout state for an all-intra-cluster diagram
    });

    expect(grafted.edges).toHaveLength(2);
    const { metrics } = computeMetrics(grafted);
    expect(metrics.nodeCount).toBe(2);
    expect(metrics.edgeCount).toBe(2);
    expect(metrics.groupCount).toBe(1);
    expect(metrics.degreeMax).toBe(2);
  });

  it('copies geometry onto the structural nodes', () => {
    const grafted = graftPositions(structure, {
      nodes: [{ id: 'A', x: 60, y: 70, width: 50, height: 30 }],
      edges: [],
    });

    expect(grafted.nodes.find((n) => n.id === 'A')).toMatchObject({
      x: 60,
      y: 70,
      width: 50,
      height: 30,
      parentId: 'D',
    });
  });

  it('leaves a node the layout never positioned without coordinates', () => {
    const grafted = graftPositions(structure, {
      nodes: [{ id: 'D', x: 100, y: 100, width: 200, height: 160 }],
      edges: [],
    });

    const a = grafted.nodes.find((n) => n.id === 'A');
    expect(a?.x).toBeUndefined();
    // …and stress simply covers fewer vertices rather than inventing positions.
    const { metrics } = computeMetrics(grafted);
    expect(metrics.stress).toBeNull();
    expect(metrics.edgeCount).toBe(2);
  });

  it('reports how many vertices stress covered', () => {
    const grafted = graftPositions(structure, {
      nodes: [
        { id: 'A', x: 0, y: 0, width: 50, height: 30 },
        { id: 'B', x: 100, y: 0, width: 50, height: 30 },
      ],
      edges: [],
    });
    const { metrics } = computeMetrics(grafted);
    expect(metrics.stressNodeCount).toBe(2);
    expect(metrics.stress).toBeCloseTo(0, 6);
  });

  it('survives an empty post-layout capture entirely', () => {
    const grafted = graftPositions(structure, { nodes: [], edges: [] });
    const { metrics } = computeMetrics(grafted);
    expect(metrics.edgeCount).toBe(2);
    expect(metrics.drawingWidth).toBeNull();
    expect(metrics.stressNodeCount).toBeNull();
  });
});
