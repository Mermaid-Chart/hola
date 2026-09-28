import type { Edge, LayoutData, Node } from '../../types.js';

interface Point {
  x: number;
  y: number;
}

interface Rect {
  node: Node;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

interface Bounds {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

type Side = 'top' | 'right' | 'bottom' | 'left';
type Axis = 'H' | 'V';

const CLEARANCE = 20;
// Adjacent ports must stay visibly distinct once rounded edge strokes and
// arrowheads are rendered. Fourteen pixels produced near-coincident routes on
// feedback nodes such as "Notify Developer".
const PORT_SPACING = 24;
const TURN_PENALTY = 12;
const ROUTE_INTERACTION_PENALTY = 10_000;
const ROUTE_LANE_CLEARANCE = 8;
const LARGE_NODE_CLEARANCE_THRESHOLD = 200;
// Edge labels are measured by the renderer, after layout. Reserve a
// deliberately conservative estimate here so a narrow node-to-node gap does
// not become the label's only available space.
const LABEL_CLEARANCE = 12;
const LABEL_HEIGHT = 24;
const EPSILON = 1e-6;

/**
 * Stress-and-grid-specific edge routing.
 *
 * IPSEP-COLA deliberately writes centre-to-centre edge points because it is
 * shared by several layouts. This post-pass belongs only to stress-and-grid:
 * it anchors ports on node boundaries and finds an obstacle-free Manhattan
 * route using node-clearance and virtual-grid lines as its visibility graph.
 */
export function routeStressAndGridEdges(data: LayoutData, gridSpacing: number): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const obstacles = [...nodes.values()]
    .filter((node) => node.isGroup !== true)
    .map(rectFor)
    .filter((rect): rect is Rect => rect !== undefined);
  const symmetricDiamondFans = new Set(
    [...nodes.values()]
      .filter((node) => isSymmetricDiamondFan(node, data.edges, nodes))
      .map((node) => node.id)
  );
  const ports = allocatePorts(data.edges, nodes);
  const routedPaths: Point[][] = [];

  for (const edge of [...data.edges].sort((a, b) => edgeSpan(a, nodes) - edgeSpan(b, nodes))) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const sourceRect = source && rectFor(source);
    const targetRect = target && rectFor(target);
    if (!source || !target || !sourceRect || !targetRect) {
      continue;
    }
    const points =
      source === target
        ? selfLoop(sourceRect, gridSpacing)
        : (routeStraightReciprocalOfLabeledEdge(
            edge,
            sourceRect,
            targetRect,
            data.edges,
            obstacles,
            routedPaths
          ) ??
          routeWithLabelClearance(edge, sourceRect, targetRect, obstacles, routedPaths) ??
          routeSymmetricDiamondFan(
            source,
            target,
            ports.get(`${edge.id}:start`)!,
            ports.get(`${edge.id}:end`)!,
            symmetricDiamondFans.has(source.id),
            obstacles,
            routedPaths
          ) ??
          routeAvoidingEndpoints(
            ports.get(`${edge.id}:start`)!,
            sideAtPort(
              sourceRect,
              ports.get(`${edge.id}:start`)!,
              sideToward(source, target, 'start')
            ),
            ports.get(`${edge.id}:end`)!,
            sideAtPort(targetRect, ports.get(`${edge.id}:end`)!, sideToward(target, source, 'end')),
            sourceRect,
            targetRect,
            data.edges.filter(
              (candidate) => candidate.start === target.id || candidate.end === target.id
            ).length,
            obstacles,
            gridSpacing,
            routedPaths
          ));
    edge.points = points;
    routedPaths.push(points);
    const labelPoint = (edge.label ?? edge.text ?? '').trim()
      ? pointAtDominantSegment(points)
      : pointAtHalfLength(points);
    edge.x = labelPoint.x;
    edge.y = labelPoint.y;
    // Rounded corners retain the exact obstacle-avoiding polyline while
    // matching ELK's polished edge treatment.
    edge.curve = 'rounded';
    edge.roundedCornerRadius = Math.min(16, gridSpacing / 8);
    edge.hasIntersectionPoints = true;
  }
}

function routeSymmetricDiamondFan(
  source: Node,
  target: Node,
  start: Point,
  end: Point,
  isSymmetricFan: boolean,
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  if (!isSymmetricFan) {
    return undefined;
  }
  // Leave a lower sloped diamond face horizontally, then run directly down
  // into the task's top port. The two mirrored branches therefore need one
  // turn each, rather than a short stub followed by two visual kinks.
  const bend = { x: end.x, y: start.y };
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source && obstacle.node !== target
  );
  if (
    !segmentClear(start, bend, otherObstacles) ||
    !segmentClear(bend, end, otherObstacles) ||
    routeInteractionPenalty(start, bend, routedPaths) > 0 ||
    routeInteractionPenalty(bend, end, routedPaths) > 0
  ) {
    return undefined;
  }
  return [start, bend, end];
}

/**
 * A label lane and a straight reciprocal edge are complementary: the label
 * gets the outside corridor while the unlabeled return edge can remain a
 * simple, readable boundary-to-boundary segment.
 */
