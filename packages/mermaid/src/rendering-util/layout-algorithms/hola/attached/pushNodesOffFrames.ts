/**
 * Push leaf nodes away from foreign group frames they crowd.
 *
 * `validateLayout` wants `nodeGroupClearance` (30 by default) between a node and
 * the border of any group it does not belong to. Below that the node reads as
 * part of the container it is sitting against. HOLA has no notion of this rule
 * anywhere: nodes are placed, then frames are fitted around their members, and
 * nothing afterwards compares a frame to the foreign nodes beside it. So the gap
 * is whatever the two independent steps happen to leave — 26 on
 * `nested-subgraphs`, four short.
 *
 * ## Why this is safe to do after routing
 *
 * Moving a node normally invalidates every edge attached to it. This pass moves
 * one along a single axis and only when every attached edge can absorb that exact
 * motion:
 *
 * - An edge with a bend keeps its terminal leg's direction if the bend travels on
 *   the axis the leg is constant in; the leg's length changes and nothing else.
 * - A two-point edge has no bend to move, so it can only absorb motion PARALLEL
 *   to itself, which shortens or lengthens it. Motion across it would tilt it.
 * - **An edge carrying a label is refused outright.** A label is positioned
 *   against geometry this pass does not model, so moving the edge under it slides
 *   the label onto whatever is now there. A first version without this rule
 *   scored well and broke `architecture`'s "keeps every edge label off every node
 *   box" — a fixture in a corpus this loop does not even score.
 *
 * A node with any edge that cannot absorb the push is left where it is. So is one
 * whose new position would touch another node: trading `node-too-close-to-group`
 * for `node-overlap` is not an improvement.
 */
import type { Edge, LayoutData, Node } from '../../../types.js';

/** Matches `NODE_GROUP_CLEARANCE_DEFAULT` in `validateLayout`. */
const NODE_GROUP_CLEARANCE = 30;

/** Matches `NODE_NODE_PADDING`; a push may not crowd a neighbour below it. */
const NODE_NODE_PADDING = 30;

const FLAT = 1e-6;

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function rectOf(node: Node): Rect {
  return {
    left: node.x! - node.width! / 2,
    right: node.x! + node.width! / 2,
    top: node.y! - node.height! / 2,
    bottom: node.y! + node.height! / 2,
  };
}

/** The validator's own facing-gap rule: null for boxes that only meet diagonally. */
function facingGap(a: Rect, b: Rect): number | null {
  const xOverlap = a.left < b.right && b.left < a.right;
  const yOverlap = a.top < b.bottom && b.top < a.bottom;
  if (xOverlap && yOverlap) {
    return null;
  }
  if (xOverlap) {
    return a.top >= b.bottom ? a.top - b.bottom : b.top - a.bottom;
  }
  if (yOverlap) {
    return a.left >= b.right ? a.left - b.right : b.left - a.right;
  }
  return null;
}

function isAncestor(ancestorId: string, node: Node, byId: ReadonlyMap<string, Node>): boolean {
  const seen = new Set<string>();
  let cur: Node | undefined = node;
  while (cur?.parentId != null) {
    const pid = String(cur.parentId);
    if (seen.has(pid) || pid === ancestorId) {
      return pid === ancestorId;
    }
    seen.add(pid);
    cur = byId.get(pid);
  }
  return false;
}

/** Every endpoint of `edge` that attaches to `nodeId`, as point indices. */
function endpointsOn(edge: Edge, nodeId: string): number[] {
  const points = edge.points;
  if (!points || points.length < 2) {
    return [];
  }
  const out: number[] = [];
  if (edge.start === nodeId) {
    out.push(0);
  }
  if (edge.end === nodeId) {
    out.push(points.length - 1);
  }
  return out;
}

/**
 * Can every edge on this node absorb a push of (dx, dy)? If so, apply it.
 *
 * Checked and applied in two passes so a node is never left half-moved: an edge
 * that cannot take the motion aborts the whole push, including for edges already
 * examined.
 */
function pushNode(node: Node, edges: readonly Edge[], dx: number, dy: number): boolean {
  const moves: { points: { x: number; y: number }[]; indices: number[] }[] = [];
  for (const edge of edges) {
    if (edge.isLayoutOnly) {
      continue;
    }
    const indices = endpointsOn(edge, node.id);
    if (indices.length === 0) {
      continue;
    }
    if (edge.label !== undefined && edge.label !== '') {
      // The label sits where this pass cannot see it; moving the edge slides the
      // label onto whatever is now underneath.
      return false;
    }
    const points = edge.points!;
    if (points.length === 2) {
      // No bend to carry the leg: the push must run along the edge.
      const horizontal = Math.abs(points[0].y - points[1].y) < FLAT;
      const vertical = Math.abs(points[0].x - points[1].x) < FLAT;
      if ((horizontal && Math.abs(dy) > FLAT) || (vertical && Math.abs(dx) > FLAT)) {
        return false;
      }
      if (!horizontal && !vertical) {
        return false;
      }
    }
    moves.push({ points, indices });
  }

  for (const { points, indices } of moves) {
    for (const terminal of indices) {
      const bend = terminal === 0 ? 1 : points.length - 2;
      points[terminal].x += dx;
      points[terminal].y += dy;
      if (points.length > 2) {
        // Carry the bend on whichever axis the leg is constant in, so the leg
        // keeps its direction and only changes length.
        if (Math.abs(points[terminal].x - points[bend].x - dx) < FLAT) {
          points[bend].x += dx;
        }
        if (Math.abs(points[terminal].y - points[bend].y - dy) < FLAT) {
          points[bend].y += dy;
        }
      }
    }
  }
  node.x! += dx;
  node.y! += dy;
  return true;
}

/**
 * Move leaf nodes out of the clearance band of foreign group frames.
 *
 * Mutates node positions and the edge endpoints attached to them. Returns how
 * many nodes were moved.
 */
export function pushNodesOffForeignFrames(data: LayoutData): number {
  const nodes = data.nodes.filter(
    (node) => node.width && node.height && node.x !== undefined && node.y !== undefined
  );
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const leaves = nodes.filter((node) => !node.isGroup);
  const groups = nodes.filter((node) => node.isGroup);

  let moved = 0;
  for (const leaf of leaves) {
    for (const group of groups) {
      if (isAncestor(group.id, leaf, byId)) {
        continue;
      }
      const leafRect = rectOf(leaf);
      const groupRect = rectOf(group);
      const gap = facingGap(leafRect, groupRect);
      if (gap === null || gap >= NODE_GROUP_CLEARANCE) {
        continue;
      }
      const need = NODE_GROUP_CLEARANCE - gap;
      // Push directly away from the frame, along the axis they face on.
      const xOverlap = leafRect.left < groupRect.right && groupRect.left < leafRect.right;
      const dx = xOverlap ? 0 : leafRect.left >= groupRect.right ? need : -need;
      const dy = xOverlap ? (leafRect.top >= groupRect.bottom ? need : -need) : 0;

      const after: Rect = {
        left: leafRect.left + dx,
        right: leafRect.right + dx,
        top: leafRect.top + dy,
        bottom: leafRect.bottom + dy,
      };
      const crowds = nodes.some((other) => {
        if (other.id === leaf.id || other.isGroup) {
          return false;
        }
        const otherGap = facingGap(after, rectOf(other));
        return otherGap !== null && otherGap < NODE_NODE_PADDING;
      });
      if (crowds) {
        continue;
      }
      if (pushNode(leaf, data.edges, dx, dy)) {
        moved++;
        break;
      }
    }
  }
  return moved;
}
