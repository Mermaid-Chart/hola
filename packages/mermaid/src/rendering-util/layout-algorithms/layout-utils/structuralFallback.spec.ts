import { describe, expect, it } from 'vitest';
import type { LayoutData } from '../../types.js';
import { structuralFallbackVerdict } from './structuralFallback.js';

/** A graph from an edge list, with every endpoint promoted to a plain node. */
function graph(edges: [string, string][], extraNodes: string[] = []): LayoutData {
  const ids = new Set<string>(extraNodes);
  for (const [a, b] of edges) {
    ids.add(a);
    ids.add(b);
  }
  return {
    nodes: [...ids].map((id) => ({ id, isGroup: false })),
    edges: edges.map(([start, end], index) => ({ id: `e${index}`, start, end })),
    config: {},
  } as unknown as LayoutData;
}

function withSubgraphs(count: number, edges: [string, string][] = []): LayoutData {
  const data = graph(edges);
  for (let index = 0; index < count; index++) {
    (data.nodes as unknown[]).push({ id: `sub${index}`, isGroup: true });
  }
  return data;
}

/** A path, which is planar, low-degree, and has no groups — the happy shape. */
function path(length: number): [string, string][] {
  return Array.from({ length }, (_, index) => [`n${index}`, `n${index + 1}`]);
}

