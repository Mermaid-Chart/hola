/**
 * Give every edge touching one node side its own attachment point.
 *
 * The orthogonal router takes a `sourcePortOffset` / `targetPortOffset` per route
 * and defaults both to 0 — the centre of the chosen side. Tree connectors get real
 * offsets from `spreadPorts`; core edges never do. So every core edge arriving at
 * the same side of the same node attaches at the same point, departs in the same
 * direction, and runs the same `minTerminalLegLength` leg before diverging.
 *
 * `validateLayout` reports that one geometric fact as three separate hard issues —
 * `edge-same-port-departure`, `edge-shared-attachment-point` and
 * `edge-shared-subpath` — which is why the triple shows up together on every
 * fixture with a dense core.
 *
 * ## Why a post-pass rather than real port assignment
 *
 * Assigning offsets up front is the better fix and belongs in the router. It is
 * also a change to the step every route goes through, on a layout with no green
 * spec baseline to catch collateral. This moves the finished endpoints instead,
 * which is verifiable one fixture at a time.
 *
 * ## Why the moves are safe
 *
 * An endpoint is only slid ALONG the side it already attaches to, and its bend
 * moves with it, so the terminal leg keeps its direction and length and only
 * translates. The segment beyond the bend is perpendicular to that leg, so it
 * keeps its own axis and merely changes length. Anything that does not fit that
 * shape — a two-point edge with no bend, a bend that is not perpendicular, a side
 * too short to hold the spread — is left alone.
 */
import type { Point } from '../../../../types.js';
import type { Edge, Node } from '../../../types.js';

/**
 * Minimum separation between two attachment points on one side.
 *
 * `EPS_SHARED_ATTACH` in `validateLayout` is only 3, but clearing that alone
 * leaves the two terminal legs running parallel 3px apart for their whole length,
 * which trips `edge-parallel-segment-too-close` instead. 8 clears both.
 */
const MIN_PORT_GAP = 8;

/**
 * Two ports closer than this on one side count as contested.
 *
 * Matches `EPS_SHARED_ATTACH` in `validateLayout`, which is the bar for
 * `edge-shared-attachment-point`. An earlier version tested for exact coincidence
 * (0.5) and so only ever caught ports the router had placed at *identical*
 * offsets. `complete_graph_k4` puts three edges on one side of `A` at 176.36,
 * 177.70 and 190.36: the first two are 1.34 apart — flagged by the validator,
 * invisible to a coincidence test, and the reason that fixture survived the pass
 * that was written for it.
 */
const SHARED_ATTACH = 3;

/** Float slack for deciding a segment is axis-aligned. */
const FLAT = 1e-6;

type SideAxis = 'x' | 'y';

interface Attachment {
  edge: Edge;
  /** Index of the node-attached point. */
  terminal: number;
  /** Index of the bend that must travel with it, or -1 when pinned. */
  bend: number;
  /** The axis the port slides along: `x` for top/bottom sides, `y` for left/right. */
  axis: SideAxis;
  at: number;
  /**
   * Can this endpoint be slid at all?
   *
   * A two-point edge has no bend to carry its leg, and its other end is on a
   * different node, so sliding one end would tilt the whole edge off-axis. Such an
   * endpoint still OCCUPIES its port though — it is the reason the port is
   * contested — so it is collected as pinned and the movable ones route around it.
   * Dropping them from the group instead is what made the first version of this
   * pass a no-op on `domus1`: the straight edge was invisible, so nothing collided.
   */
  pinned: boolean;
  /** Where the route heads after leaving, used to break ties toward its own side. */
  towards: number;
}

function rectOf(node: Node) {
  return {
    left: node.x! - node.width! / 2,
    right: node.x! + node.width! / 2,
    top: node.y! - node.height! / 2,
    bottom: node.y! + node.height! / 2,
  };
}

/**
 * The side `point` sits on, as the axis a port would slide along, or undefined if
 * the point is not on the node's boundary at all.
 */
function sideAxisOf(point: Point, node: Node): SideAxis | undefined {
  const rect = rectOf(node);
  if (Math.abs(point.y - rect.top) < 1 || Math.abs(point.y - rect.bottom) < 1) {
    return 'x';
  }
  if (Math.abs(point.x - rect.left) < 1 || Math.abs(point.x - rect.right) < 1) {
    return 'y';
  }
  return undefined;
}

