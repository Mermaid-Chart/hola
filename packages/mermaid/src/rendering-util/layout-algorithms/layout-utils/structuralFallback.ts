/**
 * Structural pre-check: is this graph one the grid-like layouts should attempt?
 *
 * HOLA and gipsec both build a drawing around a planar, grid-aligned core. That
 * works well on the shape they were designed for — a modest graph with a clear
 * core and trees hanging off it — and degrades on graphs that violate its
 * premises, where the result is worse than a general-purpose layout would give.
 * Rather than produce a bad drawing, hand those to ELK.
 *
 * The check runs on the abstract graph before any layout, so it costs a DFS and
 * a degree count, never a discarded layout.
 */

import type { LayoutData } from '../../types.js';
import { isPlanar } from './planarity.js';

/** Layouts this pre-check applies to. Everything else dispatches unchanged. */
const GRID_LIKE_LAYOUTS: ReadonlySet<string> = new Set(['hola', 'gipsec']);

/** Where a graph that fails the pre-check is sent instead. */
export const STRUCTURAL_FALLBACK_LAYOUT = 'elk';

/** More than this many subgraphs and the core/tree decomposition stops helping. */
const MAX_SUBGRAPHS = 4;

/**
 * A hub this busy in a graph this large forces long detours around it, which is
 * where the grid-like routers lose to a general-purpose one. Both halves must
 * hold: a degree-5 node in a small graph is fine, and a large graph of low-degree
 * nodes is exactly what these layouts are for.
 */
const MIN_NODES_FOR_HUB_CHECK = 10;
const HUB_DEGREE = 5;

/** Why a graph was redirected. Ordered as evaluated; the first hit is reported. */
export type StructuralFallbackReason =
  | 'non-planar'
  | 'too-many-subgraphs'
  | 'large-with-high-degree-node';

export interface StructuralFallbackVerdict {
  /** True when the requested layout should be replaced by the fallback. */
  readonly fallback: boolean;
  /** Set only when `fallback` is true. */
  readonly reason?: StructuralFallbackReason;
  /** Human-readable detail for the log line. */
  readonly detail?: string;
}

const NO_FALLBACK: StructuralFallbackVerdict = { fallback: false };

/**
 * Undirected simple adjacency over the non-group nodes.
 *
 * Groups are excluded because they are containers, not vertices: counting them
 * would invent adjacency that the drawing never has to route. Self-loops and
 * parallel edges are dropped — neither changes planarity, and both would break
 * the Euler bound the planarity test relies on — and an edge to an unknown node
 * is skipped rather than inventing a vertex for it.
 */
function simpleAdjacency(data: LayoutData): Map<string, Set<string>> {
  const adjacency = new Map<string, Set<string>>();
  for (const node of data.nodes ?? []) {
    if (node?.id != null && !node.isGroup) {
      adjacency.set(String(node.id), new Set());
    }
  }
  for (const edge of data.edges ?? []) {
    if (edge?.start == null || edge?.end == null) {
      continue;
    }
    const start = String(edge.start);
    const end = String(edge.end);
    if (start === end) {
      continue;
    }
    const startNeighbours = adjacency.get(start);
    const endNeighbours = adjacency.get(end);
    if (!startNeighbours || !endNeighbours) {
      continue;
    }
    startNeighbours.add(end);
    endNeighbours.add(start);
  }
  return adjacency;
}

/**
 * Whether `layout` should give way to {@link STRUCTURAL_FALLBACK_LAYOUT} for this
 * graph.
 *
 * Returns `fallback: false` for any layout outside {@link GRID_LIKE_LAYOUTS}, so
 * this is safe to call on every render.
 *
 * The three conditions are independent — any one is enough — and they are
 * evaluated cheapest-first so a graph rejected on a count never pays for the
 * planarity DFS.
 */
export function structuralFallbackVerdict(
  data: LayoutData,
  layout: string
): StructuralFallbackVerdict {
  if (!GRID_LIKE_LAYOUTS.has(layout)) {
    return NO_FALLBACK;
  }

  const nodes = data.nodes ?? [];
  const subgraphCount = nodes.filter((node) => node?.isGroup).length;
  if (subgraphCount > MAX_SUBGRAPHS) {
    return {
      fallback: true,
      reason: 'too-many-subgraphs',
      detail: `${subgraphCount} subgraphs (> ${MAX_SUBGRAPHS})`,
    };
  }

  const adjacency = simpleAdjacency(data);

  if (adjacency.size > MIN_NODES_FOR_HUB_CHECK) {
    for (const [id, neighbours] of adjacency) {
      if (neighbours.size >= HUB_DEGREE) {
        return {
          fallback: true,
          reason: 'large-with-high-degree-node',
          detail: `${adjacency.size} nodes (> ${MIN_NODES_FOR_HUB_CHECK}) with "${id}" at degree ${neighbours.size} (>= ${HUB_DEGREE})`,
        };
      }
    }
  }

  if (!isPlanar(adjacency)) {
    return {
      fallback: true,
      reason: 'non-planar',
      detail: `${adjacency.size} nodes admit no planar embedding`,
    };
  }

  return NO_FALLBACK;
}