describe('structuralFallbackVerdict', () => {
  describe('only applies to the grid-like layouts', () => {
    // K5 is non-planar, so it would be redirected if the layout were in scope.
    const k5: [string, string][] = [
      ['a', 'b'],
      ['a', 'c'],
      ['a', 'd'],
      ['a', 'e'],
      ['b', 'c'],
      ['b', 'd'],
      ['b', 'e'],
      ['c', 'd'],
      ['c', 'e'],
      ['d', 'e'],
    ];

    it.each(['hola', 'gipsec'])('considers %s', (layout) => {
      expect(structuralFallbackVerdict(graph(k5), layout).fallback).toBe(true);
    });

    it.each(['dagre', 'elk', 'swimlane', 'domus', 'ipsep-cola', ''])(
      'leaves %s alone',
      (layout) => {
        expect(structuralFallbackVerdict(graph(k5), layout)).toEqual({ fallback: false });
      }
    );
  });

  describe('non-planar', () => {
    it('redirects K5', () => {
      const k5: [string, string][] = [];
      for (const a of ['a', 'b', 'c', 'd', 'e']) {
        for (const b of ['a', 'b', 'c', 'd', 'e']) {
          if (a < b) {
            k5.push([a, b]);
          }
        }
      }
      // Degree 4 throughout and only 5 nodes, so neither other rule can fire.
      const verdict = structuralFallbackVerdict(graph(k5), 'hola');
      expect(verdict.fallback).toBe(true);
      expect(verdict.reason).toBe('non-planar');
    });

    it('redirects K3,3', () => {
      const k33: [string, string][] = [];
      for (const a of ['a1', 'a2', 'a3']) {
        for (const b of ['b1', 'b2', 'b3']) {
          k33.push([a, b]);
        }
      }
      const verdict = structuralFallbackVerdict(graph(k33), 'gipsec');
      expect(verdict.fallback).toBe(true);
      expect(verdict.reason).toBe('non-planar');
    });

    it('keeps a planar graph', () => {
      expect(structuralFallbackVerdict(graph(path(5)), 'hola')).toEqual({ fallback: false });
    });
  });

  describe('subgraph count', () => {
    it('keeps 4', () => {
      expect(structuralFallbackVerdict(withSubgraphs(4, path(3)), 'hola')).toEqual({
        fallback: false,
      });
    });

    it('redirects 5', () => {
      const verdict = structuralFallbackVerdict(withSubgraphs(5, path(3)), 'hola');
      expect(verdict.fallback).toBe(true);
      expect(verdict.reason).toBe('too-many-subgraphs');
      expect(verdict.detail).toContain('5 subgraphs');
    });

    it('counts only group nodes, not every node', () => {
      // 12 plain nodes, no groups: the subgraph rule must not fire on them.
      const verdict = structuralFallbackVerdict(graph(path(11)), 'hola');
      expect(verdict.reason).not.toBe('too-many-subgraphs');
    });
  });

  describe('large graph with a high-degree node', () => {
    /** A star of `spokes` leaves around `hub`, padded to `total` nodes by a path. */
    function hubAndPadding(spokes: number, total: number): LayoutData {
      const edges: [string, string][] = Array.from({ length: spokes }, (_, index) => [
        'hub',
        `s${index}`,
      ]);
      const padding = Array.from({ length: total }, (_, index) => `pad${index}`);
      return graph(edges, padding);
    }

    it('redirects >10 nodes with a degree-5 node', () => {
      const verdict = structuralFallbackVerdict(hubAndPadding(5, 10), 'hola');
      expect(verdict.fallback).toBe(true);
      expect(verdict.reason).toBe('large-with-high-degree-node');
      expect(verdict.detail).toContain('degree 5');
    });

    it('keeps a degree-5 node in a small graph', () => {
      // 6 nodes: the hub is busy but there is nothing to detour around.
      expect(structuralFallbackVerdict(hubAndPadding(5, 0), 'hola')).toEqual({ fallback: false });
    });

    it('keeps a large graph whose nodes all stay under degree 5', () => {
      // A 20-node path: every interior node is degree 2.
      expect(structuralFallbackVerdict(graph(path(19)), 'hola')).toEqual({ fallback: false });
    });

    it('needs more than 10 nodes, not exactly 10', () => {
      // hub + 5 spokes + 4 padding = 10 nodes exactly, so the rule must not fire.
      expect(structuralFallbackVerdict(hubAndPadding(5, 4), 'hola')).toEqual({ fallback: false });
    });
  });

  describe('adjacency construction', () => {
    it('ignores self-loops when counting degree', () => {
      const data = graph([
        ['hub', 's0'],
        ['hub', 's1'],
        ['hub', 's2'],
        ['hub', 's3'],
      ]);
      // Four real spokes plus four self-loops would reach degree 5 only if
      // self-loops counted; they must not.
      for (let index = 0; index < 4; index++) {
        (data.edges as unknown[]).push({ id: `loop${index}`, start: 'hub', end: 'hub' });
      }
      for (let index = 0; index < 8; index++) {
        (data.nodes as unknown[]).push({ id: `pad${index}`, isGroup: false });
      }
      expect(structuralFallbackVerdict(data, 'hola')).toEqual({ fallback: false });
    });

    it('counts parallel edges once', () => {
      const data = graph([['hub', 's0']]);
      for (let index = 0; index < 6; index++) {
        (data.edges as unknown[]).push({ id: `dup${index}`, start: 'hub', end: 's0' });
      }
      for (let index = 0; index < 12; index++) {
        (data.nodes as unknown[]).push({ id: `pad${index}`, isGroup: false });
      }
      // Seven edges between the same pair is still degree 1.
      expect(structuralFallbackVerdict(data, 'hola')).toEqual({ fallback: false });
    });

    it('survives an empty graph', () => {
      expect(
        structuralFallbackVerdict(
          { nodes: [], edges: [], config: {} } as unknown as LayoutData,
          'hola'
        )
      ).toEqual({ fallback: false });
    });

    it('survives missing nodes and edges', () => {
      expect(structuralFallbackVerdict({} as unknown as LayoutData, 'hola')).toEqual({
        fallback: false,
      });
    });

    it('skips an edge pointing at an unknown node', () => {
      const data = graph(path(3));
      (data.edges as unknown[]).push({ id: 'dangling', start: 'n0', end: 'nowhere' });
      expect(structuralFallbackVerdict(data, 'hola')).toEqual({ fallback: false });
    });
  });
});
