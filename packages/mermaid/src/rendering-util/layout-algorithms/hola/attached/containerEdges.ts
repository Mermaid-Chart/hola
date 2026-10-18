/**
 * Edges that name a subgraph.
 *
 * Mermaid lets an edge point at a container — `A --> C` where `C` is a subgraph —
 * and the layout graph has nowhere to put it, because a container is not a node the
 * decomposition sees. The `core/` stage drops such an edge and says so (guide §3.2),
 * which is the right answer for a layout that does not draw containers. Here it is
 * the wrong one twice over: the connection disappears from the diagram, and the
 * graph loses an edge that was holding the container's members together, so they
 * fall into separate components and scatter.
 *
 * So the edge is kept, in two steps that happen at opposite ends of the pipeline.
 *
 * **Before the topology is built**, the container endpoint is moved to one of its
 * members. That is what puts the edge back into the graph: the decomposition, the
 * core and the trees all see an ordinary edge between two leaves, and the container
 * stops being a hole in the connectivity.
 *
 * **After everything is drawn**, the endpoint is put back and the drawn route is cut
 * where it crosses the container's frame. What the reader sees is then what Mermaid
 * means by the syntax — an arrow meeting the box — while every stage in between
 * worked on a graph it understands.
 *
 * The member chosen is the first in input order rather than the nearest one, because
 * the choice has to be made before anything has a position. It affects which side
 * the route approaches from and nothing else: the route is cut at the frame either
 * way.
 *
 * Fitting a frame can leave that trimmed endpoint on a corner or consume its
 * terminal run. The final routing pass chooses ports from the interior of each
 * face, treats sibling frames as obstacles, and coordinates the visible edges
 * against the fitted geometry. Ancestor frames remain traversable boundaries.
 */

import type { Point } from '../../../../types.js';
import type { Edge, LayoutData, Node } from '../../../types.js';
import { nodeBounds, type Bounds, type Rect, type Side } from '../core/model.js';
import type { GridAttachedOptions } from './options.js';
import type { RouterConfig, RouterObstacle } from '../core/routing/orthogonalRouter.js';
import {
  routeAlternatives,
  obstaclePort,
  segmentsOf,
  countCrossings,
  countCollinearOverlaps,
} from '../core/routing/orthogonalRouter.js';
import { sampleSilhouette, silhouetteBand } from '../core/adapter/silhouette.js';
import { polylineCrossesSegment, polylineHitsBounds } from './geometry.js';
import { FULL_ROUNDED_CORNER_RUN } from './roundedCorners.js';

/** Coordinates closer than this are the same coordinate. */
const EPS = 1e-6;
/**
 * The final leg must hold a complete 12px rounded corner. Anything shorter
 * collapses the arc into a sharp angle at paint time.
 */
const MIN_FRAME_TERMINAL_RUN = FULL_ROUNDED_CORNER_RUN;

/** One edge whose endpoint named a container, and what it named. */
export interface ContainerEdge {
  edge: Edge;
  /** Container the start named, if it named one. */
  startContainer?: string;
  /** Container the end named, if it named one. */
  endContainer?: string;
}

/**
 * Move every container endpoint onto a member, in place, and report what was moved.
 *
 * An edge whose two endpoints resolve to the same member is left alone and reported
 * as unresolvable: a container and something inside it are not two places, so there
 * is no line to draw between them.
 */
export function redirectContainerEdges(data: LayoutData): {
  redirected: ContainerEdge[];
  unresolvable: Edge[];
} {
  const nodes = data.nodes ?? [];
  const containers = new Set(nodes.filter((node) => node.isGroup === true).map((node) => node.id));
  if (containers.size === 0) {
    return { redirected: [], unresolvable: [] };
  }

  const memberOf = representativeMembers(nodes, containers);
  const redirected: ContainerEdge[] = [];
  const unresolvable: Edge[] = [];

  for (const edge of data.edges ?? []) {
    const startContainer =
      edge.start !== undefined && containers.has(edge.start) ? edge.start : undefined;
    const endContainer = edge.end !== undefined && containers.has(edge.end) ? edge.end : undefined;
    if (startContainer === undefined && endContainer === undefined) {
      continue;
    }

    const start = startContainer ? memberOf.get(startContainer) : edge.start;
    const end = endContainer ? memberOf.get(endContainer) : edge.end;
    // A container with nothing in it has no member to stand in for it, and an edge
    // from a container to its own child collapses to a node pointing at itself.
    if (start === undefined || end === undefined || start === end) {
      unresolvable.push(edge);
      continue;
    }

    redirected.push({ edge, startContainer, endContainer });
    edge.start = start;
    edge.end = end;
  }

  return { redirected, unresolvable };
}

/**
 * Put the container endpoints back and cut each route at the frame it should meet.
 *
 * `frames` holds only the containers that were actually drawn. An edge naming one
 * that was not keeps the member it was redirected to: that is where the line
 * genuinely ends, and pointing it at a box nobody drew would be worse.
 */
