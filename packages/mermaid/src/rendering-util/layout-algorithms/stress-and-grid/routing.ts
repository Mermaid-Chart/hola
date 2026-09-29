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
    .map(rectFor)
    .filter((rect): rect is Rect => rect !== undefined);
  const groupFrames = obstacles.filter((obstacle) => obstacle.node.isGroup === true);
  const symmetricDiamondFans = new Set(
    [...nodes.values()]
      .filter((node) => isSymmetricDiamondFan(node, data.edges, nodes))
      .map((node) => node.id)
  );
  const ports = allocatePorts(data.edges, nodes);
  const routedPaths: Point[][] = [];
  // Labels need the same clearance as nodes. In particular, a short labelled
  // branch is commonly routed before a longer incoming edge; reserving its
  // measured area prevents that later edge from threading through the label.
  const labelObstacles: Rect[] = [];

  for (const edge of [...data.edges].sort((a, b) => edgeSpan(a, nodes) - edgeSpan(b, nodes))) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const sourceRect = source && rectFor(source);
    const targetRect = target && rectFor(target);
    if (!source || !target || !sourceRect || !targetRect) {
      continue;
    }
    // A frame is an obstacle to an unrelated edge, but it must remain open
    // for an edge leaving or entering one of its descendants. Otherwise a
    // cross-container edge can cut through a sibling subgraph simply because
    // group frames were omitted from the visibility graph.
    const routingObstacles = [
      ...obstacles.filter(
        (obstacle) =>
          !obstacle.node.isGroup || !isEndpointContainer(obstacle.node, source, target, nodes)
      ),
      ...labelObstacles,
    ];
    const hasGroupEndpoint = source.isGroup === true || target.isGroup === true;
    let points =
      source === target
        ? selfLoop(sourceRect, gridSpacing)
        : (routeStraightReciprocalOfLabeledEdge(
            edge,
            sourceRect,
            targetRect,
            data.edges,
            routingObstacles,
            routedPaths
          ) ??
          routeLabelledLowerRightFan(
            edge,
            sourceRect,
            targetRect,
            data.edges,
            routingObstacles,
            routedPaths
          ) ??
          routeWithLabelClearance(edge, sourceRect, targetRect, routingObstacles, routedPaths) ??
          routeSymmetricDiamondFan(
            source,
            target,
            ports.get(`${edge.id}:start`)!,
            ports.get(`${edge.id}:end`)!,
            symmetricDiamondFans.has(source.id),
            routingObstacles,
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
            routingObstacles,
            gridSpacing,
            routedPaths
          ));
    points = separateSharedRouteLane(points, routingObstacles, routedPaths);
    const label = (edge.label ?? edge.text ?? '').trim();
    const dominantLabelPoint = label ? pointAtDominantSegment(points) : undefined;
    const dimensions = label ? labelDimensions(label) : undefined;
    const dominantLabelStraddlesGroupBorder = Boolean(
      label &&
        dominantLabelPoint &&
        dimensions &&
        labelStraddlesGroupBorder(
          dominantLabelPoint,
          dimensions.width,
          dimensions.height,
          groupFrames
        )
    );
    const groupLabelRoute =
      // Moving a label to a different segment of the existing route is not
      // enough here: renderer-side text measurement can make that segment
      // unsafe again. For cross-frame edges, reserve an explicit lane outside
      // both frame hierarchies so the route and label stay coupled.
      label && dominantLabelStraddlesGroupBorder
        ? routeWithGroupSafeLabelLane(
            sourceRect,
            targetRect,
            source,
            target,
            nodes,
            groupFrames,
            routingObstacles,
            routedPaths,
            label
          )
        : undefined;
    const safeLabelPoint = groupLabelRoute
      ? undefined
      : !dominantLabelStraddlesGroupBorder
        ? dominantLabelPoint
        : pointOnGroupSafeSegment(points, label, groupFrames);
    if (groupLabelRoute) {
      points = groupLabelRoute.points;
    }
    let labelPoint = label
      ? (safeLabelPoint ??
        groupLabelRoute?.labelPoint ??
        pointOnGroupSafeSegment(points, label, groupFrames) ??
        pointAtDominantSegment(points))
      : pointAtHalfLength(points);
    if (
      label &&
      !hasGroupEndpoint &&
      !groupLabelRoute &&
      labelOverlapsRoutedPath(labelPoint, label, routedPaths)
    ) {
      const dedicatedLabelRoute = routeWithDedicatedLabelCorridor(
        sourceRect,
        targetRect,
        routingObstacles,
        routedPaths,
        label
      );
      if (dedicatedLabelRoute) {
        points = dedicatedLabelRoute.points;
        labelPoint = dedicatedLabelRoute.labelPoint;
      }
    }
    edge.points = points;
    routedPaths.push(points);
    edge.x = labelPoint.x;
    edge.y = labelPoint.y;
    if (label) {
      labelObstacles.push(labelObstacle(labelPoint, label));
    }
    // Rounded corners retain the exact obstacle-avoiding polyline while
    // matching ELK's polished edge treatment.
    edge.curve = 'rounded';
    edge.roundedCornerRadius = Math.min(16, gridSpacing / 8);
    edge.hasIntersectionPoints = true;
  }
}

