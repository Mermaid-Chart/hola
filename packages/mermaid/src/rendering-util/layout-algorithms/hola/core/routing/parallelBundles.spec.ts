import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../../../types.js';
import { validateLayout } from '../../../layout-utils/validateLayout.js';
import { DiagnosticCollector } from '../diagnostics.js';
import type { HolaNode } from '../model.js';
import { resolveOptions } from '../options.js';
import { routeFinalEdges, type FinalEdge } from './finalRouting.js';

function bundle(rotation: number, mixedDirections: boolean) {
  const transform = (x: number, y: number) => {
    switch (rotation) {
      case 90:
        return { x: -y, y: x };
      case 180:
        return { x: -x, y: -y };
      case 270:
        return { x: y, y: -x };
      default:
        return { x, y };
    }
  };
  const nodes = new Map<string, HolaNode>([
    ['a', { id: 'a', ...transform(0, 0), width: 87, height: 54, inputOrder: 0, original: null }],
    [
      'b',
      { id: 'b', ...transform(244, 136), width: 87, height: 54, inputOrder: 1, original: null },
    ],
  ]);
  const edges: FinalEdge[] = [
    ...Array.from({ length: 5 }, (_, index) => ({
      originalEdgeId: `parallel-${index}`,
      source: mixedDirections && index % 2 ? 'b' : 'a',
      target: mixedDirections && index % 2 ? 'a' : 'b',
      parallelIndex: index,
      parallelCount: 5,
      mandatoryWaypoints: [],
    })),
  ];
  return { nodes, edges };
}

describe('parallel bundle corridors', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const mixedDirections of [false, true]) {
      it(`separates diagonal bundle tracks at ${rotation} degrees, mixed=${mixedDirections}`, () => {
        const { nodes, edges } = bundle(rotation, mixedDirections);
        const result = routeFinalEdges(
          nodes,
          edges,
          resolveOptions(),
          new DiagnosticCollector(),
          'bundle'
        );
        const data: LayoutData = {
          nodes: [...nodes.values()].map(
            (node) => ({ ...node, isGroup: false, shape: 'rect' }) as Node
          ),
          edges: result.edges.map(
            (route) =>
              ({
                id: route.originalEdgeId,
                start: route.source,
                end: route.target,
                points: route.points,
              }) as Edge
          ),
          config: {},
        };
        const validation = validateLayout(data);
        expect(result.failed).toEqual([]);
        expect(validation.breakdown.crossings, JSON.stringify(result.edges)).toBe(0);
        expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
        expect(validation.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual(
          []
        );
      });
    }
  }
});

it('uses another corridor when a facing terminal is obstructed', () => {
  const nodes = new Map<string, HolaNode>([
    ['a', { id: 'a', x: 0, y: 0, width: 80, height: 40, inputOrder: 0, original: null }],
    ['b', { id: 'b', x: 240, y: 120, width: 80, height: 40, inputOrder: 1, original: null }],
    ['block', { id: 'block', x: 50, y: 0, width: 20, height: 80, inputOrder: 2, original: null }],
  ]);
  const edges: FinalEdge[] = Array.from({ length: 2 }, (_, index) => ({
    originalEdgeId: `parallel-${index}`,
    source: 'a',
    target: 'b',
    parallelIndex: index,
    parallelCount: 2,
    mandatoryWaypoints: [],
  }));
  const result = routeFinalEdges(
    nodes,
    edges,
    resolveOptions(),
    new DiagnosticCollector(),
    'blocked'
  );
  expect(result.failed).toEqual([]);
  expect(result.edges.every((edge) => edge.sourceSide !== 'right')).toBe(true);
});