function routeStraightReciprocalOfLabeledEdge(
  edge: Edge,
  source: Rect,
  target: Rect,
  edges: Edge[],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  if (
    (edge.label ?? edge.text ?? '').trim() ||
    !edges.some(
      (candidate) =>
        candidate.start === target.node.id &&
        candidate.end === source.node.id &&
        (candidate.label ?? candidate.text ?? '').trim()
    )
  ) {
    return undefined;
  }

  let points: Point[] | undefined;
  if (Math.abs(source.node.y! - target.node.y!) <= EPSILON) {
    points = [
      { x: source.node.x! < target.node.x! ? source.right : source.left, y: source.node.y! },
      { x: source.node.x! < target.node.x! ? target.left : target.right, y: target.node.y! },
    ];
  } else if (Math.abs(source.node.x! - target.node.x!) <= EPSILON) {
    points = [
      { x: source.node.x!, y: source.node.y! < target.node.y! ? source.bottom : source.top },
      { x: target.node.x!, y: source.node.y! < target.node.y! ? target.top : target.bottom },
    ];
  }
  if (!points) {
    return undefined;
  }
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return segmentClear(points[0], points[1], otherObstacles) &&
    routeInteractionPenalty(points[0], points[1], routedPaths) === 0
    ? points
    : undefined;
}

/**
 * A normal edge label is centered on half of the route length. When two
 * aligned nodes leave less room than the label itself, that midpoint would be
 * inside an endpoint (or directly on a reciprocal edge). Give the label a
 * dedicated, obstacle-free lane above/below or left/right of the pair.
 */
function routeWithLabelClearance(
  edge: Edge,
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return undefined;
  }
  const labelWidth = Math.max(40, label.length * 8);
  const horizontal = Math.abs(source.node.y! - target.node.y!) <= EPSILON;
  const vertical = Math.abs(source.node.x! - target.node.x!) <= EPSILON;

  if (horizontal) {
    const gap =
      Math.abs(source.node.x! - target.node.x!) - (source.node.width! + target.node.width!) / 2;
    if (gap < labelWidth + LABEL_CLEARANCE * 2) {
      return chooseLabelLane(
        [
          labelLaneForHorizontalPair(source, target, 'top'),
          labelLaneForHorizontalPair(source, target, 'bottom'),
        ],
        source,
        target,
        obstacles,
        routedPaths,
        labelWidth
      );
    }
  }

  if (vertical) {
    const gap =
      Math.abs(source.node.y! - target.node.y!) - (source.node.height! + target.node.height!) / 2;
    if (gap < LABEL_HEIGHT + LABEL_CLEARANCE * 2) {
      return chooseLabelLane(
        [
          labelLaneForVerticalPair(source, target, 'left', labelWidth),
          labelLaneForVerticalPair(source, target, 'right', labelWidth),
        ],
        source,
        target,
        obstacles,
        routedPaths,
        labelWidth
      );
    }
  }

  return undefined;
}

function labelLaneForHorizontalPair(source: Rect, target: Rect, side: 'top' | 'bottom'): Point[] {
  const sourceOffset = horizontalPortOffset(source);
  const targetOffset = horizontalPortOffset(target);
  const sourceTowardTarget = target.node.x! < source.node.x! ? -sourceOffset : sourceOffset;
  const targetTowardSource = source.node.x! < target.node.x! ? -targetOffset : targetOffset;
  const start = {
    x: source.node.x! + sourceTowardTarget,
    y: side === 'top' ? source.top : source.bottom,
  };
  const end = {
    x: target.node.x! + targetTowardSource,
    y: side === 'top' ? target.top : target.bottom,
  };
  const laneY =
    side === 'top'
      ? Math.min(source.top, target.top) - LABEL_HEIGHT / 2 - LABEL_CLEARANCE
      : Math.max(source.bottom, target.bottom) + LABEL_HEIGHT / 2 + LABEL_CLEARANCE;
  return [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end];
}

function labelLaneForVerticalPair(
  source: Rect,
  target: Rect,
  side: 'left' | 'right',
  labelWidth: number
): Point[] {
  const sourceOffset = verticalPortOffset(source);
  const targetOffset = verticalPortOffset(target);
  const sourceTowardTarget = target.node.y! < source.node.y! ? -sourceOffset : sourceOffset;
  const targetTowardSource = source.node.y! < target.node.y! ? -targetOffset : targetOffset;
  const start = {
    x: side === 'left' ? source.left : source.right,
    y: source.node.y! + sourceTowardTarget,
  };
  const end = {
    x: side === 'left' ? target.left : target.right,
    y: target.node.y! + targetTowardSource,
  };
  const laneX =
    side === 'left'
      ? Math.min(source.left, target.left) - labelWidth / 2 - LABEL_CLEARANCE
      : Math.max(source.right, target.right) + labelWidth / 2 + LABEL_CLEARANCE;
  return [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end];
}

function horizontalPortOffset(rect: Rect): number {
  return Math.min(PORT_SPACING, rect.node.width! / 4);
}

function verticalPortOffset(rect: Rect): number {
  return Math.min(PORT_SPACING, rect.node.height! / 4);
}

function chooseLabelLane(
  candidates: Point[][],
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][],
  labelWidth: number
): Point[] | undefined {
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  const candidatesWithScores = candidates
    .map(simplify)
    .filter((candidate) => labelLaneIsClear(candidate, otherObstacles, routedPaths, labelWidth))
    .map((candidate) => ({ candidate, length: pathLength(candidate) }))
    .sort((a, b) => a.length - b.length);
  return candidatesWithScores[0]?.candidate;
}