export function restoreContainerEdges(
  redirected: readonly ContainerEdge[],
  frames: ReadonlyMap<string, Bounds>
): void {
  for (const { edge, startContainer, endContainer } of redirected) {
    if (startContainer !== undefined) {
      edge.start = startContainer;
    }
    if (endContainer !== undefined) {
      edge.end = endContainer;
    }

    if (!edge.points || edge.points.length < 2) {
      continue;
    }
    let route: Point[] = edge.points;

    // The end first, so trimming the start cannot invalidate an index into the tail.
    if (endContainer !== undefined) {
      const frame = frames.get(endContainer);
      if (frame) {
        route = trimToFrame(route, frame, 'end');
      }
    }
    if (startContainer !== undefined) {
      const frame = frames.get(startContainer);
      if (frame) {
        route = trimToFrame(route, frame, 'start');
      }
    }
    edge.points = route;

    // The label was placed along the untrimmed route, by a pass that weighed it
    // against every node and every other route in the drawing. That work is worth
    // keeping: it is only wrong if the trim took away the part of the route the
    // label was sitting on, which leaves it inside a frame its edge stops at.
    const orphaned =
      edge.x !== undefined &&
      edge.y !== undefined &&
      [startContainer, endContainer].some((id) => {
        const frame = id !== undefined ? frames.get(id) : undefined;
        return frame !== undefined && inside({ x: edge.x!, y: edge.y! }, frame);
      });
    if (orphaned) {
      const middle = route[Math.floor(route.length / 2)];
      if (middle) {
        edge.x = middle.x;
        edge.y = middle.y;
      }
    }
  }
}

/**
 * The foreign-frame avoidance pass can replace a route after it was clipped to a
 * container. Reassert the rounded terminal runway on the final visible route.
 */
export function preserveContainerTerminalRuns(redirected: readonly ContainerEdge[]): void {
  for (const { edge, startContainer, endContainer } of redirected) {
    if (!edge.points || edge.points.length < 3) {
      continue;
    }
    // A short inter-frame bridge cannot always make both terminal runs large
    // without moving nodes. Preserve the terminal that actually owns the marker:
    // flowchart arrows default to the end, while class inheritance can put it at
    // the start. Extending both in sequence would simply undo the first repair.
    const markerAtStart = edge.arrowTypeStart !== undefined && edge.arrowTypeStart !== 'none';
    const markerAtEnd = edge.arrowTypeEnd === undefined || edge.arrowTypeEnd !== 'none';
    if (endContainer !== undefined && markerAtEnd) {
      edge.points = extendFrameTerminalRun(edge.points);
    } else if (startContainer !== undefined && markerAtStart) {
      edge.points = extendFrameTerminalRun([...edge.points].reverse()).reverse();
    }
  }
}

/**
 * Prefer a straight bridge for a container edge when the endpoint boxes overlap
 * on one axis and the gap between them is genuinely unobstructed.
 *
 * A container endpoint is temporarily represented by one of its leaves while
 * the topology is laid out. Its restored route consequently inherits that
 * leaf's port, even when the finished frame has a much clearer shared corridor
 * with the other endpoint. After the frame exists the cleanest representation is
 * a single segment from one endpoint border to the other. We only take it when
 * it avoids every leaf, foreign frame and existing route; otherwise the original
 * rounded dogleg is retained.
 */
export function straightenAlignedContainerBridges(
  redirected: readonly ContainerEdge[],
  frames: ReadonlyMap<string, Bounds>,
  nodes: readonly Node[],
  edges: readonly Edge[],
  options: GridAttachedOptions
): void {
  const clearance = Math.max(PORT_SEPARATION, options.routingClearance);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  for (const { edge, startContainer, endContainer } of redirected) {
    if (startContainer === undefined && endContainer === undefined) {
      continue;
    }
    const source = endpointBounds(edge.start, startContainer, frames, nodeById);
    const target = endpointBounds(edge.end, endContainer, frames, nodeById);
    if (!source || !target) {
      continue;
    }

    const route = clearStraightBridge(
      source,
      target,
      edge.start!,
      edge.end!,
      edge,
      frames,
      nodes,
      edges,
      clearance
    );
    if (!route) {
      continue;
    }
    edge.points = route;
    if (edge.label) {
      edge.x = (route[0].x + route[1].x) / 2;
      edge.y = (route[0].y + route[1].y) / 2;
    }
  }
}

/** The visible box an original container edge starts or ends on. */
function endpointBounds(
  id: string | undefined,
  containerId: string | undefined,
  frames: ReadonlyMap<string, Bounds>,
  nodes: ReadonlyMap<string, Node>
): Bounds | undefined {
  if (containerId !== undefined) {
    return frames.get(containerId);
  }
  const node = id !== undefined ? nodes.get(id) : undefined;
  return node && node.isGroup !== true && isMeasurable(node)
    ? nodeBounds(rectOfNode(node))
    : undefined;
}

interface StraightBridge {
  /** Coordinate shared by both endpoints (x for a vertical bridge, y for horizontal). */
  low: number;
  high: number;
  axis: 'vertical' | 'horizontal';
  route: (coordinate: number) => Point[];
}

