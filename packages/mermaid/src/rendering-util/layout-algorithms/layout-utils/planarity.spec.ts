import { describe, expect, it } from 'vitest';
import { isPlanar } from './planarity.js';

/** Build a symmetric adjacency map from an edge list. */
function graph(vertices: string[], edges: [string, string][]): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>(vertices.map((v) => [v, new Set<string>()]));
  for (const [a, b] of edges) {
    adjacency.get(a)?.add(b);
    adjacency.get(b)?.add(a);
  }
  return adjacency;
}

function complete(n: number): Map<string, Set<string>> {
  const vertices = Array.from({ length: n }, (_, i) => `v${i}`);
  const edges: [string, string][] = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      edges.push([vertices[i], vertices[j]]);
    }
  }
  return graph(vertices, edges);
}

function completeBipartite(m: number, n: number): Map<string, Set<string>> {
  const left = Array.from({ length: m }, (_, i) => `a${i}`);
  const right = Array.from({ length: n }, (_, i) => `b${i}`);
  const edges: [string, string][] = [];
  for (const a of left) {
    for (const b of right) {
      edges.push([a, b]);
    }
  }
  return graph([...left, ...right], edges);
}

describe('isPlanar', () => {
  it('accepts the empty and single-vertex graphs', () => {
    expect(isPlanar(new Map())).toBe(true);
    expect(isPlanar(graph(['a'], []))).toBe(true);
  });

  it('accepts paths, cycles and trees', () => {
    expect(
      isPlanar(
        graph(
          ['a', 'b', 'c', 'd'],
          [
            ['a', 'b'],
            ['b', 'c'],
            ['c', 'd'],
          ]
        )
      )
    ).toBe(true);

    expect(
      isPlanar(
        graph(
          ['a', 'b', 'c', 'd', 'e'],
          [
            ['a', 'b'],
            ['b', 'c'],
            ['c', 'd'],
            ['d', 'e'],
            ['e', 'a'],
          ]
        )
      )
    ).toBe(true);

    // Binary tree of depth 3.
    const treeEdges: [string, string][] = [];
    for (let i = 1; i <= 7; i++) {
      treeEdges.push([`n${i}`, `n${2 * i}`], [`n${i}`, `n${2 * i + 1}`]);
    }
    const treeVertices = Array.from({ length: 15 }, (_, i) => `n${i + 1}`);
    expect(isPlanar(graph(treeVertices, treeEdges))).toBe(true);
  });

  it('accepts K4 — planar despite being complete', () => {
    expect(isPlanar(complete(4))).toBe(true);
  });

  it('rejects K5', () => {
    expect(isPlanar(complete(5))).toBe(false);
  });

  it('rejects K6 and K7', () => {
    expect(isPlanar(complete(6))).toBe(false);
    expect(isPlanar(complete(7))).toBe(false);
  });

  it('rejects K3,3 — which the Euler bound alone cannot catch', () => {
    const k33 = completeBipartite(3, 3);
    // 6 vertices, 9 edges: under the 3n-6 = 12 bound, so the DFS phases are
    // what must reject it. This is the case a shortcut-only test gets wrong.
    expect([...k33.values()].reduce((sum, s) => sum + s.size, 0) / 2).toBe(9);
    expect(isPlanar(k33)).toBe(false);
  });

  it('accepts K2,3 and K3,2', () => {
    expect(isPlanar(completeBipartite(2, 3))).toBe(true);
    expect(isPlanar(completeBipartite(3, 2))).toBe(true);
  });

  it('accepts K5 minus one edge', () => {
    const k5 = complete(5);
    k5.get('v0')?.delete('v4');
    k5.get('v4')?.delete('v0');
    expect(isPlanar(k5)).toBe(true);
  });

  it('accepts K3,3 minus one edge', () => {
    const k33 = completeBipartite(3, 3);
    k33.get('a0')?.delete('b0');
    k33.get('b0')?.delete('a0');
    expect(isPlanar(k33)).toBe(true);
  });

  it('rejects a subdivision of K3,3 (each edge split by a new vertex)', () => {
    // Homeomorphic to K3,3, so still non-planar — and now 15 vertices with 18
    // edges, well under the Euler bound.
    const edges: [string, string][] = [];
    const vertices = new Set<string>();
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        const mid = `m${i}${j}`;
        edges.push([`a${i}`, mid], [mid, `b${j}`]);
        vertices.add(`a${i}`).add(`b${j}`).add(mid);
      }
    }
    expect(isPlanar(graph([...vertices], edges))).toBe(false);
  });

  it('rejects a disconnected graph when any component is non-planar', () => {
    const k5 = complete(5);
    const combined = new Map(k5);
    combined.set('x', new Set(['y']));
    combined.set('y', new Set(['x']));
    expect(isPlanar(combined)).toBe(false);
  });

  it('accepts a disconnected graph of planar components', () => {
    const combined = graph(
      ['a', 'b', 'c', 'x', 'y'],
      [
        ['a', 'b'],
        ['b', 'c'],
        ['c', 'a'],
        ['x', 'y'],
      ]
    );
    expect(isPlanar(combined)).toBe(true);
  });

  it('accepts the 3-cube graph Q3', () => {
    const edges: [string, string][] = [];
    const vertices: string[] = [];
    for (let i = 0; i < 8; i++) {
      vertices.push(`q${i}`);
    }
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        const j = i ^ bit;
        if (j > i) {
          edges.push([`q${i}`, `q${j}`]);
        }
      }
    }
    expect(isPlanar(graph(vertices, edges))).toBe(true);
  });

  it('rejects the Petersen graph', () => {
    const edges: [string, string][] = [];
    const vertices: string[] = [];
    for (let i = 0; i < 5; i++) {
      vertices.push(`o${i}`, `i${i}`);
    }
    for (let i = 0; i < 5; i++) {
      edges.push([`o${i}`, `o${(i + 1) % 5}`]); // outer 5-cycle
      edges.push([`o${i}`, `i${i}`]); // spokes
      edges.push([`i${i}`, `i${(i + 2) % 5}`]); // inner pentagram
    }
    expect(isPlanar(graph(vertices, edges))).toBe(false);
  });

  it('is unaffected by vertex ordering', () => {
    const k33 = completeBipartite(3, 3);
    const reversed = new Map([...k33.entries()].reverse());
    expect(isPlanar(reversed)).toBe(false);
  });

  it('handles a large planar grid without recursing', () => {
    // 40x40 = 1600 vertices; a recursive DFS would be at risk here.
    const size = 40;
    const vertices: string[] = [];
    const edges: [string, string][] = [];
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        vertices.push(`${r},${c}`);
        if (r > 0) {
          edges.push([`${r},${c}`, `${r - 1},${c}`]);
        }
        if (c > 0) {
          edges.push([`${r},${c}`, `${r},${c - 1}`]);
        }
      }
    }
    expect(isPlanar(graph(vertices, edges))).toBe(true);
  });
});