/**
 * When two disjoint frame hierarchies leave no label-sized gap between their
 * borders, run the edge through an outside lane. The label remains centered
 * on that horizontal lane instead of straddling either frame.
 */
function routeWithGroupSafeLabelLane(
  source: Rect,
  target: Rect,
  sourceNode: Node,
  targetNode: Node,
  nodes: Map<string, Node>,
  groupFrames: Rect[],
  obstacles: Rect[],
  routedPaths: Point[][],
  label: string
): { points: Point[]; labelPoint: Point } | undefined {
  const sourceFrames = ancestorFrames(sourceNode, groupFrames, nodes);
  const targetFrames = ancestorFrames(targetNode, groupFrames, nodes);
  if (
    sourceFrames.length === 0 ||
    targetFrames.length === 0 ||
    sourceFrames.some((frame) => targetFrames.includes(frame)) ||
    source.node.x! >= target.node.x!
  ) {
    return undefined;
  }

  const { width, height } = labelDimensions(label);
  const sourceRight = Math.max(source.right, ...sourceFrames.map((frame) => frame.right));
  const top = Math.min(
    source.top,
    target.top,
    ...sourceFrames.map((frame) => frame.top),
    ...targetFrames.map((frame) => frame.top)
  );
  const laneY = top - height / 2 - LABEL_CLEARANCE;
  const sourceEscapeX = sourceRight + CLEARANCE;
  const points = simplify([
    { x: source.right, y: source.node.y! },
    { x: sourceEscapeX, y: source.node.y! },
    { x: sourceEscapeX, y: laneY },
    { x: target.node.x!, y: laneY },
    { x: target.node.x!, y: target.top },
  ]);
  const labelPoint = { x: (sourceEscapeX + target.node.x!) / 2, y: laneY };
  return routeIsClear(points, obstacles, routedPaths) &&
    !labelStraddlesGroupBorder(labelPoint, width, height, groupFrames)
    ? { points, labelPoint }
    : undefined;
}

function ancestorFrames(node: Node, frames: Rect[], nodes: Map<string, Node>): Rect[] {
  return frames.filter((frame) => frame.node === node || isAncestorOf(frame.node, node, nodes));
}

/**
 * A label belongs on a real route segment, but the longest segment may be the
 * one which crosses a frame boundary. Prefer another point on the polyline
 * whose measured label box clears every group border.
 */
function pointOnGroupSafeSegment(
  points: Point[],
  label: string,
  groupFrames: Rect[]
): Point | undefined {
  const { width, height } = labelDimensions(label);
  const candidates: { point: Point; distanceFromCenter: number }[] = [];

  for (let index = 1; index < points.length; index++) {
    const start = points[index - 1];
    const end = points[index];
    const horizontal = Math.abs(start.y - end.y) <= EPSILON;
    const minimum = horizontal ? Math.min(start.x, end.x) : Math.min(start.y, end.y);
    const maximum = horizontal ? Math.max(start.x, end.x) : Math.max(start.y, end.y);
    const halfLabelSpan = (horizontal ? width : height) / 2 + LABEL_CLEARANCE;
    if (maximum - minimum < halfLabelSpan * 2) {
      continue;
    }
    const middle = (minimum + maximum) / 2;
    const coordinates = new Set<number>([middle, minimum + halfLabelSpan, maximum - halfLabelSpan]);
    for (const frame of groupFrames) {
      const borders = horizontal ? [frame.left, frame.right] : [frame.top, frame.bottom];
      for (const border of borders) {
        coordinates.add(border - halfLabelSpan);
        coordinates.add(border + halfLabelSpan);
      }
    }

    for (const coordinate of coordinates) {
      if (
        coordinate < minimum + halfLabelSpan - EPSILON ||
        coordinate > maximum - halfLabelSpan + EPSILON
      ) {
        continue;
      }
      const point = horizontal ? { x: coordinate, y: start.y } : { x: start.x, y: coordinate };
      if (labelStraddlesGroupBorder(point, width, height, groupFrames)) {
        continue;
      }
      candidates.push({ point, distanceFromCenter: Math.abs(coordinate - middle) });
    }
  }

  return candidates.sort((left, right) => left.distanceFromCenter - right.distanceFromCenter)[0]
    ?.point;
}