function clearStraightBridge(
  source: Bounds,
  target: Bounds,
  sourceId: string,
  targetId: string,
  edge: Edge,
  frames: ReadonlyMap<string, Bounds>,
  nodes: readonly Node[],
  edges: readonly Edge[],
  clearance: number
): Point[] | undefined {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const sourceObstacle = (byId.get(sourceId)?.isGroup !== true
    ? endpointObstacle(sourceId, byId)
    : undefined) ?? {
    id: sourceId,
    rect: rectOfBounds(source),
  };
  const targetObstacle = (byId.get(targetId)?.isGroup !== true
    ? endpointObstacle(targetId, byId)
    : undefined) ?? {
    id: targetId,
    rect: rectOfBounds(target),
  };
  const bridges = alignedStraightBridges(source, target);
  for (const bridge of bridges) {
    for (const coordinate of bridgeCoordinates(
      bridge,
      sourceId,
      targetId,
      edge,
      frames,
      nodes,
      edges,
      clearance,
      sourceObstacle,
      targetObstacle
    )) {
      const [sourceSide, targetSide] = bridgeSides(bridge);
      const axis = bridge.axis === 'vertical' ? 'x' : 'y';
      const route = [
        obstaclePort(sourceObstacle, sourceSide, coordinate - sourceObstacle.rect[axis]),
        obstaclePort(targetObstacle, targetSide, coordinate - targetObstacle.rect[axis]),
      ];
      if (straightBridgeIsClear(route, sourceId, targetId, edge, frames, nodes, edges, clearance)) {
        return route;
      }
    }
  }
  return undefined;
}

/** All direct horizontal/vertical connections made possible by the two frame boxes. */
function alignedStraightBridges(source: Bounds, target: Bounds): StraightBridge[] {
  const bridges: StraightBridge[] = [];
  const xLow = Math.max(source.minX, target.minX);
  const xHigh = Math.min(source.maxX, target.maxX);
  if (xLow <= xHigh) {
    if (source.maxY <= target.minY) {
      bridges.push({
        low: xLow,
        high: xHigh,
        axis: 'vertical',
        route: (x) => [
          { x, y: source.maxY },
          { x, y: target.minY },
        ],
      });
    } else if (target.maxY <= source.minY) {
      bridges.push({
        low: xLow,
        high: xHigh,
        axis: 'vertical',
        route: (x) => [
          { x, y: source.minY },
          { x, y: target.maxY },
        ],
      });
    }
  }

  const yLow = Math.max(source.minY, target.minY);
  const yHigh = Math.min(source.maxY, target.maxY);
  if (yLow <= yHigh) {
    if (source.maxX <= target.minX) {
      bridges.push({
        low: yLow,
        high: yHigh,
        axis: 'horizontal',
        route: (y) => [
          { x: source.maxX, y },
          { x: target.minX, y },
        ],
      });
    } else if (target.maxX <= source.minX) {
      bridges.push({
        low: yLow,
        high: yHigh,
        axis: 'horizontal',
        route: (y) => [
          { x: source.minX, y },
          { x: target.maxX, y },
        ],
      });
    }
  }

  // A vertical or horizontal path is equally legible. Prefer the shorter gap,
  // then retain the stable vertical-before-horizontal tie break.
  return bridges.sort((first, second) => {
    const firstRoute = first.route((first.low + first.high) / 2);
    const secondRoute = second.route((second.low + second.high) / 2);
    const firstLength =
      Math.abs(firstRoute[1].x - firstRoute[0].x) + Math.abs(firstRoute[1].y - firstRoute[0].y);
    const secondLength =
      Math.abs(secondRoute[1].x - secondRoute[0].x) + Math.abs(secondRoute[1].y - secondRoute[0].y);
    return firstLength - secondLength;
  });
}

function bridgeSides(bridge: StraightBridge): [Side, Side] {
  const [source, target] = bridge.route((bridge.low + bridge.high) / 2);
  return bridge.axis === 'vertical'
    ? target.y >= source.y
      ? ['bottom', 'top']
      : ['top', 'bottom']
    : target.x >= source.x
      ? ['right', 'left']
      : ['left', 'right'];
}

/**
 * Centre lanes read best. Obstacle edges add escape lanes so a single block in
 * the middle does not throw away a perfectly valid straight connection beside it.
 */
function bridgeCoordinates(
  bridge: StraightBridge,
  sourceId: string,
  targetId: string,
  edge: Edge,
  frames: ReadonlyMap<string, Bounds>,
  nodes: readonly Node[],
  edges: readonly Edge[],
  clearance: number,
  source: RouterObstacle,
  target: RouterObstacle
): number[] {
  const [sourceSide, targetSide] = bridgeSides(bridge);
  const axis = bridge.axis === 'vertical' ? 'x' : 'y';
  const sourceBand = portBand(source, sourceSide);
  const targetBand = portBand(target, targetSide);
  const low = Math.max(
    bridge.low,
    source.rect[axis] + sourceBand.min,
    target.rect[axis] + targetBand.min
  );
  const high = Math.min(
    bridge.high,
    source.rect[axis] + sourceBand.max,
    target.rect[axis] + targetBand.max
  );
  if (low > high) {
    return [];
  }

  const candidates = new Set<number>([(low + high) / 2, low, high]);
  for (const node of nodes) {
    if (
      node.id === sourceId ||
      node.id === targetId ||
      node.isGroup === true ||
      !isMeasurable(node)
    ) {
      continue;
    }
    addBridgeObstacleCandidates(candidates, bridge, nodeBounds(rectOfNode(node)), clearance);
  }
  for (const bounds of frames.values()) {
    addBridgeObstacleCandidates(candidates, bridge, bounds, clearance);
  }
  for (const other of edges) {
    if (other === edge || other.isLayoutOnly || !other.points || other.points.length < 2) {
      continue;
    }
    for (const [nodeId, port] of [
      [other.start, other.points[0]],
      [other.end, other.points.at(-1)!],
    ] as const) {
      if (nodeId !== sourceId && nodeId !== targetId) {
        continue;
      }
      const coordinate = bridge.axis === 'vertical' ? port.x : port.y;
      candidates.add(coordinate - clearance);
      candidates.add(coordinate + clearance);
    }
  }

  const middle = (low + high) / 2;
  return [...candidates]
    .filter((coordinate) => coordinate >= low - EPS && coordinate <= high + EPS)
    .sort((first, second) => Math.abs(first - middle) - Math.abs(second - middle));
}

