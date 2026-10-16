import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../../../types.js';
import { validateLayout } from '../../../layout-utils/validateLayout.js';
import { DiagnosticCollector } from '../diagnostics.js';
import type { HolaNode } from '../model.js';
import { resolveOptions } from '../options.js';
import { routeFinalEdges, type FinalEdge } from './finalRouting.js';

function fan(rotation: number, reverse: boolean, reverseIds: boolean) {
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
  const ids = reverseIds ? ['z', 'a', 'm', 'n'] : ['a', 'z', 'm', 'n'];
  const nodes = new Map<string, HolaNode>(
    [...ids, 'sink'].map((id, index) => [
      id,
      {
        id,
        ...transform(index === 4 ? 260 : [0, 120, 260, 380][index], index === 4 ? 140 : 0),
        width: 80,
        height: 54,
        inputOrder: index,
        original: null,
      },
    ])
  );
  const edges: FinalEdge[] = ids.map((id) => ({
    originalEdgeId: `${id}-edge`,
    source: reverse ? 'sink' : id,
    target: reverse ? id : 'sink',
    parallelIndex: 0,
    parallelCount: 1,
    mandatoryWaypoints: [],
  }));
  return { nodes, edges };
}

describe('converging fan routing', () => {
  for (const rotation of [0, 90, 180, 270]) {
    for (const reverse of [false, true]) {
      it(`keeps shared-endpoint routes separate at ${rotation} degrees, reversed=${reverse}`, () => {
        for (const reverseIds of [false, true]) {
          const { nodes, edges } = fan(rotation, reverse, reverseIds);
          const positions = [...nodes.values()].map(({ id, x, y }) => ({ id, x, y }));
          const result = routeFinalEdges(
            nodes,
            edges,
            resolveOptions(),
            new DiagnosticCollector(),
            'fan'
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
          expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
          expect(validation.breakdown.crossings, JSON.stringify(result.edges)).toBe(0);
          expect(validation.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual(
            []
          );
          expect([...nodes.values()].map(({ id, x, y }) => ({ id, x, y }))).toEqual(positions);
        }
      });
    }
  }
});