function labelLaneIsClear(
  candidate: Point[],
  obstacles: Rect[],
  routedPaths: Point[][],
  labelWidth: number
): boolean {
  if (candidate.length !== 4) {
    return false;
  }
  if (
    candidate.slice(1).some((point, index) => !segmentClear(candidate[index], point, obstacles)) ||
    candidate
      .slice(1)
      .some((point, index) => routeInteractionPenalty(candidate[index], point, routedPaths) > 0)
  ) {
    return false;
  }
  const midpoint = pointAtHalfLength(candidate);
  const bridge =
    candidate[1].x === candidate[2].x
      ? Math.abs(candidate[2].y - candidate[1].y)
      : Math.abs(candidate[2].x - candidate[1].x);
  if (bridge < labelWidth + LABEL_CLEARANCE * 2) {
    return false;
  }
  const labelRect: Bounds = {
    left: midpoint.x - labelWidth / 2,
    right: midpoint.x + labelWidth / 2,
    top: midpoint.y - LABEL_HEIGHT / 2,
    bottom: midpoint.y + LABEL_HEIGHT / 2,
  };
  return obstacles.every((obstacle) => !rectanglesOverlap(labelRect, obstacle));
}

function rectanglesOverlap(a: Bounds, b: Bounds): boolean {
  return (
    a.left < b.right - EPSILON &&
    a.right > b.left + EPSILON &&
    a.top < b.bottom - EPSILON &&
    a.bottom > b.top + EPSILON
  );
}

function pathLength(points: Point[]): number {
  return points
    .slice(1)
    .reduce(
      (length, point, index) =>
        length + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y),
      0
    );
}

function routeAvoidingEndpoints(
  start: Point,
  startSide: Side,
  end: Point,
  endSide: Side,
  sourceRect: Rect,
  targetRect: Rect,
  targetDegree: number,
  obstacles: Rect[],
  gridSpacing: number,
  routedPaths: Point[][]
): Point[] {
  // The source must remain solid: otherwise the visibility graph can make a
  // U-turn from its outside stub and cut back through the source rectangle.
  // The target is temporarily open so its assigned end stub remains reachable.
  const obstaclesExceptTarget = obstacles.filter((obstacle) => obstacle.node !== targetRect.node);
  const route = routeBetweenPorts(
    start,
    startSide,
    end,
    endSide,
    obstaclesExceptTarget,
    gridSpacing,
    routedPaths,
    true
  );
  const targetIntersection = routeIntersectionLength(route, targetRect);
  // Dense endpoint fans use closely spaced terminal stubs. Keep their
  // established fanning route rather than replacing it with a detour that
  // could collapse two incident lanes together.
  if (targetIntersection <= ROUTE_LANE_CLEARANCE * 2 || targetDegree > 3) {
    return route;
  }
  // Most routes are clearer when their own terminal boxes do not constrain
  // the visibility graph. Re-route only a path that actually re-enters one,
  // keeping the target solid while it approaches its assigned port.
  const protectedRoute = routeBetweenPorts(
    start,
    startSide,
    end,
    endSide,
    obstacles,
    gridSpacing,
    routedPaths,
    true
  );
  // A fully blocked visibility graph falls back to an L-shaped path. Do not
  // replace a valid route with that fallback when it cuts back through its
  // source or target box; this retry is an improvement only when it is safe.
  const protectedRouteIsSafe = routeAvoidsEndpointBoxes(protectedRoute, sourceRect, targetRect);
  return protectedRouteIsSafe ? protectedRoute : route;
}

function routeAvoidsEndpointBoxes(route: Point[], source: Rect, target: Rect): boolean {
  return (
    routeIntersectionLength(route, source) <= EPSILON &&
    routeIntersectionLength(route, target) <= EPSILON
  );
}

function routeIntersectionLength(route: Point[], obstacle: Rect): number {
  let length = 0;
  for (let index = 1; index < route.length; index++) {
    const a = route[index - 1];
    const b = route[index];
    if (Math.abs(a.x - b.x) <= EPSILON && a.x > obstacle.left && a.x < obstacle.right) {
      length += Math.max(
        0,
        Math.min(Math.max(a.y, b.y), obstacle.bottom) - Math.max(Math.min(a.y, b.y), obstacle.top)
      );
    }
    if (Math.abs(a.y - b.y) <= EPSILON && a.y > obstacle.top && a.y < obstacle.bottom) {
      length += Math.max(
        0,
        Math.min(Math.max(a.x, b.x), obstacle.right) - Math.max(Math.min(a.x, b.x), obstacle.left)
      );
    }
  }
  return length;
}

function edgeSpan(edge: Edge, nodes: Map<string, Node>): number {
  const source = edge.start ? nodes.get(edge.start) : undefined;
  const target = edge.end ? nodes.get(edge.end) : undefined;
  if (!source || !target) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.abs((source.x ?? 0) - (target.x ?? 0)) + Math.abs((source.y ?? 0) - (target.y ?? 0));
}