function addBridgeObstacleCandidates(
  candidates: Set<number>,
  bridge: StraightBridge,
  bounds: Bounds,
  clearance: number
): void {
  const sample = bridge.route((bridge.low + bridge.high) / 2);
  const routeLow =
    bridge.axis === 'vertical'
      ? Math.min(sample[0].y, sample[1].y)
      : Math.min(sample[0].x, sample[1].x);
  const routeHigh =
    bridge.axis === 'vertical'
      ? Math.max(sample[0].y, sample[1].y)
      : Math.max(sample[0].x, sample[1].x);
  const obstacleLow = bridge.axis === 'vertical' ? bounds.minY : bounds.minX;
  const obstacleHigh = bridge.axis === 'vertical' ? bounds.maxY : bounds.maxX;
  if (obstacleHigh <= routeLow + EPS || obstacleLow >= routeHigh - EPS) {
    return;
  }

  const crossLow = bridge.axis === 'vertical' ? bounds.minX : bounds.minY;
  const crossHigh = bridge.axis === 'vertical' ? bounds.maxX : bounds.maxY;
  candidates.add(crossLow - clearance);
  candidates.add(crossHigh + clearance);
}

function straightBridgeIsClear(
  route: Point[],
  sourceId: string,
  targetId: string,
  edge: Edge,
  frames: ReadonlyMap<string, Bounds>,
  nodes: readonly Node[],
  edges: readonly Edge[],
  clearance: number
): boolean {
  for (const node of nodes) {
    if (
      node.id === sourceId ||
      node.id === targetId ||
      node.isGroup === true ||
      !isMeasurable(node)
    ) {
      continue;
    }
    if (polylineHitsBounds(route, expand(nodeBounds(rectOfNode(node)), clearance))) {
      return false;
    }
  }
  const permitted = permittedFrameIds(edge, new Map(nodes.map((node) => [node.id, node])));
  for (const [id, bounds] of frames) {
    if (!permitted.has(id) && polylineHitsBounds(route, expand(bounds, clearance))) {
      return false;
    }
  }
  for (const other of edges) {
    if (other === edge || other.isLayoutOnly || !other.points || other.points.length < 2) {
      continue;
    }
    if (polylineCrossesSegment(other.points, { a: route[0], b: route[1] })) {
      return false;
    }
    if (
      usesNearbyPort(route[0], sourceId, other, clearance) ||
      usesNearbyPort(route[1], targetId, other, clearance)
    ) {
      return false;
    }
  }
  return true;
}

function usesNearbyPort(point: Point, nodeId: string, edge: Edge, clearance: number): boolean {
  const start = edge.points![0];
  const end = edge.points!.at(-1)!;
  return (
    (edge.start === nodeId && Math.hypot(point.x - start.x, point.y - start.y) < clearance - EPS) ||
    (edge.end === nodeId && Math.hypot(point.x - end.x, point.y - end.y) < clearance - EPS)
  );
}

function expand(bounds: Bounds, amount: number): Bounds {
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount,
  };
}

/**
 * Repair visible connections after fitting frames, including trimmed corner ports.
 * Re-route edges that pass through a frame neither endpoint owns.
 *
 * Container edges are the conspicuous case because they are restored after the
 * topology route was drawn, but ordinary leaf-to-leaf edges can make the same
 * mistake once a sibling frame is fitted. A route may use its own frame and common
 * ancestor frames; a sibling frame is always an obstacle.
 */
