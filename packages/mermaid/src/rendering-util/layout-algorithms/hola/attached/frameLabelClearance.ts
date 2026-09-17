/**
 * Keep labels on straight, internal routes clear of the frame that owns them.
 *
 * Frames are fitted after labels have already chosen their tracks. Usually that
 * is harmless: a label can slide along a multi-segment route when the title band
 * arrives. A labelled edge that is itself a straight vertical or horizontal run
 * has no such freedom, though. If its track is close to a side border, the label
 * can straddle the frame despite there being ample room between its endpoints.
 * Moving the label independently would sever its visual association with the
 * edge, so slide both ports together along their existing node sides instead.
 */

import type { Point } from '../../../../types.js';
import type { Edge, Node } from '../../../types.js';
import { nodeBounds, type Bounds } from '../core/model.js';
import { polylineHitsBounds, segmentsCross } from './geometry.js';
import type { GridAttachedOptions } from './options.js';
import type { SubgraphModel } from './subgraphs.js';

const EPS = 1e-6;
const CORNER_INSET = 6;

interface LabelSize {
  width: number;
  height: number;
}

/**
 * Pull a labelled straight route away from a left/right (vertical route) or
 * top/bottom (horizontal route) border of its common containing frame.
 *
 * This is intentionally a post-routing correction rather than a reason to grow
 * the frame: growing it would make the group less compact and leave a parallel
 * pair visually off-centre. A move is accepted only when the ports remain clear
 * of node corners and the new corridor misses every other node, label, and route.
 */
export function clearStraightLabelsFromFrameBorders(
  edges: Edge[],
  nodes: Node[],
  labels: ReadonlyMap<string, LabelSize>,
  frames: ReadonlyMap<string, Bounds>,
  subgraphs: SubgraphModel,
  options: GridAttachedOptions
): void {
  const nodeById = new Map(
    nodes.filter((node) => node.isGroup !== true).map((node) => [node.id, node])
  );

  for (const edge of edges) {
    const label = labels.get(edge.id);
    const points = edge.points;
    if (
      !label ||
      edge.x === undefined ||
      edge.y === undefined ||
      !points ||
      points.length !== 2 ||
      !edge.start ||
      !edge.end
    ) {
      continue;
    }

    const frame = commonContainingFrame(edge.start, edge.end, frames, subgraphs);
    const startNode = nodeById.get(edge.start);
    const endNode = nodeById.get(edge.end);
    if (!frame || !startNode || !endNode) {
      continue;
    }

    const vertical = isVertical(points);
    const horizontal = isHorizontal(points);
    if (!vertical && !horizontal) {
      continue;
    }

    const coordinate = vertical ? edge.x : edge.y;
    const halfLabel = (vertical ? label.width : label.height) / 2;
    const low = (vertical ? frame.minX : frame.minY) + options.labelClearance + halfLabel;
    const high = (vertical ? frame.maxX : frame.maxY) - options.labelClearance - halfLabel;
    if (low > high + EPS) {
      continue;
    }

    const desired = Math.max(low, Math.min(high, coordinate));
    const delta = desired - coordinate;
    if (Math.abs(delta) < EPS) {
      continue;
    }

    // A wide label on the outer route can reach the parallel route beside it.
    // Shift that whole parallel band together: their relative separation was
    // chosen by the router, and moving only one track would spend it.
    const parallel = parallelBundle(edge, edges, vertical);
    if (
      parallel.length > 1 &&
      shiftParallelBundle(parallel, delta, vertical, edges, nodes, nodeById, labels, frame, options)
    ) {
      continue;
    }

    const startBounds = boundsOfNode(startNode);
    const endBounds = boundsOfNode(endNode);
    if (
      !startBounds ||
      !endBounds ||
      !canSlidePorts(points, vertical, startBounds, endBounds, desired)
    ) {
      continue;
    }

    const candidate = translate(points, vertical ? delta : 0, horizontal ? delta : 0);
    if (!candidateIsClear(candidate, edge, edges, nodes, label, options, EMPTY_EDGE_SET)) {
      continue;
    }

    edge.points = candidate;
    edge.x += vertical ? delta : 0;
    edge.y += horizontal ? delta : 0;
  }
}

const EMPTY_EDGE_SET: ReadonlySet<Edge> = new Set();

function parallelBundle(edge: Edge, edges: readonly Edge[], vertical: boolean): Edge[] {
  return edges.filter((other) => {
    const points = other.points;
    return (
      other.start === edge.start &&
      other.end === edge.end &&
      points !== undefined &&
      points.length === 2 &&
      (vertical ? isVertical(points) : isHorizontal(points))
    );
  });
}

