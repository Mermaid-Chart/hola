import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import { runStressAndGridLayoutCore } from './index.js';

function node(id: string): Node {
  return {
    id,
    label: id,
    isGroup: false,
    shape: 'rect',
    width: 80,
    height: 40,
  } as Node;
}

function edge(start: string, end: string): Edge {
  return { id: `${start}-${end}`, start, end } as Edge;
}

function treeLayout(): LayoutData {
  return {
    nodes: [node('root'), node('left'), node('middle'), node('right')],
    edges: [edge('root', 'left'), edge('root', 'middle'), edge('root', 'right')],
    direction: 'TB',
    config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
  } as unknown as LayoutData;
}

describe('stress-and-grid layout', () => {
  it('runs IPSEP-COLA and HOLA grid beautification over every tree node', () => {
    const data = treeLayout();

    const result = runStressAndGridLayoutCore(data);

    // Unlike HOLA, this backend has no tree/core decomposition: all four nodes
    // are variables in the one IPSEP-COLA + grid solve.
    expect(result.variableCount).toBe(4);
    expect(data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true
    );
    expect(
      data.edges.every(
        (edge) =>
          edge.points !== undefined &&
          edge.points.length >= 2 &&
          edge.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      )
    ).toBe(true);
  });
});