export function rerouteEdgesAroundForeignFrames(
  edges: readonly Edge[],
  frames: ReadonlyMap<string, Bounds>,
  nodes: readonly Node[],
  options: GridAttachedOptions
): void {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const hasFrameTerminal = (edge: Edge) =>
    nodeById.get(edge.start ?? '')?.isGroup === true ||
    nodeById.get(edge.end ?? '')?.isGroup === true;
  const frameRoutes = edges.filter((edge) => !edge.isLayoutOnly && hasFrameTerminal(edge));
  const reroute = edges.filter((edge) => {
    if (edge.isLayoutOnly || !edge.points || edge.points.length < 2) {
      return false;
    }
    const foreignFrames = framesForOtherSubgraphs(edge, frames, nodeById);
    const points = edge.points;
    const source = endpointObstacle(edge.start, nodeById);
    const target = endpointObstacle(edge.end, nodeById);
    const start = points[0];
    const end = points.at(-1)!;
    const sourceNeighbour = points.find(
      (point) => Math.hypot(point.x - start.x, point.y - start.y) > EPS
    );
    const targetNeighbour = [...points]
      .reverse()
      .find((point) => Math.hypot(point.x - end.x, point.y - end.y) > EPS);
    const crossingCandidates = hasFrameTerminal(edge) ? edges : frameRoutes;
    const crossesFrameRoute = crossingCandidates.some(
      (other) =>
        other !== edge &&
        !other.isLayoutOnly &&
        other.points &&
        segmentsOf(points).some(
          (segment) => countCrossings(segment.a, segment.b, segmentsOf(other.points!)) > 0
        )
    );
    const shortFrameTerminal =
      hasFrameTerminal(edge) &&
      points.length > 2 &&
      options.roundShortTerminalTurns &&
      ((sourceNeighbour !== undefined &&
        Math.hypot(start.x - sourceNeighbour.x, start.y - sourceNeighbour.y) <
          MIN_FRAME_TERMINAL_RUN - EPS) ||
        (targetNeighbour !== undefined &&
          Math.hypot(end.x - targetNeighbour.x, end.y - targetNeighbour.y) <
            MIN_FRAME_TERMINAL_RUN - EPS));
    return (
      shortFrameTerminal ||
      crossesFrameRoute ||
      foreignFrames.some(({ bounds }) =>
        polylineHitsBounds(
          points,
          expand(bounds, frameRoutes.length > 0 ? options.routingClearance : 0)
        )
      ) ||
      (frames.size > 0 &&
        ((source !== undefined &&
          sourceNeighbour !== undefined &&
          unsafeTerminalPort(source, start, sourceNeighbour)) ||
          (target !== undefined &&
            targetNeighbour !== undefined &&
            unsafeTerminalPort(target, end, targetNeighbour))))
    );
  });
  const rerouted = new Set(reroute);
  const reservedPorts = new Map<string, Point[]>();
  for (const edge of edges) {
    if (!rerouted.has(edge)) {
      reserveRoutePorts(edge, nodeById, reservedPorts);
    }
  }

  for (const edge of reroute) {
    const foreignFrames = framesForOtherSubgraphs(edge, frames, nodeById);
    const rerouted = routeAroundForeignFrames(
      edge,
      nodeById,
      foreignFrames,
      options,
      reservedPorts,
      edges,
      frames
    );
    if (rerouted) {
      // The post-frame router runs after container endpoints were trimmed. It
      // must retain that terminal-run invariant too; otherwise its fresh route
      // can put a sharp corner immediately before the arrowhead it just fixed.
      edge.points = options.roundShortTerminalTurns ? extendFrameTerminalRun(rerouted) : rerouted;
    }
    reserveRoutePorts(edge, nodeById, reservedPorts);
  }
}

interface FrameObstacle {
  id: string;
  bounds: Bounds;
}

/** Distinguish frame obstacles from leaf nodes, whose ids are public Mermaid ids. */
const FRAME_OBSTACLE_PREFIX = '__hola-frame__:';

/** Minimum separation between two boundary attachment points on one node. */
const PORT_SEPARATION = 8;

/**
 * Frames which neither endpoint owns or belongs to. An edge may enter its own
 * container, and it may live inside a common parent; crossing a sibling frame is
 * never a meaningful connection and must be avoided.
 */
function framesForOtherSubgraphs(
  edge: Edge,
  frames: ReadonlyMap<string, Bounds>,
  nodes: ReadonlyMap<string, Node>
): FrameObstacle[] {
  const permitted = permittedFrameIds(edge, nodes);
  return [...frames].filter(([id]) => !permitted.has(id)).map(([id, bounds]) => ({ id, bounds }));
}

function permittedFrameIds(edge: Edge, nodes: ReadonlyMap<string, Node>): Set<string> {
  const permitted = new Set<string>();
  for (const id of [edge.start, edge.end]) {
    for (const ancestor of containerAncestors(id, nodes)) {
      permitted.add(ancestor);
    }
  }
  return permitted;
}

function containerAncestors(id: string | undefined, nodes: ReadonlyMap<string, Node>): string[] {
  const ancestors: string[] = [];
  const seen = new Set<string>();
  let current = id;
  while (current !== undefined && !seen.has(current)) {
    seen.add(current);
    const node = nodes.get(current);
    if (node?.isGroup === true) {
      ancestors.push(current);
    }
    current = node?.parentId;
  }
  return ancestors;
}

/**
 * Re-route an edge after the frame geometry is available.
 *
 * The core router runs before frames exist, so it cannot know that a sibling frame
 * will eventually cover one of its rails. Here both endpoint boxes and the finished
 * sibling frames are known. The same orthogonal router can therefore choose a clean
 * channel without disturbing nodes, placement, or routes that already clear every
 * frame.
 */