function shiftParallelBundle(
  bundle: readonly Edge[],
  delta: number,
  vertical: boolean,
  edges: readonly Edge[],
  nodes: readonly Node[],
  nodeById: ReadonlyMap<string, Node>,
  labels: ReadonlyMap<string, LabelSize>,
  frame: Bounds,
  options: GridAttachedOptions
): boolean {
  const candidates = bundle.flatMap((edge) => {
    const points = edge.points;
    const start = edge.start ? nodeById.get(edge.start) : undefined;
    const end = edge.end ? nodeById.get(edge.end) : undefined;
    const startBounds = start ? boundsOfNode(start) : undefined;
    const endBounds = end ? boundsOfNode(end) : undefined;
    if (!points || !startBounds || !endBounds) {
      return [];
    }
    const candidate = translate(points, vertical ? delta : 0, vertical ? 0 : delta);
    const coordinate = vertical ? candidate[0].x : candidate[0].y;
    return canSlidePorts(points, vertical, startBounds, endBounds, coordinate)
      ? [{ edge, candidate }]
      : [];
  });
  if (candidates.length !== bundle.length) {
    return false;
  }

  const ignored = new Set(bundle);
  if (
    !candidates.every(({ edge, candidate }) => {
      const label = labels.get(edge.id);
      return (
        (label === undefined || labelHasFrameClearance(candidate, edge, label, frame, options)) &&
        candidateIsClear(candidate, edge, edges, nodes, label, options, ignored)
      );
    })
  ) {
    return false;
  }

  for (const { edge, candidate } of candidates) {
    edge.points = candidate;
    if (edge.x !== undefined) {
      edge.x += vertical ? delta : 0;
    }
    if (edge.y !== undefined) {
      edge.y += vertical ? 0 : delta;
    }
  }
  return true;
}

function commonContainingFrame(
  startId: string,
  endId: string,
  frames: ReadonlyMap<string, Bounds>,
  subgraphs: SubgraphModel
): Bounds | undefined {
  const endGroups = new Set(containingGroups(endId, subgraphs));
  for (const groupId of containingGroups(startId, subgraphs)) {
    if (endGroups.has(groupId)) {
      const frame = frames.get(groupId);
      if (frame) {
        return frame;
      }
    }
  }
  return undefined;
}

function containingGroups(nodeId: string, subgraphs: SubgraphModel): string[] {
  const groups: string[] = [];
  const seen = new Set<string>();
  let groupId = subgraphs.parentOfLeaf.get(nodeId);
  while (groupId !== undefined && !seen.has(groupId)) {
    seen.add(groupId);
    groups.push(groupId);
    groupId = subgraphs.byId.get(groupId)?.parentId;
  }
  return groups;
}

function isVertical(points: readonly Point[]): boolean {
  return Math.abs(points[0].x - points[1].x) < EPS && Math.abs(points[0].y - points[1].y) > EPS;
}

function isHorizontal(points: readonly Point[]): boolean {
  return Math.abs(points[0].y - points[1].y) < EPS && Math.abs(points[0].x - points[1].x) > EPS;
}

function canSlidePorts(
  points: readonly Point[],
  vertical: boolean,
  start: Bounds,
  end: Bounds,
  coordinate: number
): boolean {
  const firstOnSide = vertical
    ? onHorizontalSide(points[0], start)
    : onVerticalSide(points[0], start);
  const lastOnSide = vertical ? onHorizontalSide(points[1], end) : onVerticalSide(points[1], end);
  if (!firstOnSide || !lastOnSide) {
    return false;
  }

  const low = Math.max(
    vertical ? start.minX + CORNER_INSET : start.minY + CORNER_INSET,
    vertical ? end.minX + CORNER_INSET : end.minY + CORNER_INSET
  );
  const high = Math.min(
    vertical ? start.maxX - CORNER_INSET : start.maxY - CORNER_INSET,
    vertical ? end.maxX - CORNER_INSET : end.maxY - CORNER_INSET
  );
  return coordinate >= low - EPS && coordinate <= high + EPS;
}

function onHorizontalSide(point: Point, bounds: Bounds): boolean {
  return Math.abs(point.y - bounds.minY) < EPS || Math.abs(point.y - bounds.maxY) < EPS;
}

function onVerticalSide(point: Point, bounds: Bounds): boolean {
  return Math.abs(point.x - bounds.minX) < EPS || Math.abs(point.x - bounds.maxX) < EPS;
}

function translate(points: readonly Point[], dx: number, dy: number): Point[] {
  return points.map((point) => ({ x: point.x + dx, y: point.y + dy }));
}

