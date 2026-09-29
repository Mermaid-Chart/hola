/**
 * Turn a captured `LayoutData` into the plain graph the metrics are computed on.
 *
 * Two things make this more than a field rename:
 *
 * 1. **Edge-label placeholders.** Some layouts (HOLA, and the swimlane router)
 *    reserve space for an edge label by injecting a node for it and splitting the
 *    edge into `source → label → target`. Counted naively that turns one
 *    connection between two nodes into two connections between three, which would
 *    make every degree, ratio and planarity answer depend on which layout ran.
 *    So placeholder nodes are collapsed back into the edge they came from.
 *
 * 2. **Subgraphs as endpoints.** `A --> SomeSubgraph` is legal Mermaid. The group
 *    is a real thing the layout has to connect, so it becomes a vertex of the
 *    topology graph — but it is *not* counted in `nodeCount`, which the lab
 *    defines as pure (non-group, non-label) nodes.
 */

import type { GraphModel, LabEdge, LabLayoutData, LabNode, NormalizedEdge } from './types.js';

/** Mirrors `isLabelDummy` in `layout-utils/validateLayout.ts`, plus `isLabelNode`. */
export function isLabelPlaceholder(node: LabNode): boolean {
  return (
    node.isEdgeLabel === true ||
    node.isLabelNode === true ||
    node.isDummy === true ||
    (typeof node.id === 'string' && node.id.startsWith('edge-label-'))
  );
}

function edgeSource(edge: LabEdge): string | undefined {
  return edge.source ?? edge.start;
}

function edgeTarget(edge: LabEdge): string | undefined {
  return edge.target ?? edge.end;
}