function routeAroundForeignFrames(
  edge: Edge,
  nodes: ReadonlyMap<string, Node>,
  foreignFrames: readonly FrameObstacle[],
  options: GridAttachedOptions,
  reservedPorts: ReadonlyMap<string, readonly Point[]> = new Map(),
  edges: readonly Edge[] = [],
  frames: ReadonlyMap<string, Bounds> = new Map()
): Point[] | undefined {
  const source = endpointObstacle(edge.start, nodes);
  const target = endpointObstacle(edge.end, nodes);
  if (!source || !target || source.id === target.id) {
    return undefined;
  }

  const obstacles = new Map<string, RouterObstacle>();
  for (const node of nodes.values()) {
    if (node.isGroup === true || !isMeasurable(node)) {
      continue;
    }
    obstacles.set(`node:${node.id}`, {
      id: `node:${node.id}`,
      rect: rectOfNode(node),
    });
  }
  for (const frame of foreignFrames) {
    obstacles.set(`${FRAME_OBSTACLE_PREFIX}${frame.id}`, {
      id: `${FRAME_OBSTACLE_PREFIX}${frame.id}`,
      rect: rectOfBounds(frame.bounds),
    });
  }
  obstacles.set(source.id, source);
  obstacles.set(target.id, target);

  const guidePoints = [...frames.values()].flatMap((bounds) => [
    { x: bounds.minX - options.routingClearance, y: bounds.minY - options.routingClearance },
    { x: bounds.maxX + options.routingClearance, y: bounds.maxY + options.routingClearance },
  ]);
  const bounds = [...obstacles.values()].map((obstacle) => nodeBounds(obstacle.rect));
  const outerDetour =
    2 *
      (Math.max(...bounds.map((bound) => bound.maxX)) -
        Math.min(...bounds.map((bound) => bound.minX)) +
        Math.max(...bounds.map((bound) => bound.maxY)) -
        Math.min(...bounds.map((bound) => bound.minY))) +
    8 * options.routingBendPenalty;
  const permitted = permittedFrameIds(edge, nodes);
  const boundarySegments = [...frames]
    .filter(([id]) => permitted.has(id) && id !== edge.start && id !== edge.end)
    .flatMap(([, bounds]) =>
      segmentsOf([
        { x: bounds.minX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.minY },
        { x: bounds.maxX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.maxY },
        { x: bounds.minX, y: bounds.minY },
      ])
    );
  const config: RouterConfig = {
    clearance: options.routingClearance,
    bendPenalty: options.routingBendPenalty,
    crossingPenalty: Math.max(options.routingCrossingPenalty, outerDetour),
    maxExpansions: options.routingMaxExpansions,
    minTerminalLegLength: options.roundShortTerminalTurns ? FULL_ROUNDED_CORNER_RUN : undefined,
  };
  const portSeparation = Math.max(PORT_SEPARATION, config.clearance);
  let best: Point[] | undefined;
  let bestCost = Infinity;
  let bestConflicts = Infinity;
  let fallback: Point[] | undefined;
  let fallbackDistance = -Infinity;
  let fallbackCost = Infinity;
  const existing = edges
    .filter((other) => other !== edge && !other.isLayoutOnly && other.points)
    .flatMap((other) => segmentsOf(other.points!));
  const sides: Side[] = ['top', 'bottom', 'left', 'right'];
  for (const sourceSide of sides) {
    for (const targetSide of sides) {
      for (const sourcePortOffset of portOffsets(
        source,
        sourceSide,
        foreignFrames,
        config.clearance,
        reservedPorts.get(source.id)
      )) {
        for (const targetPortOffset of portOffsets(
          target,
          targetSide,
          foreignFrames,
          config.clearance,
          reservedPorts.get(target.id)
        )) {
          const alternatives = routeAlternatives(
            {
              edgeId: edge.id,
              source,
              target,
              obstacles: [...obstacles.values()],
              lockedSourceSide: sourceSide,
              lockedTargetSide: targetSide,
              sourcePortOffset,
              targetPortOffset,
              existingSegments: existing,
              accountForVertexCrossings: true,
              guidePoints,
              boundarySegments,
            },
            config
          );
          for (const candidate of alternatives) {
            const distance = routePortClearance(candidate.points, source, target, reservedPorts);
            const conflicts =
              segmentsOf(candidate.points).reduce(
                (sum, segment) =>
                  sum +
                  countCrossings(segment.a, segment.b, existing) +
                  countCollinearOverlaps(segment.a, segment.b, existing),
                0
              ) + ancestorRailConflicts(candidate.points, edge, frames, nodes, config.clearance);
            if (
              distance > fallbackDistance + EPS ||
              (Math.abs(distance - fallbackDistance) < EPS && candidate.cost < fallbackCost)
            ) {
              fallback = candidate.points;
              fallbackDistance = distance;
              fallbackCost = candidate.cost;
            }
            if (
              distance >= portSeparation &&
              (conflicts < bestConflicts ||
                (conflicts === bestConflicts && candidate.cost < bestCost))
            ) {
              best = candidate.points;
              bestCost = candidate.cost;
              bestConflicts = conflicts;
            }
          }
        }
      }
    }
  }

  return best ?? fallback;
}

function reserveRoutePorts(
  edge: Edge,
  nodes: ReadonlyMap<string, Node>,
  reserved: Map<string, Point[]>
): void {
  const points = edge.points;
  if (!points || points.length < 2) {
    return;
  }
  const source = endpointObstacle(edge.start, nodes);
  const target = endpointObstacle(edge.end, nodes);
  if (source) {
    reservePort(reserved, source.id, points[0]);
  }
  if (target) {
    reservePort(reserved, target.id, points.at(-1)!);
  }
}

function reservePort(reserved: Map<string, Point[]>, obstacleId: string, point: Point): void {
  const ports = reserved.get(obstacleId);
  if (ports) {
    ports.push(point);
  } else {
    reserved.set(obstacleId, [point]);
  }
}

function routePortClearance(
  points: readonly Point[],
  source: RouterObstacle,
  target: RouterObstacle,
  reserved: ReadonlyMap<string, readonly Point[]>
): number {
  const start = points[0];
  const end = points.at(-1);
  if (!start || !end) {
    return -Infinity;
  }
  return Math.min(
    clearanceFromReservedPort(start, reserved.get(source.id)),
    clearanceFromReservedPort(end, reserved.get(target.id))
  );
}

function clearanceFromReservedPort(point: Point, ports: readonly Point[] | undefined): number {
  if (!ports || ports.length === 0) {
    return Infinity;
  }
  return Math.min(...ports.map((port) => Math.hypot(point.x - port.x, point.y - port.y)));
}