function routeBetweenPorts(
  start: Point,
  startSide: Side,
  end: Point,
  endSide: Side,
  obstacles: Rect[],
  gridSpacing: number,
  routedPaths: Point[][],
  forbidSharedLanes = false
): Point[] {
  // Stubs give the visibility-grid route room to turn away from its port.
  // This also keeps diamond-side attachments on the outside of the shape.
  const startStub = extendPort(start, startSide);
  const endStub = extendPort(end, endSide);
  const routingObstacles = obstacles.map((obstacle) =>
    isLargeNode(obstacle.node) ? expandRect(obstacle, ROUTE_LANE_CLEARANCE) : obstacle
  );
  return simplify([
    start,
    startStub,
    ...findRoute(startStub, endStub, routingObstacles, gridSpacing, routedPaths, forbidSharedLanes),
    endStub,
    end,
  ]);
}

function isLargeNode(node: Node): boolean {
  return Math.max(node.width ?? 0, node.height ?? 0) >= LARGE_NODE_CLEARANCE_THRESHOLD;
}

function expandRect(rect: Rect, amount: number): Rect {
  return {
    ...rect,
    left: rect.left - amount,
    right: rect.right + amount,
    top: rect.top - amount,
    bottom: rect.bottom + amount,
  };
}

function rectFor(node: Node): Rect | undefined {
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
    return undefined;
  }
  return {
    node,
    left: node.x! - node.width! / 2,
    right: node.x! + node.width! / 2,
    top: node.y! - node.height! / 2,
    bottom: node.y! + node.height! / 2,
  };
}

function allocatePorts(edges: Edge[], nodes: Map<string, Node>): Map<string, Point> {
  const assignments = new Map<string, { edge: Edge; endpoint: 'start' | 'end'; side: Side }[]>();
  const symmetricDiamondFans = new Set(
    [...nodes.values()]
      .filter((node) => isSymmetricDiamondFan(node, edges, nodes))
      .map((node) => node.id)
  );
  const diamondFanVertices = new Set(
    [...nodes.values()]
      .filter(
        (node) => symmetricDiamondFans.has(node.id) || needsDiamondFanVertices(node, edges, nodes)
      )
      .map((node) => node.id)
  );
  for (const edge of edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target || source === target) {
      continue;
    }
    const sourceSide = sideToward(
      source,
      target,
      'start',
      diamondFanVertices.has(source.id),
      symmetricDiamondFans.has(source.id)
    );
    const targetSide = sideToward(target, source, 'end');
    add(assignments, `${source.id}:${sourceSide}`, { edge, endpoint: 'start', side: sourceSide });
    add(assignments, `${target.id}:${targetSide}`, { edge, endpoint: 'end', side: targetSide });
  }

  const ports = new Map<string, Point>();
  for (const [key, values] of assignments) {
    const [nodeId, side] = key.split(':') as [string, Side];
    const node = nodes.get(nodeId)!;
    // Order ports by where their counterpart lies along the side. This gives
    // left- and right-bound branches different local corridors instead of
    // assigning them arbitrarily by edge ID.
    values.sort(
      (a, b) =>
        portOrderCoordinate(node, a.edge, side, nodes) -
          portOrderCoordinate(node, b.edge, side, nodes) ||
        a.endpoint.localeCompare(b.endpoint) ||
        a.edge.id.localeCompare(b.edge.id)
    );
    const alignedCount = values.filter((value) => isAxisAligned(node, value.edge, nodes)).length;
    // A symmetric split needs distinct exits, but its two lower sloped-side
    // midpoints make a cleaner outward-then-downward fan than the left/right
    // vertices. Other crowded diamond fans retain cardinal vertices.
    const forceDiamondExitVertices =
      diamondFanVertices.has(node.id) && !symmetricDiamondFans.has(node.id);
    values.forEach((value, index) => {
      ports.set(
        `${value.edge.id}:${value.endpoint}`,
        portOnSide(
          node,
          side,
          value.endpoint,
          index,
          values.length,
          supportsCenteredPort(node) &&
            alignedCount === 1 &&
            isAxisAligned(node, value.edge, nodes),
          forceDiamondExitVertices,
          symmetricDiamondFans.has(node.id) && value.endpoint === 'start'
        )
      );
    });
  }
  return ports;
}

function isSymmetricDiamondFan(node: Node, edges: Edge[], nodes: Map<string, Node>): boolean {
  if (!/diamond|rhombus/.test(String(node.shape))) {
    return false;
  }
  const targets = edges
    .filter((edge) => edge.start === node.id && edge.end)
    .map((edge) => nodes.get(edge.end!))
    .filter((target): target is Node => target !== undefined)
    .sort((left, right) => left.x! - right.x!);
  return (
    targets.length === 2 &&
    Math.abs(targets[0].y! - targets[1].y!) <= EPSILON &&
    targets[0].x! < node.x! - EPSILON &&
    targets[1].x! > node.x! + EPSILON
  );
}

function supportsCenteredPort(node: Node): boolean {
  return !/circle|ellipse|diamond|rhombus/.test(String(node.shape));
}