function edgeLabel(edge: LabEdge): string {
  const raw = edge.label ?? edge.text ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function nodeLabel(node: LabNode | undefined): string {
  const raw = node?.label ?? '';
  return typeof raw === 'string' ? raw.trim() : '';
}

function hasPosition(node: LabNode): boolean {
  return Number.isFinite(node.x) && Number.isFinite(node.y);
}

/**
 * Build the metrics graph.
 *
 * Safe to call on a pre-layout `LayoutData` too: everything except `positions`
 * is structural, and `positions` simply comes back empty.
 */
export function buildGraphModel(layout: LabLayoutData): GraphModel {
  const nodes = Array.isArray(layout?.nodes) ? layout.nodes : [];
  const rawEdges = Array.isArray(layout?.edges) ? layout.edges : [];

  const byId = new Map<string, LabNode>();
  for (const node of nodes) {
    if (node && typeof node.id === 'string') {
      byId.set(node.id, node);
    }
  }

  const groupIds: string[] = [];
  const labelIds = new Set<string>();
  const pureIds: string[] = [];
  for (const node of byId.values()) {
    if (isLabelPlaceholder(node)) {
      labelIds.add(node.id);
    } else if (node.isGroup) {
      groupIds.push(node.id);
    } else {
      pureIds.push(node.id);
    }
  }

  // ── Pass 1: keep only edges that could be real connections ─────────────────
  interface Pending {
    id: string;
    source: string;
    target: string;
    label: string;
  }
  const pending: Pending[] = [];
  let danglingEdgeCount = 0;
  for (const [index, edge] of rawEdges.entries()) {
    if (!edge || edge.isLayoutOnly) {
      continue;
    }
    const source = edgeSource(edge);
    const target = edgeTarget(edge);
    if (typeof source !== 'string' || typeof target !== 'string') {
      danglingEdgeCount++;
      continue;
    }
    // An edge routed *through* a label node (rather than split around it) already
    // names its true endpoints, so only the label text needs recovering.
    const routedLabel = edge.labelNodeId ? nodeLabel(byId.get(edge.labelNodeId)) : '';
    pending.push({
      id: typeof edge.id === 'string' && edge.id ? edge.id : `edge-${index}`,
      source,
      target,
      label: edgeLabel(edge) || routedLabel,
    });
  }

  // ── Pass 2: collapse `source → label → target` back into `source → target` ──
  const incoming = new Map<string, Pending[]>();
  const outgoing = new Map<string, Pending[]>();
  for (const edge of pending) {
    if (labelIds.has(edge.target)) {
      const bucket = incoming.get(edge.target);
      if (bucket) {
        bucket.push(edge);
      } else {
        incoming.set(edge.target, [edge]);
      }
    }
    if (labelIds.has(edge.source)) {
      const bucket = outgoing.get(edge.source);
      if (bucket) {
        bucket.push(edge);
      } else {
        outgoing.set(edge.source, [edge]);
      }
    }
  }

  const consumed = new Set<Pending>();
  const merged: Pending[] = [];
  const collapsedLabelNodeIds: string[] = [];
  for (const labelId of labelIds) {
    const ins = incoming.get(labelId) ?? [];
    const outs = outgoing.get(labelId) ?? [];
    if (ins.length !== 1 || outs.length !== 1) {
      // Not the split-edge shape this collapse understands. The halves are still
      // dropped below, because a connection to a label placeholder is never a
      // connection between two diagram nodes.
      continue;
    }
    const [into] = ins;
    const [outOf] = outs;
    consumed.add(into);
    consumed.add(outOf);
    collapsedLabelNodeIds.push(labelId);
    merged.push({
      id: into.id,
      source: into.source,
      target: outOf.target,
      label: into.label || outOf.label || nodeLabel(byId.get(labelId)),
    });
  }

  // ── Pass 3: settle the vertex set, then emit ───────────────────────────────
  const vertexSet = new Set(pureIds);
  const endpointGroups = new Set<string>();
  const candidates = [...pending.filter((e) => !consumed.has(e)), ...merged];

  const edges: NormalizedEdge[] = [];
  for (const edge of candidates) {
    if (labelIds.has(edge.source) || labelIds.has(edge.target)) {
      // A half-edge whose partner was missing: not a node-to-node connection.
      continue;
    }
    const sourceKnown = byId.has(edge.source);
    const targetKnown = byId.has(edge.target);
    if (!sourceKnown || !targetKnown) {
      danglingEdgeCount++;
      continue;
    }
    for (const endpoint of [edge.source, edge.target]) {
      if (!vertexSet.has(endpoint)) {
        vertexSet.add(endpoint);
        endpointGroups.add(endpoint);
      }
    }
    edges.push({ id: edge.id, source: edge.source, target: edge.target, label: edge.label });
  }

  const parentOf = new Map<string, string | undefined>();
  for (const node of byId.values()) {
    parentOf.set(node.id, typeof node.parentId === 'string' ? node.parentId : undefined);
  }

  const positions = new Map<string, { x: number; y: number; width: number; height: number }>();
  for (const id of vertexSet) {
    const node = byId.get(id);
    if (node && hasPosition(node)) {
      positions.set(id, {
        x: node.x!,
        y: node.y!,
        width: Number.isFinite(node.width) ? node.width! : 0,
        height: Number.isFinite(node.height) ? node.height! : 0,
      });
    }
  }

  return {
    // Ordered for determinism: pure nodes in declaration order, then any group
    // that turned out to be an endpoint.
    nodeIds: pureIds,
    groupIds,
    edges,
    parentOf,
    positions,
    collapsedLabelNodeIds,
    danglingEdgeCount,
  };
}

/** Every vertex of the topology graph: pure nodes plus groups used as endpoints. */
export function topologyVertices(model: GraphModel): string[] {
  const seen = new Set(model.nodeIds);
  const out = [...model.nodeIds];
  for (const edge of model.edges) {
    for (const endpoint of [edge.source, edge.target]) {
      if (!seen.has(endpoint)) {
        seen.add(endpoint);
        out.push(endpoint);
      }
    }
  }
  return out;
}

/**
 * Undirected adjacency over the topology vertices.
 *
 * Self-loops and parallel edges are dropped: neither changes planarity,
 * connectivity or graph distance, and keeping them would make the "is it a
 * tree" edge count wrong.
 */
export function simpleAdjacency(model: GraphModel): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const id of topologyVertices(model)) {
    adjacency.set(id, new Set());
  }
  for (const edge of model.edges) {
    if (edge.source === edge.target) {
      continue;
    }
    adjacency.get(edge.source)?.add(edge.target);
    adjacency.get(edge.target)?.add(edge.source);
  }
  return adjacency;
}

/** Bounding box of every positioned vertex, or `null` when nothing is positioned. */
export function drawingBounds(
  layout: LabLayoutData
): { width: number; height: number; area: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let seen = 0;

  for (const node of Array.isArray(layout?.nodes) ? layout.nodes : []) {
    if (!node || !hasPosition(node)) {
      continue;
    }
    const halfWidth = (Number.isFinite(node.width) ? node.width! : 0) / 2;
    const halfHeight = (Number.isFinite(node.height) ? node.height! : 0) / 2;
    minX = Math.min(minX, node.x! - halfWidth);
    maxX = Math.max(maxX, node.x! + halfWidth);
    minY = Math.min(minY, node.y! - halfHeight);
    maxY = Math.max(maxY, node.y! + halfHeight);
    seen++;
  }

  if (seen === 0) {
    return null;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  return { width, height, area: width * height };
}
