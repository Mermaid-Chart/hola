/**
 * Graph-drawing stress, in the form the constrained stress-majorisation layouts
 * in this repo minimise (`hola/core/stress/stressModel.ts`, and IPSEP-COLA via
 * the same objective):
 *
 *     stress(L) = sum over all pairs i, j of  w_ij · (‖p_i − p_j‖ − L · d_ij)²
 *     d_ij      = graph-theoretic (hop) distance between i and j
 *     w_ij      = 1 / d_ij²
 *
 * `L` is the ideal edge length. A layout engine is handed one; a *measurement*
 * must not be, because the same drawing scaled up by 2× would score differently
 * and two layouts with different default spacings would never be comparable. So
 * the value reported here is the stress at the `L` that minimises it, which has
 * a closed form:
 *
 *     L* = Σ w·d·x / Σ w·d²  =  mean over pairs of (x_ij / d_ij)   [with w = 1/d²]
 *
 * That leaves one number per drawing that depends only on the *shape* of the
 * placement, and a companion normalised value in `[0, 1]`:
 *
 *     normalised = stress(L*) / Σ w·x²
 *
 * Lower is better for both. Pairs in different connected components have no hop
 * distance and are skipped, exactly as `StressModel.allPairs` skips them.
 */

import { simpleAdjacency, topologyVertices } from './graphModel.js';
import type { GraphModel, NodePosition } from './types.js';

/**
 * All-pairs BFS is O(n·(n+m)) and runs on the UI thread during a sweep. Past
 * this many vertices the answer is not worth the stall, so it is reported as
 * unavailable rather than silently approximated.
 */
export const STRESS_NODE_LIMIT = 1500;

export interface StressResult {
  /** Stress at the optimal uniform scale. */
  stress: number;
  /** Scale-invariant stress in `[0, 1]`. */
  normalized: number;
  /** The ideal edge length that minimises stress for this drawing. */
  optimalEdgeLength: number;
  /** Node pairs that contributed (same component, both positioned). */
  pairCount: number;
  /** Vertices that contributed. Fewer than the graph has means some were unpositioned. */
  nodeCount: number;
}

/** Unweighted hop distances from `source` to every reachable vertex. */
function bfsDistances(source: string, adjacency: Map<string, Set<string>>): Map<string, number> {
  const dist = new Map<string, number>([[source, 0]]);
  const queue: string[] = [source];
  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const d = dist.get(current)!;
    for (const neighbour of adjacency.get(current) ?? []) {
      if (!dist.has(neighbour)) {
        dist.set(neighbour, d + 1);
        queue.push(neighbour);
      }
    }
  }
  return dist;
}

/**
 * Compute stress for a positioned graph.
 *
 * @returns `null` when the layout has not been run (no positions), when fewer
 *   than two vertices are positioned, or when the graph is past
 *   {@link STRESS_NODE_LIMIT}.
 */
export function computeStress(model: GraphModel): StressResult | null {
  const adjacency = simpleAdjacency(model);
  const vertices = topologyVertices(model).filter((id) => model.positions.has(id));

  if (vertices.length < 2 || vertices.length > STRESS_NODE_LIMIT) {
    return null;
  }

  const positions = new Map<string, NodePosition>();
  for (const id of vertices) {
    positions.set(id, model.positions.get(id)!);
  }

  // Accumulators for the closed-form optimal scale and the two sums it feeds.
  let sumWeightDistanceEuclid = 0; // Σ w·d·x
  let sumWeightDistanceSquared = 0; // Σ w·d²
  let sumWeightEuclidSquared = 0; // Σ w·x²
  let pairCount = 0;

  const index = new Map(vertices.map((id, i) => [id, i]));

  for (const [i, source] of vertices.entries()) {
    const hops = bfsDistances(source, adjacency);
    const from = positions.get(source)!;
    for (const [target, d] of hops) {
      const j = index.get(target);
      // Each unordered pair once, and never a vertex against itself.
      if (j === undefined || j <= i || d === 0) {
        continue;
      }
      const to = positions.get(target)!;
      const dx = from.x - to.x;
      const dy = from.y - to.y;
      const x = Math.sqrt(dx * dx + dy * dy);
      const w = 1 / (d * d);

      sumWeightDistanceEuclid += w * d * x;
      sumWeightDistanceSquared += w * d * d;
      sumWeightEuclidSquared += w * x * x;
      pairCount++;
    }
  }

  if (pairCount === 0 || sumWeightDistanceSquared === 0) {
    return null;
  }

  const optimalEdgeLength = sumWeightDistanceEuclid / sumWeightDistanceSquared;
  // Expanding Σ w (x − L d)² at L = L* collapses to this, which avoids a second
  // pass over every pair.
  const stress = Math.max(0, sumWeightEuclidSquared - optimalEdgeLength * sumWeightDistanceEuclid);
  const normalized = sumWeightEuclidSquared === 0 ? 0 : stress / sumWeightEuclidSquared;

  return { stress, normalized, optimalEdgeLength, pairCount, nodeCount: vertices.length };
}