function needsDiamondFanVertices(node: Node, edges: Edge[], nodes: Map<string, Node>): boolean {
  if (!/diamond|rhombus/.test(String(node.shape))) {
    return false;
  }
  const outgoingBySide = new Map<Side, Node[]>();
  for (const edge of edges) {
    if (edge.start !== node.id || !edge.end) {
      continue;
    }
    const target = nodes.get(edge.end);
    if (!target) {
      continue;
    }
    // Fan detection deliberately resolves an exact diagonal as vertical. Once
    // symmetric branches share a row, one branch is directly below the
    // diamond and its sibling can be exactly down-and-sideways. They still
    // belong to the same downward fan; `sideToward` later gives the lateral
    // branch its own cardinal exit vertex.
    add(outgoingBySide, fanDetectionSide(node, target), target);
  }
  return [...outgoingBySide].some(([side, targets]) => {
    if (targets.length < 2) {
      return false;
    }
    const coordinates = targets.map((target) =>
      side === 'top' || side === 'bottom' ? target.y! : target.x!
    );
    const branchAxisCoordinates = targets.map((target) =>
      side === 'top' || side === 'bottom' ? target.x! : target.y!
    );
    const sourceAxisCoordinate = side === 'top' || side === 'bottom' ? node.x! : node.y!;
    const hasCenteredBranch = branchAxisCoordinates.some(
      (coordinate) => Math.abs(coordinate - sourceAxisCoordinate) <= EPSILON
    );
    const hasLateralBranch = branchAxisCoordinates.some(
      (coordinate) => Math.abs(coordinate - sourceAxisCoordinate) > EPSILON
    );
    const branchesStraddleCenter =
      Math.min(...branchAxisCoordinates) < sourceAxisCoordinate - EPSILON &&
      Math.max(...branchAxisCoordinates) > sourceAxisCoordinate + EPSILON;
    // When same-side branches are at clearly different depths, the nearer
    // target can obstruct the longer branch's side midpoint exit. The same
    // is true for a symmetric row with one branch directly below the diamond
    // and its sibling lateral to it.
    return (
      Math.max(...coordinates) - Math.min(...coordinates) >
        Math.max(node.width!, node.height!) / 2 ||
      (hasCenteredBranch && hasLateralBranch) ||
      (branchesStraddleCenter && branchTargetsReconverge(targets, edges))
    );
  });
}

function branchTargetsReconverge(targets: Node[], edges: Edge[]): boolean {
  if (targets.length !== 2) {
    return false;
  }
  const successors = new Set(
    edges.filter((edge) => edge.start === targets[0].id && edge.end).map((edge) => edge.end!)
  );
  return edges.some((edge) => edge.start === targets[1].id && successors.has(edge.end!));
}