function labelStraddlesGroupBorder(
  point: Point,
  width: number,
  height: number,
  groupFrames: Rect[]
): boolean {
  const bounds: Bounds = {
    left: point.x - width / 2,
    right: point.x + width / 2,
    top: point.y - height / 2,
    bottom: point.y + height / 2,
  };
  return groupFrames.some(
    (frame) =>
      (((bounds.left < frame.left - EPSILON && bounds.right > frame.left + EPSILON) ||
        (bounds.left < frame.right - EPSILON && bounds.right > frame.right + EPSILON)) &&
        bounds.bottom > frame.top + EPSILON &&
        bounds.top < frame.bottom - EPSILON) ||
      (((bounds.top < frame.top - EPSILON && bounds.bottom > frame.top + EPSILON) ||
        (bounds.top < frame.bottom - EPSILON && bounds.bottom > frame.bottom + EPSILON)) &&
        bounds.right > frame.left + EPSILON &&
        bounds.left < frame.right - EPSILON)
  );
}

function isEndpointContainer(
  group: Node,
  source: Node,
  target: Node,
  nodes: Map<string, Node>
): boolean {
  return (
    group === source ||
    group === target ||
    isAncestorOf(group, source, nodes) ||
    isAncestorOf(group, target, nodes)
  );
}

function isAncestorOf(group: Node, node: Node, nodes: Map<string, Node>): boolean {
  let parentId = node.parentId;
  while (parentId) {
    if (parentId === group.id) {
      return true;
    }
    parentId = nodes.get(parentId)?.parentId;
  }
  return false;
}

/**
 * The visibility graph normally rejects an occupied lane. Its endpoint
 * fallback can still return one when a dense fan has no other graph route.
 * Replace that shared interior run with a small perpendicular dogleg, keeping
 * the assigned endpoint ports intact.
 */
function separateSharedRouteLane(
  points: Point[],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] {
  // The first and last segments are port stubs. Moving one of them to avoid
  // a shared lane violates the port direction and can make a frame-anchored
  // edge run along its own border. Only separate genuine interior runs.
  for (let index = 2; index < points.length - 1; index++) {
    const start = points[index - 1];
    const end = points[index];
    const horizontal = Math.abs(start.y - end.y) <= EPSILON;
    for (const path of routedPaths) {
      for (let otherIndex = 1; otherIndex < path.length; otherIndex++) {
        const otherStart = path[otherIndex - 1];
        const otherEnd = path[otherIndex];
        const otherHorizontal = Math.abs(otherStart.y - otherEnd.y) <= EPSILON;
        if (horizontal !== otherHorizontal || !segmentsOverlap(start, end, otherStart, otherEnd)) {
          continue;
        }
        for (const offset of [-PORT_SPACING, PORT_SPACING]) {
          const shiftedStart = horizontal
            ? { x: start.x, y: start.y + offset }
            : { x: start.x + offset, y: start.y };
          const shiftedEnd = horizontal
            ? { x: end.x, y: end.y + offset }
            : { x: end.x + offset, y: end.y };
          const candidate = simplify([
            ...points.slice(0, index),
            shiftedStart,
            shiftedEnd,
            ...points.slice(index),
          ]);
          if (routeIsClear(candidate, obstacles, routedPaths)) {
            return candidate;
          }
        }
      }
    }
  }
  return points;
}

function segmentsOverlap(a: Point, b: Point, c: Point, d: Point): boolean {
  if (Math.abs(a.y - b.y) <= EPSILON) {
    return (
      Math.abs(a.y - c.y) <= EPSILON &&
      Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
        Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x)) >=
        ROUTE_LANE_CLEARANCE
    );
  }
  return (
    Math.abs(a.x - c.x) <= EPSILON &&
    Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
      Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y)) >=
      ROUTE_LANE_CLEARANCE
  );
}

