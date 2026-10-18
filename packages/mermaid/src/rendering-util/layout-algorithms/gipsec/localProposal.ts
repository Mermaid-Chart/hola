import type { Edge, Node } from '../../types.js';

/** Measurement validity is independent of a pass's port/constraint policy. */
export function measuredLocalEdge(edge: Edge): boolean {
  return [edge.width ?? 0, edge.height ?? 0].every((size) => Number.isFinite(size) && size >= 0);
}

/** Local preferences must never override a caller's routing constraints. */
export function constrainedLocalEdge(edge: Edge): boolean {
  return (
    edge.startSide !== undefined ||
    edge.endSide !== undefined ||
    (edge.minlen ?? 1) > 1 ||
    edge.isLayoutOnly === true ||
    !measuredLocalEdge(edge)
  );
}

/** A local placement requires finite, measured geometry, including titles. */
export function measuredLocalNode(node: Node): boolean {
  return (
    [node.x, node.y, node.width, node.height].every(Number.isFinite) &&
    node.width! > 0 &&
    node.height! > 0 &&
    (!node.labelBBox ||
      [node.labelBBox.width, node.labelBBox.height].every(
        (size) => Number.isFinite(size) && size >= 0
      ))
  );
}

const GEOMETRY_FIELDS = ['x', 'y', 'width', 'height'] as const;

/**
 * Commit a synchronous, geometry-only proposal if its own safety checks pass.
 * Callers supply every node they may move/refit, including enclosing frames.
 * Route/caption policies remain caller-owned; no DOM-bearing data is cloned.
 * Rejection or an exception restores the original properties on the same nodes.
 * Exceptions still propagate so programming errors are never hidden as fallback.
 */
export function acceptLocalGeometryProposal(
  affected: Iterable<Node>,
  propose: () => boolean
): boolean {
  const nodes = [...new Set(affected)];
  if (!nodes.every(measuredLocalNode)) {
    return false;
  }
  const before = nodes.map((node) => ({
    node,
    properties: GEOMETRY_FIELDS.map((field) => Object.getOwnPropertyDescriptor(node, field)),
  }));
  let accepted = false;
  try {
    accepted = propose() && nodes.every(measuredLocalNode);
    return accepted;
  } finally {
    if (!accepted) {
      for (const { node, properties } of before) {
        GEOMETRY_FIELDS.forEach((field, index) => {
          const property = properties[index];
          if (property) {
            Object.defineProperty(node, field, property);
          } else {
            delete node[field];
          }
        });
      }
    }
  }
}
