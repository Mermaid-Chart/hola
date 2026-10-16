import { describe, expect, it } from 'vitest';
import type { LayoutData, Node } from '../../types.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { routeStressAndGridEdges } from './routing.js';

function sharedCorridor(copies: number): LayoutData {
  const node = (id: string, x: number, y: number, width: number, height: number): Node =>
    ({ id, x, y, width, height, shape: 'rect', isGroup: false }) as Node;
  return {
    nodes: [
      { ...node('upper', 118.6640625, 72.106325, 245.328125, 150), isGroup: true },
      { ...node('lower', 186.203125, 318.106325, 139.921875, 150), isGroup: true },
      { ...node('junction', 66.203125, 84.106325, 68.40625, 54), parentId: 'upper' },
      { ...node('departure', 170.8671875, 84.106325, 68.921875, 54), parentId: 'upper' },
      { ...node('arrival', 186.203125, 330.106325, 67.921875, 54), parentId: 'lower' },
    ],
    edges: [
      { id: 'join', start: 'junction', end: 'departure' },
      { id: 'shared-entry', start: 'junction', end: 'arrival' },
      ...Array.from({ length: copies }, (_, index) => ({
        id: `lane-${index}`,
        start: 'departure',
        end: 'arrival',
      })),
    ],
    config: {},
  } as LayoutData;
}

function transform(layout: LayoutData, transpose: boolean, reflectX: number, reflectY: number) {
  for (const node of layout.nodes) {
    if (transpose) {
      [node.x, node.y] = [node.y, node.x];
      [node.width, node.height] = [node.height, node.width];
    }
    node.x! *= reflectX;
    node.y! *= reflectY;
  }
}

describe('stress-and-grid coordinated corridors', () => {
  for (const transpose of [false, true]) {
    for (const reflectX of [-1, 1]) {
      for (const reflectY of [-1, 1]) {
        it.each([2, 3, 4, 5, 6])(
          `keeps %s parallel lanes clear (transpose=${transpose}, reflect=${reflectX}/${reflectY})`,
          (copies) => {
            const layout = sharedCorridor(copies);
            transform(layout, transpose, reflectX, reflectY);
            routeStressAndGridEdges(layout, 120);
            const result = validateLayout(layout);
            expect(result.ok, JSON.stringify(result.issues)).toBe(true);
            expect(result.breakdown.crossings).toBe(0);
          }
        );
        it(`combs a row/column fan around a neighbouring node (transpose=${transpose}, reflect=${reflectX}/${reflectY})`, () => {
          const layout = {
            nodes: [
              {
                id: 'frame',
                x: 281,
                y: 227,
                width: 296,
                height: 254,
                isGroup: true,
                labelBBox: { width: 20, height: 24 },
              },
              {
                id: 'hub',
                x: 212.5,
                y: 187,
                width: 87,
                height: 54,
                shape: 'rect',
                parentId: 'frame',
              },
              {
                id: 'neighbour',
                x: 212.5,
                y: 291,
                width: 87,
                height: 54,
                shape: 'rect',
                parentId: 'frame',
              },
              ...[19, 103, 187, 271, 355].map((y, index) => ({
                id: `peer-${index}`,
                x: 53.5,
                y,
                width: 87,
                height: 54,
                shape: 'rect',
              })),
            ],
            edges: [
              { id: 'continuation', start: 'hub', end: 'neighbour' },
              ...Array.from({ length: 5 }, (_, index) => ({
                id: `fan-${index}`,
                start: 'hub',
                end: `peer-${index}`,
              })),
            ],
            config: {},
          } as LayoutData;
          transform(layout, transpose, reflectX, reflectY);
          routeStressAndGridEdges(layout, 120);
          const result = validateLayout(layout);
          expect(result.ok, JSON.stringify(result.issues)).toBe(true);
          expect(result.breakdown.crossings).toBe(0);
          expect(layout.edges.every((edge) => edge.points!.length <= 4)).toBe(true);
        });
      }
    }
  }

  it.each(['renamed and shuffled', 'reversed', 'reciprocal'])(
    'coordinates lanes with %s edges',
    (variant) => {
      const layout = sharedCorridor(5);
      for (const edge of layout.edges) {
        if (variant === 'reversed' || (variant === 'reciprocal' && edge.id === 'lane-2')) {
          [edge.start, edge.end] = [edge.end, edge.start];
        }
      }
      const renamed = new Map(layout.nodes.map((node, index) => [node.id, `unrelated-${index}`]));
      for (const node of layout.nodes) {
        node.id = renamed.get(node.id)!;
        if (node.parentId) {
          node.parentId = renamed.get(node.parentId)!;
        }
      }
      layout.edges.reverse().forEach((edge, index) => {
        edge.id = `other-${index}`;
        edge.start = renamed.get(edge.start!)!;
        edge.end = renamed.get(edge.end!)!;
      });
      routeStressAndGridEdges(layout, 120);
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
    }
  );

  it('retains explicit side constraints even when they prevent an ordered bundle', () => {
    const layout = sharedCorridor(5);
    const edge = layout.edges.find((member) => member.id === 'lane-2')!;
    Object.assign(edge, { startSide: 'right', endSide: 'top', minlen: 3 });
    routeStressAndGridEdges(layout, 120);
    const source = layout.nodes.find((node) => node.id === edge.start)!;
    const target = layout.nodes.find((node) => node.id === edge.end)!;
    expect(edge.points![0].x).toBeCloseTo(source.x! + source.width! / 2, 6);
    expect(edge.points!.at(-1)!.y).toBeCloseTo(target.y! - target.height! / 2, 6);
    expect(edge).toMatchObject({ startSide: 'right', endSide: 'top', minlen: 3 });
  });
});