function routeIsClear(points: Point[], obstacles: Rect[], routedPaths: Point[][]): boolean {
  return points.slice(1).every((point, index) => {
    const start = points[index];
    return (
      segmentClear(start, point, obstacles) &&
      routeInteractionPenalty(start, point, routedPaths) === 0
    );
  });
}

/**
 * A lower-right labelled branch that has been given its own row gets a short
 * central vertical corridor. This is clearer than wrapping its label around a
 * horizontal sibling, and keeps the label on the edge.
 */
function routeLabelledLowerRightFan(
  edge: Edge,
  source: Rect,
  target: Rect,
  edges: Edge[],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (
    !label ||
    /diamond|rhombus/.test(String(source.node.shape)) ||
    edges.filter((candidate) => candidate.start === source.node.id && candidate.end).length < 4 ||
    target.node.x! <= source.node.x! ||
    target.node.y! - source.node.y! < (source.node.height! + target.node.height!) / 2 + 120
  ) {
    return undefined;
  }
  const start = {
    x: source.right,
    y: source.node.y! + verticalPortOffset(source),
  };
  const escapeX = source.right + CLEARANCE;
  const targetPort = { x: target.node.x!, y: target.top };
  const left = Math.min(escapeX, targetPort.x);
  const right = Math.max(escapeX, targetPort.x);
  const laneY = Math.max(
    source.bottom + CLEARANCE,
    ...obstacles
      .filter(
        (obstacle) =>
          obstacle.node !== source.node &&
          obstacle.node !== target.node &&
          obstacle.right > left + EPSILON &&
          obstacle.left < right - EPSILON &&
          obstacle.bottom > start.y + EPSILON &&
          obstacle.top < target.top - EPSILON
      )
      .map((obstacle) => obstacle.bottom + CLEARANCE)
  );
  if (laneY >= targetPort.y - LABEL_HEIGHT - LABEL_CLEARANCE) {
    return undefined;
  }
  const points = simplify([
    start,
    { x: escapeX, y: start.y },
    { x: escapeX, y: laneY },
    { x: targetPort.x, y: laneY },
    targetPort,
  ]);
  const labelPoint = { x: targetPort.x, y: (laneY + targetPort.y) / 2 };
  return labelCorridorIsClear(points, labelPoint, source, target, obstacles, routedPaths, label)
    ? points
    : undefined;
}

function labelObstacle(point: Point, label: string): Rect {
  const { width, height } = labelDimensions(label);
  return {
    // Routing only needs the bounds; this sentinel distinguishes a reserved
    // label from real node obstacles without changing the shared Node type.
    node: {} as Node,
    left: point.x - width / 2 - LABEL_CLEARANCE,
    right: point.x + width / 2 + LABEL_CLEARANCE,
    top: point.y - height / 2 - LABEL_CLEARANCE,
    bottom: point.y + height / 2 + LABEL_CLEARANCE,
  };
}

function labelDimensions(label: string): { width: number; height: number } {
  const lines = label
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .split('\n');
  return {
    width: Math.max(40, ...lines.map((line) => line.trim().length * 8)),
    height: Math.max(LABEL_HEIGHT, lines.length * LABEL_HEIGHT),
  };
}

function labelOverlapsRoutedPath(point: Point, label: string, routedPaths: Point[][]): boolean {
  return boundsOverlapRoutedPath(labelBounds(point, label), routedPaths);
}

function labelBounds(point: Point, label: string): Bounds {
  const { width, height } = labelDimensions(label);
  return {
    left: point.x - width / 2,
    right: point.x + width / 2,
    top: point.y - height / 2,
    bottom: point.y + height / 2,
  };
}

function boundsOverlapRoutedPath(bounds: Bounds, routedPaths: Point[][]): boolean {
  return routedPaths.some((path) =>
    path.slice(1).some((point, index) => segmentIntersectsBounds(path[index], point, bounds))
  );
}

