/**
 * Node connectivity: how many edges touch each node.
 *
 * Multiplicity is kept — two arrows between the same pair really are two
 * connections to read — and a self-loop counts twice, once for each end, which
 * is the standard graph-theoretic degree. Both are deliberate: these numbers are
 * meant to describe how busy a node looks, and a doubled arrow looks busy.
 *
 * Degrees are reported over *pure* nodes only (see `graphModel.ts`), so a
 * subgraph used as an edge endpoint does not enter the max or the median.
 */

import type { GraphModel } from './types.js';

export interface DegreeStats {
  max: number;
  median: number;
  /** Degree per pure node, in `GraphModel.nodeIds` order. */
  byNode: Map<string, number>;
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function computeDegrees(model: GraphModel): DegreeStats {
  const byNode = new Map<string, number>();
  for (const id of model.nodeIds) {
    byNode.set(id, 0);
  }

  for (const edge of model.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      const current = byNode.get(endpoint);
      if (current !== undefined) {
        byNode.set(endpoint, current + 1);
      }
    }
  }

  const degrees = [...byNode.values()];
  return {
    max: degrees.length === 0 ? 0 : Math.max(...degrees),
    median: median(degrees),
    byNode,
  };
}