function candidateIsClear(
  candidate: Point[],
  edge: Edge,
  edges: readonly Edge[],
  nodes: readonly Node[],
  label: LabelSize | undefined,
  options: GridAttachedOptions,
  ignoredEdges: ReadonlySet<Edge>
): boolean {
  if (
    nodes.some((node) => {
      if (node.isGroup === true || node.id === edge.start || node.id === edge.end) {
        return false;
      }
      const bounds = boundsOfNode(node);
      return (
        bounds !== undefined &&
        polylineHitsBounds(candidate, inflate(bounds, options.routingClearance))
      );
    })
  ) {
    return false;
  }

  if (label) {
    const labelBox = labelBoxAt(candidate, edge, label);
    const labelClearanceBox = inflate(labelBox, options.labelClearance);
    if (
      nodes.some((node) => {
        if (node.isGroup === true) {
          return false;
        }
        const bounds = boundsOfNode(node);
        return bounds !== undefined && boxesOverlap(labelClearanceBox, bounds);
      })
    ) {
      return false;
    }
    for (const other of edges) {
      if (other === edge || ignoredEdges.has(other)) {
        continue;
      }
      if (
        other.x !== undefined &&
        other.y !== undefined &&
        other.width !== undefined &&
        other.height !== undefined &&
        boxesOverlap(labelBox, {
          minX: other.x - other.width / 2,
          maxX: other.x + other.width / 2,
          minY: other.y - other.height / 2,
          maxY: other.y + other.height / 2,
        })
      ) {
        return false;
      }
      for (let index = 1; index < (other.points?.length ?? 0); index++) {
        if (
          polylineHitsBounds([other.points![index - 1], other.points![index]], labelClearanceBox)
        ) {
          return false;
        }
      }
    }
  }

  for (const other of edges) {
    if (other === edge || ignoredEdges.has(other) || !other.points || other.points.length < 2) {
      continue;
    }
    for (let index = 1; index < other.points.length; index++) {
      if (
        segmentsCross(
          { a: candidate[0], b: candidate[1] },
          { a: other.points[index - 1], b: other.points[index] }
        ) ||
        segmentsAreTooClose(candidate, other.points[index - 1], other.points[index], options)
      ) {
        return false;
      }
    }
  }

  return true;
}

function labelHasFrameClearance(
  candidate: readonly Point[],
  edge: Edge,
  label: LabelSize,
  frame: Bounds,
  options: GridAttachedOptions
): boolean {
  const box = labelBoxAt(candidate, edge, label);
  return (
    box.minX >= frame.minX + options.labelClearance - EPS &&
    box.maxX <= frame.maxX - options.labelClearance + EPS &&
    box.minY >= frame.minY + options.labelClearance - EPS &&
    box.maxY <= frame.maxY - options.labelClearance + EPS
  );
}

function labelBoxAt(candidate: readonly Point[], edge: Edge, label: LabelSize): Bounds {
  const x = isVertical(candidate) ? candidate[0].x : edge.x!;
  const y = isHorizontal(candidate) ? candidate[0].y : edge.y!;
  return {
    minX: x - label.width / 2,
    maxX: x + label.width / 2,
    minY: y - label.height / 2,
    maxY: y + label.height / 2,
  };
}

function segmentsAreTooClose(
  candidate: readonly Point[],
  first: Point,
  second: Point,
  options: GridAttachedOptions
): boolean {
  if (isVertical(candidate) && Math.abs(first.x - second.x) < EPS) {
    return (
      Math.abs(candidate[0].x - first.x) < options.routingClearance &&
      intervalsOverlap(candidate[0].y, candidate[1].y, first.y, second.y)
    );
  }
  if (isHorizontal(candidate) && Math.abs(first.y - second.y) < EPS) {
    return (
      Math.abs(candidate[0].y - first.y) < options.routingClearance &&
      intervalsOverlap(candidate[0].x, candidate[1].x, first.x, second.x)
    );
  }
  return false;
}

function intervalsOverlap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): boolean {
  return (
    Math.max(Math.min(firstStart, firstEnd), Math.min(secondStart, secondEnd)) <
    Math.min(Math.max(firstStart, firstEnd), Math.max(secondStart, secondEnd)) - EPS
  );
}

function inflate(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

function boxesOverlap(first: Bounds, second: Bounds): boolean {
  return (
    first.minX < second.maxX - EPS &&
    second.minX < first.maxX - EPS &&
    first.minY < second.maxY - EPS &&
    second.minY < first.maxY - EPS
  );
}

function boundsOfNode(node: Node): Bounds | undefined {
  if (
    node.x === undefined ||
    node.y === undefined ||
    node.width === undefined ||
    node.height === undefined
  ) {
    return undefined;
  }
  return nodeBounds({ x: node.x, y: node.y, width: node.width, height: node.height });
}