/** Collect this edge's two endpoints, pinned or movable. */
function attachmentsOf(
  edge: Edge,
  nodeById: ReadonlyMap<string, Node>
): { key: string; attachment: Attachment }[] {
  const points = edge.points;
  if (!points || points.length < 2) {
    return [];
  }
  const out: { key: string; attachment: Attachment }[] = [];
  const ends: [number, number, string | undefined][] = [
    [0, 1, edge.start],
    [points.length - 1, points.length - 2, edge.end],
  ];
  for (const [terminal, bend, nodeId] of ends) {
    const node = nodeId === undefined ? undefined : nodeById.get(nodeId);
    if (!node?.width || !node.height || node.x === undefined || node.y === undefined) {
      continue;
    }
    const axis = sideAxisOf(points[terminal], node);
    if (!axis) {
      continue;
    }
    const along = (point: Point) => (axis === 'x' ? point.x : point.y);
    const across = (point: Point) => (axis === 'x' ? point.y : point.x);

    // Movable needs three things: a bend of its own (so a two-point edge is out),
    // a leg perpendicular to the side, and a segment past the bend perpendicular to
    // the leg. Anything else is pinned — still occupying the port, just immovable.
    let pinned = points.length < 3;
    if (!pinned) {
      const legFlat = Math.abs(along(points[terminal]) - along(points[bend])) < FLAT;
      const beyond = terminal === 0 ? points[2] : points[points.length - 3];
      const beyondFlat = Math.abs(across(beyond) - across(points[bend])) < FLAT;
      pinned = !legFlat || !beyondFlat;
    }
    const next = terminal === 0 ? points[1] : points[points.length - 2];
    const far =
      points.length >= 3 ? (terminal === 0 ? points[2] : points[points.length - 3]) : next;
    out.push({
      key: `${nodeId}|${axis}|${Math.round(across(points[terminal]))}`,
      attachment: {
        edge,
        terminal,
        bend,
        axis,
        at: along(points[terminal]),
        pinned,
        towards: along(far),
      },
    });
  }
  return out;
}

/** Slide one attachment and its bend to `target` along the side. */
function slide(attachment: Attachment, target: number): void {
  const points = attachment.edge.points!;
  if (attachment.axis === 'x') {
    points[attachment.terminal].x = target;
    points[attachment.bend].x = target;
  } else {
    points[attachment.terminal].y = target;
    points[attachment.bend].y = target;
  }
  attachment.at = target;
}

/**
 * Spread edges that share an attachment point so each gets its own.
 *
 * Mutates `edge.points` in place. Returns how many endpoints were moved.
 */
export function spreadSharedAttachmentPoints(
  edges: readonly Edge[],
  nodes: readonly Node[]
): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const groups = new Map<string, Attachment[]>();
  for (const edge of edges) {
    if (edge.isLayoutOnly) {
      continue;
    }
    for (const { key, attachment } of attachmentsOf(edge, nodeById)) {
      const group = groups.get(key);
      if (group) {
        group.push(attachment);
      } else {
        groups.set(key, [attachment]);
      }
    }
  }

  let moved = 0;
  for (const [key, group] of groups) {
    if (group.length < 2) {
      continue;
    }
    group.sort((a, b) => a.at - b.at);
    const collides = group.some(
      (a, i) => i > 0 && Math.abs(a.at - group[i - 1].at) < SHARED_ATTACH
    );
    if (!collides) {
      continue;
    }

    const nodeId = key.slice(0, key.indexOf('|'));
    const node = nodeById.get(nodeId)!;
    const axis = group[0].axis;
    const half = (axis === 'x' ? node.width! : node.height!) / 2;
    const centre = axis === 'x' ? node.x! : node.y!;
    const span = Math.max(0, half - 1);
    if (MIN_PORT_GAP * (group.length - 1) > span * 2) {
      // A side that cannot hold the spread keeps what it has: a port pushed past a
      // corner is a worse drawing than two ports sharing one.
      continue;
    }

    // Pinned endpoints hold their positions; movable ones take the nearest free
    // slot on the side's own lattice, preferring the direction their route leaves in
    // so a route is not sent the long way round its own node.
    const taken = group.filter((a) => a.pinned).map((a) => a.at);
    const slots: number[] = [];
    for (let k = -group.length; k <= group.length; k++) {
      const slot = centre + k * MIN_PORT_GAP;
      if (Math.abs(slot - centre) <= span) {
        slots.push(slot);
      }
    }
    for (const attachment of group) {
      if (attachment.pinned) {
        continue;
      }
      const free = slots
        .filter((slot) => taken.every((t) => Math.abs(slot - t) >= MIN_PORT_GAP - FLAT))
        .sort((a, b) => {
          const byTravel = Math.abs(a - attachment.towards) - Math.abs(b - attachment.towards);
          return byTravel !== 0
            ? byTravel
            : Math.abs(a - attachment.at) - Math.abs(b - attachment.at);
        });
      if (free.length === 0) {
        continue;
      }
      const target = free[0];
      taken.push(target);
      if (Math.abs(target - attachment.at) > FLAT) {
        slide(attachment, target);
        moved++;
      }
    }
  }
  return moved;
}