function endpointObstacle(
  id: string | undefined,
  nodes: ReadonlyMap<string, Node>
): RouterObstacle | undefined {
  if (id === undefined) {
    return undefined;
  }
  const node = nodes.get(id);
  if (node && node.isGroup !== true && isMeasurable(node)) {
    return { id: `node:${id}`, rect: rectOfNode(node), silhouette: sampleSilhouette(node) };
  }
  const group = node && node.isGroup === true ? node : undefined;
  if (!group || !isMeasurable(group)) {
    return undefined;
  }
  return { id: `${FRAME_OBSTACLE_PREFIX}${id}`, rect: rectOfNode(group) };
}

/** A permitted ancestor may contain a route; its border is still not a routing rail. */
function ancestorRailConflicts(
  points: Point[],
  edge: Edge,
  frames: ReadonlyMap<string, Bounds>,
  nodes: ReadonlyMap<string, Node>,
  clearance: number
): number {
  const ancestors = permittedFrameIds(edge, nodes);
  let conflicts = 0;
  for (const [id, bounds] of frames) {
    if (!ancestors.has(id) || id === edge.start || id === edge.end) {
      continue;
    }
    for (const segment of segmentsOf(points)) {
      const horizontal = Math.abs(segment.a.y - segment.b.y) < EPS;
      const low = horizontal
        ? Math.min(segment.a.x, segment.b.x)
        : Math.min(segment.a.y, segment.b.y);
      const high = horizontal
        ? Math.max(segment.a.x, segment.b.x)
        : Math.max(segment.a.y, segment.b.y);
      const overlap =
        Math.min(high, horizontal ? bounds.maxX : bounds.maxY) -
        Math.max(low, horizontal ? bounds.minX : bounds.minY);
      const coordinate = horizontal ? segment.a.y : segment.a.x;
      const distance = Math.min(
        Math.abs(coordinate - (horizontal ? bounds.minY : bounds.minX)),
        Math.abs(coordinate - (horizontal ? bounds.maxY : bounds.maxX))
      );
      if (overlap > clearance && distance < clearance - EPS) {
        conflicts++;
      }
    }
  }
  return conflicts;
}

/** The usable interior of one face, shared by discovery and terminal validation. */
function portBand(obstacle: RouterObstacle, side: Side): { min: number; max: number } {
  const length = side === 'left' || side === 'right' ? obstacle.rect.height : obstacle.rect.width;
  // Leave an inset on both large frames and small nodes. For short faces the
  // quarter-side cap preserves a usable span instead of squeezing it to a point.
  const margin = Math.min(length / 4, Math.max(PORT_SEPARATION, length * 0.16));
  const outline = obstacle.silhouette
    ? silhouetteBand(obstacle.silhouette, obstacle.rect, side)
    : { min: -length / 2, max: length / 2 };
  return {
    min: Math.max(-length / 2 + margin, outline.min),
    max: Math.min(length / 2 - margin, outline.max),
  };
}

function unsafeTerminalPort(obstacle: RouterObstacle, point: Point, neighbour: Point): boolean {
  const dx = neighbour.x - point.x;
  const dy = neighbour.y - point.y;
  if (Math.abs(dx) > EPS && Math.abs(dy) > EPS) {
    return true;
  }
  const side: Side = Math.abs(dx) > EPS ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'bottom' : 'top';
  const offset =
    side === 'left' || side === 'right' ? point.y - obstacle.rect.y : point.x - obstacle.rect.x;
  const band = portBand(obstacle, side);
  const expected = obstaclePort(obstacle, side, offset);
  return (
    offset < band.min - EPS ||
    offset > band.max + EPS ||
    Math.hypot(point.x - expected.x, point.y - expected.y) > 0.5
  );
}

function portOffsets(
  obstacle: RouterObstacle,
  side: Side,
  foreignFrames: readonly FrameObstacle[],
  clearance: number,
  reserved: readonly Point[] = []
): number[] {
  const spacing = Math.max(PORT_SEPARATION, clearance);
  const band = portBand(obstacle, side);
  const offsets = new Set<number>([
    0,
    -spacing,
    spacing,
    -2 * spacing,
    2 * spacing,
    band.min,
    band.max,
  ]);
  const verticalFace = side === 'left' || side === 'right';
  for (const { bounds } of foreignFrames) {
    const centre = verticalFace ? obstacle.rect.y : obstacle.rect.x;
    offsets.add((verticalFace ? bounds.minY : bounds.minX) - centre - clearance - 1);
    offsets.add((verticalFace ? bounds.maxY : bounds.maxX) - centre + clearance + 1);
  }
  for (const point of reserved) {
    const offset = verticalFace ? point.y - obstacle.rect.y : point.x - obstacle.rect.x;
    offsets.add(offset - spacing);
    offsets.add(offset + spacing);
  }
  return [...offsets].filter((offset) => offset >= band.min - EPS && offset <= band.max + EPS);
}

function isMeasurable(
  node: Node
): node is Node & Required<Pick<Node, 'x' | 'y' | 'width' | 'height'>> {
  return (
    node.x !== undefined &&
    node.y !== undefined &&
    node.width !== undefined &&
    node.height !== undefined
  );
}

function rectOfNode(node: Node & Required<Pick<Node, 'x' | 'y' | 'width' | 'height'>>): Rect {
  return { x: node.x, y: node.y, width: node.width, height: node.height };
}

function rectOfBounds(bounds: Bounds): Rect {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
    width: bounds.maxX - bounds.minX,
    height: bounds.maxY - bounds.minY,
  };
}