function segmentIntersectsBounds(a: Point, b: Point, bounds: Bounds): boolean {
  if (Math.abs(a.x - b.x) <= EPSILON) {
    return (
      a.x > bounds.left + EPSILON &&
      a.x < bounds.right - EPSILON &&
      Math.max(a.y, b.y) > bounds.top + EPSILON &&
      Math.min(a.y, b.y) < bounds.bottom - EPSILON
    );
  }
  return (
    a.y > bounds.top + EPSILON &&
    a.y < bounds.bottom - EPSILON &&
    Math.max(a.x, b.x) > bounds.left + EPSILON &&
    Math.min(a.x, b.x) < bounds.right - EPSILON
  );
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
  const { width: labelWidth, height: labelHeight } = labelDimensions(label);
  const horizontal = Math.abs(source.node.y! - target.node.y!) <= EPSILON;
  const vertical = Math.abs(source.node.x! - target.node.x!) <= EPSILON;

  if (horizontal) {
    const gap =
      Math.abs(source.node.x! - target.node.x!) - (source.node.width! + target.node.width!) / 2;
    if (gap < labelWidth + LABEL_CLEARANCE * 2) {
      return chooseLabelLane(
        [
          labelLaneForHorizontalPair(source, target, 'top', labelHeight),
          labelLaneForHorizontalPair(source, target, 'bottom', labelHeight),
        ],
        source,
        target,
        obstacles,
        routedPaths,
        labelWidth,
        labelHeight
      );
    }
  }

  if (vertical) {
    const gap =
      Math.abs(source.node.y! - target.node.y!) - (source.node.height! + target.node.height!) / 2;
    if (gap < labelHeight + LABEL_CLEARANCE * 2) {
      return chooseLabelLane(
        [
          labelLaneForVerticalPair(source, target, 'left', labelWidth),
          labelLaneForVerticalPair(source, target, 'right', labelWidth),
        ],
        source,
        target,
        obstacles,
        routedPaths,
        labelWidth,
        labelHeight
      );
    }
  }

  return undefined;
}

/**
 * Used only after the normal route has placed a label on an existing edge.
 * Unlike ordinary label clearance, this may use an outside lane for diagonal
 * pairs as well: the central segment becomes a dedicated label corridor.
 */
function routeWithDedicatedLabelCorridor(
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][],
  label: string
): { points: Point[]; labelPoint: Point } | undefined {
  const { width, height } = labelDimensions(label);
  const points = chooseLabelLane(
    [
      labelLaneForHorizontalPair(source, target, 'top', height),
      labelLaneForHorizontalPair(source, target, 'bottom', height),
      labelLaneForVerticalPair(source, target, 'left', width),
      labelLaneForVerticalPair(source, target, 'right', width),
    ],
    source,
    target,
    obstacles,
    routedPaths,
    width,
    height
  );
  if (points) {
    return { points, labelPoint: pointAtLabelLaneBridge(points) };
  }
  return routeWithOuterVerticalLabelCorridor(source, target, obstacles, routedPaths, label);
}

/**
 * A diagonal labelled edge can be boxed in by siblings on both sides. Route
 * around the source's near horizontal boundary, then use an outside vertical
 * run as the label's actual (rather than merely visual) corridor.
 */
function routeWithOuterVerticalLabelCorridor(
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][],
  label: string
): { points: Point[]; labelPoint: Point } | undefined {
  const { width } = labelDimensions(label);
  const downwards = target.node.y! >= source.node.y!;
  const crossY = downwards ? source.bottom + CLEARANCE : source.top - CLEARANCE;
  const sourcePortY =
    source.node.y! + (downwards ? verticalPortOffset(source) : -verticalPortOffset(source));
  const targetPortY =
    target.node.y! + (downwards ? -verticalPortOffset(target) : verticalPortOffset(target));
  const candidates = (['left', 'right'] as const)
    .map((side) => {
      const sourcePort = {
        x: side === 'left' ? source.left : source.right,
        y: sourcePortY,
      };
      const targetPort = {
        x: side === 'left' ? target.left : target.right,
        y: targetPortY,
      };
      const escapeX = sourcePort.x + (side === 'left' ? -CLEARANCE : CLEARANCE);
      const laneX =
        side === 'left'
          ? Math.min(source.left, target.left) - width / 2 - LABEL_CLEARANCE
          : Math.max(source.right, target.right) + width / 2 + LABEL_CLEARANCE;
      const points = simplify([
        sourcePort,
        { x: escapeX, y: sourcePort.y },
        { x: escapeX, y: crossY },
        { x: laneX, y: crossY },
        { x: laneX, y: targetPort.y },
        targetPort,
      ]);
      return { points, labelPoint: { x: laneX, y: (crossY + targetPort.y) / 2 } };
    })
    .filter(({ points, labelPoint }) =>
      labelCorridorIsClear(points, labelPoint, source, target, obstacles, routedPaths, label)
    )
    .sort((a, b) => pathLength(a.points) - pathLength(b.points));
  return candidates[0];
}