/**
 * Minimum inset of an attachment point from the corners of its own side.
 *
 * `EPS_CORNER` in `validateLayout` is 3; this clears it with enough margin that a
 * rounding difference cannot put the point back on the corner. An edge meeting a
 * box exactly at its corner gives the reader no cue which side it belongs to, and
 * the arrowhead renders over two borders at once.
 */
const CORNER_INSET = 6;

/**
 * Pull attachment points off the corners of the side they attach to.
 *
 * Runs after the spread, because spreading is what pushes a contested port out
 * towards a corner in the first place; ordering it before would let the spread put
 * back what this removed. Uses the same sliding rule — endpoint and bend together,
 * along the side — so it inherits the same safety: a pinned endpoint is never
 * moved, and a side too narrow to hold the inset on both ends is left alone.
 */
export function nudgePortsOffCorners(edges: readonly Edge[], nodes: readonly Node[]): number {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  let moved = 0;
  for (const edge of edges) {
    if (edge.isLayoutOnly) {
      continue;
    }
    if (moveStraightEdgeOffCorners(edge, nodeById)) {
      moved++;
      continue;
    }
    for (const { attachment } of attachmentsOf(edge, nodeById)) {
      if (attachment.pinned) {
        continue;
      }
      const node = nodeById.get(attachment.terminal === 0 ? edge.start! : edge.end!);
      if (!node) {
        continue;
      }
      const axis = attachment.axis;
      const half = (axis === 'x' ? node.width! : node.height!) / 2;
      const centre = axis === 'x' ? node.x! : node.y!;
      if (half <= CORNER_INSET) {
        // Nowhere to put it: the whole side is inside the inset.
        continue;
      }
      const target = Math.max(
        centre - half + CORNER_INSET,
        Math.min(centre + half - CORNER_INSET, attachment.at)
      );
      if (Math.abs(target - attachment.at) > FLAT) {
        slide(attachment, target);
        moved++;
      }
    }
  }
  return moved;
}

/** The band of a side that is clear of both its corners, or null if there is none. */
function insetBand(node: Node, axis: SideAxis): { min: number; max: number } | null {
  const half = (axis === 'x' ? node.width! : node.height!) / 2;
  if (half <= CORNER_INSET) {
    return null;
  }
  const centre = axis === 'x' ? node.x! : node.y!;
  return { min: centre - half + CORNER_INSET, max: centre + half - CORNER_INSET };
}

/**
 * Move a two-point straight edge off both its corners at once.
 *
 * Such an edge is pinned for every other purpose — its ends are on different
 * nodes, so moving one alone tilts it off-axis. But when both ends sit on
 * PARALLEL opposite sides, moving both by the same amount keeps it straight and
 * axis-aligned, which is the one case where a pinned endpoint can be repaired.
 *
 * `nested-sg-outgoing-4` is exactly this: a single `a --> b` whose ends land 1px
 * above the bottom-right and bottom-left corners of two boxes of equal height.
 */
function moveStraightEdgeOffCorners(edge: Edge, nodeById: ReadonlyMap<string, Node>): boolean {
  const points = edge.points;
  if (!points || points.length !== 2) {
    return false;
  }
  const source = edge.start === undefined ? undefined : nodeById.get(edge.start);
  const target = edge.end === undefined ? undefined : nodeById.get(edge.end);
  if (!source?.width || !source.height || !target?.width || !target.height) {
    return false;
  }
  const axis = sideAxisOf(points[0], source);
  if (!axis || sideAxisOf(points[1], target) !== axis) {
    return false;
  }
  const at = axis === 'x' ? points[0].x : points[0].y;
  const other = axis === 'x' ? points[1].x : points[1].y;
  if (Math.abs(at - other) > FLAT) {
    // Not a straight run along the shared axis; moving both ends would not keep it so.
    return false;
  }
  const a = insetBand(source, axis);
  const b = insetBand(target, axis);
  if (!a || !b) {
    return false;
  }
  const min = Math.max(a.min, b.min);
  const max = Math.min(a.max, b.max);
  if (min > max) {
    // The two clear bands do not overlap: no single position suits both ends.
    return false;
  }
  const to = Math.max(min, Math.min(max, at));
  if (Math.abs(to - at) <= FLAT) {
    return false;
  }
  if (axis === 'x') {
    points[0].x = to;
    points[1].x = to;
  } else {
    points[0].y = to;
    points[1].y = to;
  }
  return true;
}