/**
 * Cut a polyline where it first meets `frame`, approaching from `which` end.
 *
 * The route runs from outside the frame to a member inside it, so walking in from
 * the far end there is exactly one place where it crosses the border. Everything
 * past that point is inside the box and is dropped; the crossing becomes the new
 * endpoint, which is where the arrowhead belongs.
 *
 * A route that is inside the frame from the outset — both endpoints enclosed — has
 * no crossing to find and is returned unchanged.
 */
function trimToFrame(points: readonly Point[], frame: Bounds, which: 'start' | 'end'): Point[] {
  const ordered = which === 'end' ? [...points] : [...points].reverse();
  if (inside(ordered[0], frame)) {
    return [...points];
  }

  for (let i = 0; i + 1 < ordered.length; i++) {
    const from = ordered[i];
    const to = ordered[i + 1];
    if (!inside(to, frame)) {
      continue;
    }
    const crossing = borderCrossing(from, to, frame);
    const trimmed = extendFrameTerminalRun([...ordered.slice(0, i + 1), crossing]);
    return which === 'end' ? trimmed : trimmed.reverse();
  }

  return [...points];
}

/**
 * Keep enough of the outside corridor before a frame border for the final
 * arrowhead. Trimming can otherwise leave a 4px leg between the last bend and
 * the frame; marker shortening consumes all of it and makes the arrow point
 * along the preceding horizontal/vertical run.
 *
 * The route is ordered from the visible outside endpoint towards the frame. Its
 * last bend is a whole horizontal or vertical corridor, so moving that corridor
 * outward preserves every segment's orthogonality while making the final leg
 * long enough to survive rounded painting.
 */
function extendFrameTerminalRun(points: readonly Point[]): Point[] {
  if (points.length < 3) {
    return [...points];
  }

  const route = points.map((point) => ({ ...point }));
  const end = route.at(-1)!;
  const beforeEnd = route.at(-2)!;
  const vertical = Math.abs(end.x - beforeEnd.x) < EPS;
  const horizontal = Math.abs(end.y - beforeEnd.y) < EPS;
  if (!vertical && !horizontal) {
    return route;
  }

  const axis = vertical ? 'y' : 'x';
  const terminalLength = Math.abs(beforeEnd[axis] - end[axis]);
  if (terminalLength >= MIN_FRAME_TERMINAL_RUN) {
    return route;
  }

  const outward = Math.sign(beforeEnd[axis] - end[axis]);
  if (outward === 0) {
    return route;
  }
  const corridorCoordinate = end[axis] + outward * MIN_FRAME_TERMINAL_RUN;

  // Walk back over the corridor that leads into the final leg. Its points all
  // share the same along-axis coordinate; shifting only that plateau retains
  // a sequence of Manhattan segments.
  let beforeCorridor = route.length - 2;
  while (beforeCorridor >= 0 && Math.abs(route[beforeCorridor][axis] - beforeEnd[axis]) < EPS) {
    beforeCorridor--;
  }
  if (beforeCorridor < 0) {
    return route;
  }

  // The preceding leg must already reach the new corridor coordinate. Otherwise
  // moving the bend would make a needless U-turn beside the frame.
  if (outward * (route[beforeCorridor][axis] - end[axis]) < MIN_FRAME_TERMINAL_RUN) {
    return route;
  }

  for (let index = beforeCorridor + 1; index < route.length - 1; index++) {
    route[index][axis] = corridorCoordinate;
  }
  return route;
}

function inside(point: Point, frame: Bounds): boolean {
  return (
    point.x > frame.minX - EPS &&
    point.x < frame.maxX + EPS &&
    point.y > frame.minY - EPS &&
    point.y < frame.maxY + EPS
  );
}

/**
 * Where the segment from `outside` to `inside` meets the frame's border.
 *
 * Routes here are orthogonal, so the segment is axis-aligned and the crossing is
 * the border coordinate on the axis it travels along. A diagonal segment — which a
 * straight core edge can still be — is handled by the same parametric form.
 */
function borderCrossing(outside: Point, insidePoint: Point, frame: Bounds): Point {
  const dx = insidePoint.x - outside.x;
  const dy = insidePoint.y - outside.y;

  let best = 1;
  for (const [from, to, low, high] of [
    [outside.x, dx, frame.minX, frame.maxX],
    [outside.y, dy, frame.minY, frame.maxY],
  ] as const) {
    if (Math.abs(to) < EPS) {
      continue;
    }
    for (const border of [low, high]) {
      const t = (border - from) / to;
      if (t >= -EPS && t <= 1 + EPS) {
        best = Math.min(best, Math.max(0, t));
      }
    }
  }

  return { x: outside.x + dx * best, y: outside.y + dy * best };
}

/**
 * One member per container, by input order, walking down through nested containers
 * so a container holding nothing but other containers still resolves.
 */
function representativeMembers(
  nodes: readonly Node[],
  containers: ReadonlySet<string>
): Map<string, string> {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const memberOf = new Map<string, string>();

  for (const node of nodes) {
    if (node.isGroup === true) {
      continue;
    }
    // Every container above this leaf can use it, and the first leaf reached in
    // input order is the one each of them keeps.
    const seen = new Set<string>();
    let parentId = node.parentId;
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      if (containers.has(parentId) && !memberOf.has(parentId)) {
        memberOf.set(parentId, node.id);
      }
      parentId = byId.get(parentId)?.parentId;
    }
  }

  return memberOf;
}
