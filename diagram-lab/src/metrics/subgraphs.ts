/**
 * Subgraph containment, and the edges that pierce it.
 *
 * "An edge going into the nodes inside a subgraph" means an edge with exactly
 * one endpoint among that subgraph's descendants — it has to cross the frame to
 * be drawn. Edges wholly inside a subgraph, and edges wholly outside it, cross
 * nothing. An edge that ends *on* the subgraph container itself is attached to
 * the frame rather than piercing it, so it does not count either.
 *
 * Nesting is handled by walking the ancestor chain: an edge from outside `Outer`
 * to a node inside `Outer > Inner` pierces both frames, and both are reported.
 */

import type { GraphModel } from './types.js';

export interface SubgraphStats {
  groupCount: number;
  hasSubgraphs: boolean;
  /** Edges that cross at least one subgraph frame. */
  boundaryEdgeCount: number;
  /** Subgraphs reached from outside, in declaration order. */
  piercedSubgraphIds: string[];
}

/** Every group enclosing `nodeId`, innermost first. */
export function ancestorGroups(nodeId: string, model: GraphModel): string[] {
  const chain: string[] = [];
  const seen = new Set<string>([nodeId]);
  let current = model.parentOf.get(nodeId);
  while (typeof current === 'string' && !seen.has(current)) {
    seen.add(current);
    chain.push(current);
    current = model.parentOf.get(current);
  }
  return chain;
}

export function computeSubgraphStats(model: GraphModel): SubgraphStats {
  const groupIds = new Set(model.groupIds);
  const pierced = new Set<string>();
  let boundaryEdgeCount = 0;

  for (const edge of model.edges) {
    if (edge.source === edge.target) {
      continue;
    }
    // An endpoint that *is* a group sits on the frame, so the frame it sits on
    // is not pierced — but any outer frame it is nested in still can be.
    const sourceGroups = new Set(ancestorGroups(edge.source, model));
    const targetGroups = new Set(ancestorGroups(edge.target, model));

    let crossesSomething = false;
    for (const group of [...sourceGroups, ...targetGroups]) {
      if (!groupIds.has(group)) {
        continue;
      }
      const inSource = sourceGroups.has(group);
      const inTarget = targetGroups.has(group);
      if (inSource !== inTarget) {
        crossesSomething = true;
        pierced.add(group);
      }
    }
    if (crossesSomething) {
      boundaryEdgeCount++;
    }
  }

  return {
    groupCount: model.groupIds.length,
    hasSubgraphs: model.groupIds.length > 0,
    boundaryEdgeCount,
    piercedSubgraphIds: model.groupIds.filter((id) => pierced.has(id)),
  };
}