function labelCorridorIsClear(
  points: Point[],
  labelPoint: Point,
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][],
  label: string
): boolean {
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return (
    points.length >= 4 &&
    points.slice(1).every((point, index) => segmentClear(points[index], point, otherObstacles)) &&
    points
      .slice(1)
      .every((point, index) => routeInteractionPenalty(points[index], point, routedPaths) === 0) &&
    otherObstacles.every(
      (obstacle) => !rectanglesOverlap(labelBounds(labelPoint, label), obstacle)
    ) &&
    !boundsOverlapRoutedPath(labelBounds(labelPoint, label), routedPaths)
  );
}

function labelLaneForHorizontalPair(
  source: Rect,
  target: Rect,
  side: 'top' | 'bottom',
  labelHeight = LABEL_HEIGHT
): Point[] {
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
      ? Math.min(source.top, target.top) - labelHeight / 2 - LABEL_CLEARANCE
      : Math.max(source.bottom, target.bottom) + labelHeight / 2 + LABEL_CLEARANCE;
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
  labelWidth: number,
  labelHeight: number
): Point[] | undefined {
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  const candidatesWithScores = candidates
    .map(simplify)
    .filter((candidate) =>
      labelLaneIsClear(candidate, otherObstacles, routedPaths, labelWidth, labelHeight)
    )
    .map((candidate) => ({ candidate, length: pathLength(candidate) }))
    .sort((a, b) => a.length - b.length);
  return candidatesWithScores[0]?.candidate;
}

function labelLaneIsClear(
  candidate: Point[],
  obstacles: Rect[],
  routedPaths: Point[][],
  labelWidth: number,
  labelHeight: number
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
  const midpoint = pointAtLabelLaneBridge(candidate);
  const bridge =
    candidate[1].x === candidate[2].x
      ? Math.abs(candidate[2].y - candidate[1].y)
      : Math.abs(candidate[2].x - candidate[1].x);
  const bridgeRequirement = candidate[1].x === candidate[2].x ? labelHeight : labelWidth;
  if (bridge < bridgeRequirement + LABEL_CLEARANCE * 2) {
    return false;
  }
  const labelRect: Bounds = {
    left: midpoint.x - labelWidth / 2,
    right: midpoint.x + labelWidth / 2,
    top: midpoint.y - labelHeight / 2,
    bottom: midpoint.y + labelHeight / 2,
  };
  return (
    obstacles.every((obstacle) => !rectanglesOverlap(labelRect, obstacle)) &&
    !boundsOverlapRoutedPath(labelRect, routedPaths)
  );
}

function pointAtLabelLaneBridge(points: Point[]): Point {
  return {
    x: (points[1].x + points[2].x) / 2,
    y: (points[1].y + points[2].y) / 2,
  };
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
      const port = portOnSide(
        node,
        side,
        value.endpoint,
        index,
        values.length,
        supportsCenteredPort(node) && alignedCount === 1 && isAxisAligned(node, value.edge, nodes),
        forceDiamondExitVertices,
        symmetricDiamondFans.has(node.id) && value.endpoint === 'start'
      );
      ports.set(
        `${value.edge.id}:${value.endpoint}`,
        offsetGroupPortTowardCounterpart(node, port, side, value.edge, value.endpoint, nodes)
      );
    });
  }
  return ports;
}

/**
 * A frame-level connection competes with the routes of its contents at the
 * frame boundary. Give a lone, non-axis-aligned group port a modest lead in
 * the direction of its counterpart, rather than placing it exactly on the
 * internal child's centre line.
 */
function offsetGroupPortTowardCounterpart(
  node: Node,
  port: Point,
  side: Side,
  edge: Edge,
  endpoint: 'start' | 'end',
  nodes: Map<string, Node>
): Point {
  if (!node.isGroup || isAxisAligned(node, edge, nodes)) {
    return port;
  }
  const otherId = endpoint === 'start' ? edge.end : edge.start;
  const other = otherId ? nodes.get(otherId) : undefined;
  if (!other) {
    return port;
  }
  const rect = rectFor(node)!;
  const offset = PORT_SPACING;
  if (side === 'left' || side === 'right') {
    const direction = Math.sign(other.y! - node.y!);
    if (direction === 0) {
      return port;
    }
    return {
      ...port,
      y: Math.max(rect.top + 2, Math.min(rect.bottom - 2, port.y + direction * offset)),
    };
  }
  const direction = Math.sign(other.x! - node.x!);
  if (direction === 0) {
    return port;
  }
  return {
    ...port,
    x: Math.max(rect.left + 2, Math.min(rect.right - 2, port.x + direction * offset)),
  };
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