function fanDetectionSide(from: Node, to: Node): Side {
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function isAxisAligned(node: Node, edge: Edge, nodes: Map<string, Node>): boolean {
  const otherId = edge.start === node.id ? edge.end : edge.start;
  const other = otherId ? nodes.get(otherId) : undefined;
  return (
    !!other &&
    (Math.abs((node.x ?? 0) - (other.x ?? 0)) <= EPSILON ||
      Math.abs((node.y ?? 0) - (other.y ?? 0)) <= EPSILON)
  );
}

function portOrderCoordinate(node: Node, edge: Edge, side: Side, nodes: Map<string, Node>): number {
  const otherId = edge.start === node.id ? edge.end : edge.start;
  const other = otherId ? nodes.get(otherId) : undefined;
  if (!other) {
    return 0;
  }
  return side === 'top' || side === 'bottom' ? (other.x ?? 0) : (other.y ?? 0);
}

function add<T>(map: Map<string | number, T[]>, key: string | number, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sideToward(
  from: Node,
  to: Node,
  endpoint: 'start' | 'end',
  preferDistinctDiamondVertices = false,
  forceLateralDiamondFan = false
): Side {
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  // Give fanned decision exits distinct cardinal vertices when a branch has a
  // significant sideways component. A lower-right branch leaving the bottom
  // vertex would otherwise have to pass through a lower sibling.
  if (
    preferDistinctDiamondVertices &&
    endpoint === 'start' &&
    /diamond|rhombus/.test(String(from.shape)) &&
    (forceLateralDiamondFan || Math.abs(dx) * 2 >= Math.abs(dy)) &&
    Math.abs(dx) > EPSILON
  ) {
    return dx < 0 ? 'left' : 'right';
  }
  // Start and end terminals use complementary diagonals. This lets a path
  // leave toward its destination while approaching the target from its clear
  // side, avoiding an unnecessary perimeter detour.
  if (Math.abs(Math.abs(dx) - Math.abs(dy)) <= EPSILON) {
    if (endpoint === 'start') {
      if (dy < 0) {
        return 'top';
      }
      return dx < 0 ? 'left' : 'right';
    }
    if (dy >= 0) {
      return 'bottom';
    }
    return dx < 0 ? 'left' : 'top';
  }
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function portOnSide(
  node: Node,
  side: Side,
  endpoint: 'start' | 'end',
  index: number,
  count: number,
  forceCenter = false,
  forceDiamondExitVertices = false,
  lowerDiamondFanExit = false
): Point {
  const rect = rectFor(node)!;
  if (/diamond|rhombus/.test(String(node.shape))) {
    if (lowerDiamondFanExit) {
      return {
        left: { x: node.x! - node.width! / 4, y: node.y! + node.height! / 4 },
        right: { x: node.x! + node.width! / 4, y: node.y! + node.height! / 4 },
        top: { x: node.x!, y: rect.top },
        bottom: { x: node.x!, y: rect.bottom },
      }[side];
    }
    if (endpoint === 'end' || forceDiamondExitVertices) {
      // A decision's incoming flow reads most clearly when it resolves at a
      // vertex. Fanned outgoing branches also use vertices: side-midpoint
      // ports can force a lower branch through a sibling directly below it.
      return {
        top: { x: node.x!, y: rect.top },
        right: { x: rect.right, y: node.y! },
        bottom: { x: node.x!, y: rect.bottom },
        left: { x: rect.left, y: node.y! },
      }[side];
    }
    // Attach at the midpoint of a sloped diamond side. Using the cardinal
    // vertices gives decision branches an unnecessarily rigid, pinched look.
    // The offset chooses the adjacent sloped side when multiple edges leave
    // in the same general direction.
    const offset = index >= count / 2 ? 1 : -1;
    return {
      top: { x: node.x! + (offset * node.width!) / 4, y: node.y! - node.height! / 4 },
      right: { x: node.x! + node.width! / 4, y: node.y! + (offset * node.height!) / 4 },
      bottom: { x: node.x! + (offset * node.width!) / 4, y: node.y! + node.height! / 4 },
      left: { x: node.x! - node.width! / 4, y: node.y! + (offset * node.height!) / 4 },
    }[side];
  }
  if (side === 'top' || side === 'bottom') {
    return {
      x: forceCenter ? node.x! : distributedPortCoordinate(node.x!, node.width!, index, count),
      y: side === 'top' ? rect.top : rect.bottom,
    };
  }
  return {
    x: side === 'left' ? rect.left : rect.right,
    y: forceCenter ? node.y! : distributedPortCoordinate(node.y!, node.height!, index, count),
  };
}

function distributedPortCoordinate(
  center: number,
  size: number,
  index: number,
  count: number
): number {
  if (count <= 1) {
    return center;
  }
  // A side needs enough room for every incident edge. Fixed insets collapse
  // high-degree nodes, so retain a small corner clearance and share the rest.
  const span = Math.min((count - 1) * PORT_SPACING, Math.max(0, size - 4));
  return center - span / 2 + (span * index) / (count - 1);
}

function extendPort(point: Point, side: Side): Point {
  return {
    top: { x: point.x, y: point.y - CLEARANCE },
    right: { x: point.x + CLEARANCE, y: point.y },
    bottom: { x: point.x, y: point.y + CLEARANCE },
    left: { x: point.x - CLEARANCE, y: point.y },
  }[side];
}

function sideAtPort(rect: Rect, point: Point, fallback: Side): Side {
  if (Math.abs(point.x - rect.left) <= EPSILON) {
    return 'left';
  }
  if (Math.abs(point.x - rect.right) <= EPSILON) {
    return 'right';
  }
  if (Math.abs(point.y - rect.top) <= EPSILON) {
    return 'top';
  }
  if (Math.abs(point.y - rect.bottom) <= EPSILON) {
    return 'bottom';
  }
  return fallback;
}

function findRoute(
  start: Point,
  end: Point,
  obstacles: Rect[],
  gridSpacing: number,
  routedPaths: Point[][],
  forbidSharedLanes: boolean
): Point[] {
  if (
    segmentClear(start, end, obstacles) &&
    routeInteractionPenalty(start, end, routedPaths) === 0 &&
    (!forbidSharedLanes || !routeConflictsWithLane(start, end, routedPaths))
  ) {
    return [start, end];
  }

  const xs = new Set<number>([start.x, end.x]);
  const ys = new Set<number>([start.y, end.y]);
  for (const obstacle of obstacles) {
    xs.add(obstacle.left - CLEARANCE);
    xs.add(obstacle.right + CLEARANCE);
    ys.add(obstacle.top - CLEARANCE);
    ys.add(obstacle.bottom + CLEARANCE);
  }
  addGridLines(xs, ys, obstacles, gridSpacing);

  const points: Point[] = [];
  for (const x of xs) {
    for (const y of ys) {
      const point = { x, y };
      if (!obstacles.some((obstacle) => pointInRect(point, obstacle))) {
        points.push(point);
      }
    }
  }
  const startIndex = points.push(start) - 1;
  const endIndex = points.push(end) - 1;
  const route = shortestPath(
    points,
    visibilityGraph(points, obstacles, routedPaths, forbidSharedLanes),
    startIndex,
    endIndex
  );
  return route ? simplify(route) : [start, { x: start.x, y: end.y }, end];
}

function addGridLines(xs: Set<number>, ys: Set<number>, obstacles: Rect[], spacing: number): void {
  if (!Number.isFinite(spacing) || spacing <= 0 || obstacles.length === 0) {
    return;
  }
  const minX = Math.min(...obstacles.map((rect) => rect.left)) - spacing;
  const maxX = Math.max(...obstacles.map((rect) => rect.right)) + spacing;
  const minY = Math.min(...obstacles.map((rect) => rect.top)) - spacing;
  const maxY = Math.max(...obstacles.map((rect) => rect.bottom)) + spacing;
  for (let x = Math.floor(minX / spacing) * spacing; x <= maxX; x += spacing) {
    xs.add(x);
  }
  for (let y = Math.floor(minY / spacing) * spacing; y <= maxY; y += spacing) {
    ys.add(y);
  }
}

interface VisibilityEdge {
  to: number;
  length: number;
  axis: Axis;
}

function visibilityGraph(
  points: Point[],
  obstacles: Rect[],
  routedPaths: Point[][],
  forbidSharedLanes: boolean
): Map<number, VisibilityEdge[]> {
  const graph = new Map<number, VisibilityEdge[]>();
  const rows = new Map<number, number[]>();
  const columns = new Map<number, number[]>();
  points.forEach((point, index) => {
    add(rows, point.y, index);
    add(columns, point.x, index);
  });
  addLineEdges(rows, points, obstacles, routedPaths, forbidSharedLanes, 'H', graph);
  addLineEdges(columns, points, obstacles, routedPaths, forbidSharedLanes, 'V', graph);
  return graph;
}

function addLineEdges(
  lines: Map<number, number[]>,
  points: Point[],
  obstacles: Rect[],
  routedPaths: Point[][],
  forbidSharedLanes: boolean,
  axis: Axis,
  graph: Map<number, VisibilityEdge[]>
): void {
  for (const indices of lines.values()) {
    indices.sort((a, b) => (axis === 'H' ? points[a].x - points[b].x : points[a].y - points[b].y));
    for (let index = 1; index < indices.length; index++) {
      const a = indices[index - 1];
      const b = indices[index];
      if (
        segmentClear(points[a], points[b], obstacles) &&
        (!forbidSharedLanes || !routeConflictsWithLane(points[a], points[b], routedPaths))
      ) {
        const interactionPenalty = routeInteractionPenalty(points[a], points[b], routedPaths);
        addEdge(graph, a, b, points, axis, interactionPenalty);
        addEdge(graph, b, a, points, axis, interactionPenalty);
      }
    }
  }
}

function addEdge(
  graph: Map<number, VisibilityEdge[]>,
  from: number,
  to: number,
  points: Point[],
  axis: Axis,
  interactionPenalty: number
): void {
  const edges = graph.get(from) ?? [];
  edges.push({
    to,
    length:
      Math.abs(axis === 'H' ? points[to].x - points[from].x : points[to].y - points[from].y) +
      interactionPenalty,
    axis,
  });
  graph.set(from, edges);
}

function routeInteractionPenalty(a: Point, b: Point, routedPaths: Point[][]): number {
  let interactions = 0;
  for (const path of routedPaths) {
    for (let index = 1; index < path.length; index++) {
      if (segmentsInteract(a, b, path[index - 1], path[index])) {
        interactions++;
      }
    }
  }
  return interactions * ROUTE_INTERACTION_PENALTY;
}

function routeConflictsWithLane(a: Point, b: Point, routedPaths: Point[][]): boolean {
  const aHorizontal = Math.abs(a.y - b.y) <= EPSILON;
  for (const path of routedPaths) {
    for (let index = 1; index < path.length; index++) {
      const c = path[index - 1];
      const d = path[index];
      const cHorizontal = Math.abs(c.y - d.y) <= EPSILON;
      if (
        aHorizontal === cHorizontal &&
        (segmentsInteract(a, b, c, d) || parallelSegmentsTooClose(a, b, c, d, aHorizontal))
      ) {
        return true;
      }
    }
  }
  return false;
}

function parallelSegmentsTooClose(
  a: Point,
  b: Point,
  c: Point,
  d: Point,
  horizontal: boolean
): boolean {
  const laneGap = horizontal ? Math.abs(a.y - c.y) : Math.abs(a.x - c.x);
  if (laneGap >= ROUTE_LANE_CLEARANCE) {
    return false;
  }
  const aMin = horizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
  const aMax = horizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
  const cMin = horizontal ? Math.min(c.x, d.x) : Math.min(c.y, d.y);
  const cMax = horizontal ? Math.max(c.x, d.x) : Math.max(c.y, d.y);
  return Math.min(aMax, cMax) - Math.max(aMin, cMin) > EPSILON;
}

function segmentsInteract(a: Point, b: Point, c: Point, d: Point): boolean {
  const aHorizontal = Math.abs(a.y - b.y) <= EPSILON;
  const cHorizontal = Math.abs(c.y - d.y) <= EPSILON;
  if (aHorizontal === cHorizontal) {
    if (
      aHorizontal
        ? Math.abs(a.y - c.y) >= ROUTE_LANE_CLEARANCE
        : Math.abs(a.x - c.x) >= ROUTE_LANE_CLEARANCE
    ) {
      return false;
    }
    const aMin = aHorizontal ? Math.min(a.x, b.x) : Math.min(a.y, b.y);
    const aMax = aHorizontal ? Math.max(a.x, b.x) : Math.max(a.y, b.y);
    const cMin = aHorizontal ? Math.min(c.x, d.x) : Math.min(c.y, d.y);
    const cMax = aHorizontal ? Math.max(c.x, d.x) : Math.max(c.y, d.y);
    return Math.min(aMax, cMax) - Math.max(aMin, cMin) > EPSILON;
  }

  const horizontalStart = aHorizontal ? a : c;
  const horizontalEnd = aHorizontal ? b : d;
  const verticalStart = aHorizontal ? c : a;
  const verticalEnd = aHorizontal ? d : b;
  return (
    verticalStart.x > Math.min(horizontalStart.x, horizontalEnd.x) + EPSILON &&
    verticalStart.x < Math.max(horizontalStart.x, horizontalEnd.x) - EPSILON &&
    horizontalStart.y > Math.min(verticalStart.y, verticalEnd.y) + EPSILON &&
    horizontalStart.y < Math.max(verticalStart.y, verticalEnd.y) - EPSILON
  );
}

function shortestPath(
  points: Point[],
  graph: Map<number, VisibilityEdge[]>,
  start: number,
  end: number
): Point[] | undefined {
  interface State {
    vertex: number;
    axis: Axis | 'N';
  }
  const key = (state: State) => `${state.vertex}:${state.axis}`;
  const parse = (value: string): State => {
    const [vertex, axis] = value.split(':');
    return { vertex: Number(vertex), axis: axis as Axis | 'N' };
  };
  const startKey = key({ vertex: start, axis: 'N' });
  const distance = new Map<string, number>([[startKey, 0]]);
  const previous = new Map<string, string>();
  const queue = new Set<string>([startKey]);

  while (queue.size > 0) {
    let currentKey: string | undefined;
    for (const candidate of queue) {
      if (currentKey === undefined || distance.get(candidate)! < distance.get(currentKey)!) {
        currentKey = candidate;
      }
    }
    queue.delete(currentKey!);
    const current = parse(currentKey!);
    if (current.vertex === end) {
      const path: Point[] = [];
      for (let cursor: string | undefined = currentKey; cursor; cursor = previous.get(cursor)) {
        path.push(points[parse(cursor).vertex]);
      }
      return path.reverse();
    }
    for (const edge of graph.get(current.vertex) ?? []) {
      const nextKey = key({ vertex: edge.to, axis: edge.axis });
      const candidate =
        distance.get(currentKey!)! +
        edge.length +
        (current.axis !== 'N' && current.axis !== edge.axis ? TURN_PENALTY : 0);
      if (candidate < (distance.get(nextKey) ?? Number.POSITIVE_INFINITY)) {
        distance.set(nextKey, candidate);
        previous.set(nextKey, currentKey!);
        queue.add(nextKey);
      }
    }
  }
  return undefined;
}

function segmentClear(a: Point, b: Point, obstacles: Rect[]): boolean {
  return obstacles.every((obstacle) => !segmentIntersectsRect(a, b, obstacle));
}

function segmentIntersectsRect(a: Point, b: Point, rect: Rect): boolean {
  if (Math.abs(a.x - b.x) <= EPSILON) {
    return (
      a.x > rect.left + EPSILON &&
      a.x < rect.right - EPSILON &&
      Math.max(a.y, b.y) > rect.top + EPSILON &&
      Math.min(a.y, b.y) < rect.bottom - EPSILON
    );
  }
  if (Math.abs(a.y - b.y) <= EPSILON) {
    return (
      a.y > rect.top + EPSILON &&
      a.y < rect.bottom - EPSILON &&
      Math.max(a.x, b.x) > rect.left + EPSILON &&
      Math.min(a.x, b.x) < rect.right - EPSILON
    );
  }
  return true;
}

function pointInRect(point: Point, rect: Rect): boolean {
  return (
    point.x > rect.left + EPSILON &&
    point.x < rect.right - EPSILON &&
    point.y > rect.top + EPSILON &&
    point.y < rect.bottom - EPSILON
  );
}

function simplify(points: Point[]): Point[] {
  const output: Point[] = [];
  for (const point of points) {
    const previous = output.at(-1);
    if (
      !previous ||
      Math.abs(previous.x - point.x) > EPSILON ||
      Math.abs(previous.y - point.y) > EPSILON
    ) {
      output.push(point);
    }
  }
  for (let index = output.length - 2; index > 0; index--) {
    const a = output[index - 1];
    const b = output[index];
    const c = output[index + 1];
    if (
      (Math.abs(a.x - b.x) <= EPSILON && Math.abs(b.x - c.x) <= EPSILON) ||
      (Math.abs(a.y - b.y) <= EPSILON && Math.abs(b.y - c.y) <= EPSILON)
    ) {
      output.splice(index, 1);
    }
  }
  return output;
}

function pointAtHalfLength(points: Point[]): Point {
  const lengths = points
    .slice(1)
    .map(
      (point, index) => Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y)
    );
  const half = lengths.reduce((sum, length) => sum + length, 0) / 2;
  let traveled = 0;
  for (const [index, length_] of lengths.entries()) {
    if (traveled + length_ >= half) {
      const ratio = (half - traveled) / length_;
      return {
        x: points[index].x + (points[index + 1].x - points[index].x) * ratio,
        y: points[index].y + (points[index + 1].y - points[index].y) * ratio,
      };
    }
    traveled += length_;
  }
  return points.at(-1) ?? { x: 0, y: 0 };
}

/**
 * Branch labels read best at the centre of their main run. A total-path
 * midpoint drifts upward when a short lateral departure is followed by a long
 * vertical segment, making "Yes" and "No" look visibly off-centre.
 */
function pointAtDominantSegment(points: Point[]): Point {
  let longestIndex = 0;
  let longestLength = -1;
  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const length = Math.abs(end.x - start.x) + Math.abs(end.y - start.y);
    if (length > longestLength) {
      longestIndex = index - 1;
      longestLength = length;
    }
  }
  const start = points[longestIndex] ?? { x: 0, y: 0 };
  const end = points[longestIndex + 1] ?? start;
  return { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
}

function selfLoop(rect: Rect, gridSpacing: number): Point[] {
  const x = (rect.left + rect.right) / 2;
  const reach = Math.max(CLEARANCE, gridSpacing / 4);
  return [
    { x: x - PORT_SPACING / 2, y: rect.top },
    { x: x - PORT_SPACING / 2, y: rect.top - reach },
    { x: x + PORT_SPACING / 2, y: rect.top - reach },
    { x: x + PORT_SPACING / 2, y: rect.top },
  ];
}
