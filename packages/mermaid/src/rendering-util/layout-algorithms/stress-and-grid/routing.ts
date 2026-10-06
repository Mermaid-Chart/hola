import type { Edge, LayoutData, Node } from '../../types.js';
import {
  captionDimensions,
  estimateCaptionDimensions as labelDimensions,
} from './captionGeometry.js';
import { projectToSlantedNodeOutline } from '../layout-utils/slantedNodeOutline.js';
import {
  isolatedDiamondCircleBundle,
  DIAMOND_CIRCLE_PORT_MARGIN,
  DIAMOND_CIRCLE_PORT_SPAN,
} from './diamondCircleBundle.js';
import { nestedShortcutFan, nestedShortcutRoutes } from './nestedShortcutFan.js';
import { cardinalDiamondFanPorts } from './cardinalDiamondFan.js';
import { nestedFrameEntryRoutes } from './nestedFrameEntry.js';
import { nestedLinearWorkflowPorts, nestedLinearWorkflowRoutes } from './nestedLinearWorkflow.js';
import { externalSiblingFrameCycleRoutes } from './frameGrid.js';

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
// Leave visible clearance from corners even when a short side compresses a fan.
const PORT_CORNER_CLEARANCE = 4;
// Short sides need proportional insets for bundles and centred three-port fans.
const RECTANGULAR_PORT_CORNER_FRACTION = 0.16;
const TURN_PENALTY = 12;
const ROUTE_INTERACTION_PENALTY = 10_000;
const ROUTE_LANE_CLEARANCE = 8;
const LARGE_NODE_CLEARANCE_THRESHOLD = 200;
// Edge labels are measured by the renderer, after layout. Reserve a
// deliberately conservative estimate here so a narrow node-to-node gap does
// not become the label's only available space.
const LABEL_CLEARANCE = 12;
const LABEL_HEIGHT = 24;
const PARALLEL_BUNDLE_CORNER_CLEARANCE = 12;
const LABELLED_PARALLEL_BUNDLE_CORNER_CLEARANCE = 40;
const PARALLEL_BUNDLE_LANE_GAP = 4;
const AXIS_ALIGNMENT_TOLERANCE = 8;
// Keep obstacle checks consistent with the final validator. A line within two
// pixels of a boundary is visually tangent after stroke width and browser
// antialiasing are applied; only runs of at least twelve pixels are rejected.
const BORDER_HUG_PROXIMITY = 2;
const BORDER_HUG_MIN_LENGTH = 12;
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
  // Local layout preferences must not become persistent user constraints.
  // Route projected copies and commit only the resulting geometry/style.
  const workflowPreferences = nestedLinearWorkflowPorts(data);
  const outputEdges = new Map(data.edges.map((edge) => [edge.id, edge]));
  const routingEdges = data.edges.map((edge) => {
    const preference = workflowPreferences.get(edge.id);
    return preference ? { ...edge, ...preference } : edge;
  });
  const routingData = { ...data, edges: routingEdges };
  const diamondCircleBundle = isolatedDiamondCircleBundle(data);
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const obstacles = [...nodes.values()]
    .map(rectFor)
    .filter((rect): rect is Rect => rect !== undefined);
  const groupFrames = obstacles.filter((obstacle) => obstacle.node.isGroup === true);
  const symmetricDiamondFans = new Set(
    [...nodes.values()]
      .filter((node) => isSymmetricDiamondFan(node, routingEdges, nodes))
      .map((node) => node.id)
  );
  const symmetricLateralDiamondFans = new Set(
    [...nodes.values()]
      .filter((node) => isSymmetricDiamondFan(node, routingEdges, nodes, 'H'))
      .map((node) => node.id)
  );
  const ports = allocatePorts(routingEdges, nodes);
  for (const [key, point] of cardinalDiamondFanPorts(data)) {
    ports.set(key, point);
  }
  const shortcutRoutes = nestedShortcutRoutes(nestedShortcutFan(data));
  for (const [edgeId, route] of shortcutRoutes) {
    ports.set(`${edgeId}:start`, route[0]);
    ports.set(`${edgeId}:end`, route.at(-1)!);
  }
  const nestedEntryRoutes = nestedFrameEntryRoutes(data);
  for (const [edgeId, route] of nestedEntryRoutes) {
    ports.set(`${edgeId}:start`, route.points[0]);
    ports.set(`${edgeId}:end`, route.points.at(-1)!);
  }
  const externalCycleRoutes = externalSiblingFrameCycleRoutes(data);
  for (const [edgeId, points] of externalCycleRoutes) {
    ports.set(`${edgeId}:start`, points[0]);
    ports.set(`${edgeId}:end`, points.at(-1)!);
  }
  const workflowRoutes = nestedLinearWorkflowRoutes(data, ports);
  const routedPaths: Point[][] = [];
  // Labels need the same clearance as nodes. In particular, a short labelled
  // branch is commonly routed before a longer incoming edge; reserving its
  // measured area prevents that later edge from threading through the label.
  const labelObstacles: Rect[] = [];

  // Commit mutually checked nested-entry corridors first. Their labels and
  // paths then participate in ordinary routing, irrespective of edge order or
  // the length of an unrelated link.
  const reserved = (edge: Edge) => nestedEntryRoutes.has(edge.id) || workflowRoutes.has(edge.id);
  const orderedEdges = [...routingEdges].sort(
    (a, b) => Number(reserved(b)) - Number(reserved(a)) || edgeSpan(a, nodes) - edgeSpan(b, nodes)
  );
  for (const edge of orderedEdges) {
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
    const startPort = ports.get(`${edge.id}:start`)!;
    const endPort = ports.get(`${edge.id}:end`)!;
    // Specialized workflow/label corridors must not silently replace a
    // diamond's globally allocated port with a rectangular side or vertex.
    const preserveDiamondPorts = (candidate: Point[]): Point[] => {
      if (source === target) {
        return candidate;
      }
      const matches = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y) <= EPSILON;
      if (
        (!isDiamondNode(source) || matches(candidate[0], startPort)) &&
        (!isDiamondNode(target) || matches(candidate.at(-1)!, endPort))
      ) {
        return candidate;
      }
      return routeAvoidingEndpoints(
        startPort,
        edge.startSide ?? sideAtPort(sourceRect, startPort, sideToward(source, target, 'start')),
        endPort,
        edge.endSide ?? sideAtPort(targetRect, endPort, sideToward(target, source, 'end')),
        sourceRect,
        targetRect,
        routingEdges.filter(
          (candidate) => candidate.start === target.id || candidate.end === target.id
        ).length,
        routingObstacles,
        gridSpacing,
        routedPaths
      );
    };
    const siblingFrameMemberRoute = routeSiblingFrameMemberConnection(
      edge,
      sourceRect,
      targetRect,
      source,
      target,
      startPort,
      endPort,
      routingEdges,
      ports,
      nodes,
      routingObstacles,
      routedPaths
    );
    let points =
      source === target
        ? selfLoop(sourceRect, gridSpacing, selfLoopSide(source, data.edges, nodes))
        : (externalCycleRoutes.get(edge.id) ??
          nestedEntryRoutes.get(edge.id)?.points ??
          workflowRoutes.get(edge.id)?.points ??
          shortcutRoutes.get(edge.id) ??
          routeDiamondCircleBundle(
            sourceRect,
            targetRect,
            startPort,
            diamondCircleBundle,
            routingObstacles
          ) ??
          siblingFrameMemberRoute?.points ??
          routeLayeredDirectedWorkflowEdge(
            edge,
            sourceRect,
            targetRect,
            startPort,
            endPort,
            routingEdges,
            nodes,
            routingObstacles
          ) ??
          routeMixedDiamondBundle(
            edge,
            sourceRect,
            targetRect,
            startPort,
            endPort,
            routingEdges,
            routingObstacles,
            routedPaths
          ) ??
          routeFrameRowBypass(
            edge,
            sourceRect,
            targetRect,
            nodes,
            data.direction,
            routingObstacles,
            routedPaths
          ) ??
          routeStraightGroupFrameConnection(sourceRect, targetRect, routingObstacles) ??
          routeAlignedSiblingGroupConnection(sourceRect, targetRect, routingObstacles) ??
          routeOrderedParallelEdgeBundle(
            edge,
            sourceRect,
            targetRect,
            routingEdges,
            routingObstacles
          ) ??
          routeStraightReciprocalOfLabeledEdge(
            edge,
            sourceRect,
            targetRect,
            routingEdges,
            routingObstacles,
            routedPaths
          ) ??
          routeSymmetricTerminalFrameFan(
            source,
            target,
            startPort,
            endPort,
            routingData,
            nodes,
            routingObstacles,
            routedPaths
          ) ??
          routeLabelledLowerRightFan(
            edge,
            sourceRect,
            targetRect,
            routingEdges,
            routingObstacles,
            routedPaths
          ) ??
          routeLongWorkflowBranch(
            edge,
            sourceRect,
            targetRect,
            startPort,
            endPort,
            routingEdges,
            routingObstacles,
            routedPaths
          ) ??
          routeWithLabelClearance(edge, sourceRect, targetRect, routingObstacles, routedPaths) ??
          routeSymmetricDiamondFan(
            source,
            target,
            startPort,
            endPort,
            symmetricDiamondFans.has(source.id),
            symmetricLateralDiamondFans.has(source.id),
            routingObstacles,
            routedPaths
          ) ??
          routeAvoidingEndpoints(
            startPort,
            edge.startSide ??
              sideAtPort(sourceRect, startPort, sideToward(source, target, 'start')),
            endPort,
            edge.endSide ?? sideAtPort(targetRect, endPort, sideToward(target, source, 'end')),
            sourceRect,
            targetRect,
            routingEdges.filter(
              (candidate) => candidate.start === target.id || candidate.end === target.id
            ).length,
            routingObstacles,
            gridSpacing,
            routedPaths
          ));
    points = separateSharedRouteLane(preserveDiamondPorts(points), routingObstacles, routedPaths);
    if (hasGroupEndpoint) {
      points = reserveEndpointApproachClearance(
        points,
        sourceRect,
        targetRect,
        routingObstacles,
        routedPaths
      );
    }
    const label = (edge.label ?? edge.text ?? '').trim();
    const dominantLabelPoint = label
      ? (nestedEntryRoutes.get(edge.id)?.labelPoint ??
        workflowRoutes.get(edge.id)?.labelPoint ??
        siblingFrameMemberRoute?.labelPoint ??
        pointAtDominantSegment(points))
      : undefined;
    const dimensions = label ? measuredLabelDimensions(edge, label) : undefined;
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
      // Reserved plans have already checked the measured caption against
      // nodes, titles, borders and other paths. Do not replace them using a
      // single-line text estimate that ignores renderer wrapping.
      !reserved(edge) &&
      (labelOverlapsRoutedPath(labelPoint, label, routedPaths) ||
        routingObstacles.some(
          (obstacle) =>
            obstacle.node.id !== undefined &&
            obstacle.node.isGroup !== true &&
            rectanglesOverlap(labelBounds(labelPoint, label), obstacle)
        ))
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
    const portSafePoints = source === target ? points : preserveDiamondPorts(points);
    if (portSafePoints !== points) {
      points = portSafePoints;
      labelPoint = label ? pointAtDominantSegment(points) : pointAtHalfLength(points);
    }
    // Routing uses conservative rectangular obstacles. Only after selecting
    // the lane, extend its terminal runs to the actual sloped node outlines.
    // Radial clipping would move the lane and introduce diagonal segments.
    if (points.length >= 2) {
      points = [...points];
      points[0] = projectToSlantedNodeOutline(source, points[0], points[1]);
      const last = points.length - 1;
      points[last] = projectToSlantedNodeOutline(target, points[last], points[last - 1]);
    }
    const output = outputEdges.get(edge.id)!;
    output.points = points;
    routedPaths.push(points);
    output.x = labelPoint.x;
    output.y = labelPoint.y;
    if (label) {
      labelObstacles.push(labelObstacle(labelPoint, label, edge));
    }
    // Rounded corners retain the exact obstacle-avoiding polyline while
    // matching ELK's polished edge treatment.
    output.curve = 'rounded';
    output.roundedCornerRadius = Math.min(16, gridSpacing / 8);
    output.hasIntersectionPoints = true;
  }
}

function isLayeredWorkflowEdge(edge: Edge): boolean {
  return edge.metadata?.stressAndGridLayered === true;
}

function routeDiamondCircleBundle(
  source: Rect,
  target: Rect,
  start: Point,
  bundle: ReturnType<typeof isolatedDiamondCircleBundle>,
  obstacles: Rect[]
): Point[] | undefined {
  if (!bundle || source.node !== bundle.diamond || target.node !== bundle.circle) {
    return undefined;
  }
  const circle = bundle.circle;
  const vertical = Math.abs(circle.y! - source.node.y!) > Math.abs(circle.x! - source.node.x!);
  const rx = circle.width! / 2;
  const ry = circle.height! / 2;
  const offset = vertical ? (start.x - circle.x!) / rx : (start.y - circle.y!) / ry;
  if (Math.abs(offset) >= 1) {
    return undefined;
  }
  const radius = Math.sqrt(1 - offset * offset);
  const end = vertical
    ? { x: start.x, y: circle.y! - Math.sign(circle.y! - source.node.y!) * ry * radius }
    : { x: circle.x! - Math.sign(circle.x! - source.node.x!) * rx * radius, y: start.y };
  const others = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return segmentClear(start, end, others) ? [start, end] : undefined;
}

function layeredRankSpan(edge: Edge): number {
  const span = edge.metadata?.stressAndGridRankSpan;
  return typeof span === 'number' ? span : 1;
}

/**
 * Layered DAG placement guarantees that every edge travels downward. Preserve
 * that invariant during routing: adjacent ranks use an ordered horizontal
 * channel, while a shortcut over one or more ranks uses an outside bypass.
 * Generic visibility routing is intentionally free to travel around either
 * endpoint; in a DAG that freedom can create a technically clear route which
 * loops below its target or crosses a sibling branch.
 */
function routeLayeredDirectedWorkflowEdge(
  edge: Edge,
  source: Rect,
  target: Rect,
  start: Point,
  end: Point,
  edges: Edge[],
  nodes: Map<string, Node>,
  obstacles: Rect[]
): Point[] | undefined {
  if (!isLayeredWorkflowEdge(edge) || source.bottom >= target.top - EPSILON) {
    return undefined;
  }
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  const convergence = routeLayeredConvergence(
    edge,
    source,
    target,
    start,
    end,
    edges,
    nodes,
    otherObstacles
  );
  if (convergence) {
    return convergence;
  }
  if (layeredRankSpan(edge) > 1) {
    const side = edge.metadata?.stressAndGridBypassSide === 'right' ? 'right' : 'left';
    const label = (edge.label ?? edge.text ?? '').trim();
    const dimensions = label ? labelDimensions(label) : { width: 0, height: 0 };
    const labelWidth = Math.max(edge.width ?? 0, dimensions.width);
    const clearance = Math.max(CLEARANCE, labelWidth / 2 + LABEL_CLEARANCE);
    const verticalBlockers = otherObstacles.filter(
      (obstacle) => obstacle.bottom > source.bottom && obstacle.top < target.top
    );
    // A long edge only has to leave its starting column for a box that
    // actually occupies that column.  Taking the outermost bound of every
    // intermediate rank turns a small local detour into a diagram-wide loop
    // around unrelated branches.
    const corridorBlockers = verticalBlockers.filter(
      (obstacle) => obstacle.left < start.x + EPSILON && obstacle.right > start.x - EPSILON
    );
    const blockerBoundary =
      side === 'left'
        ? Math.min(target.left, ...corridorBlockers.map((obstacle) => obstacle.left)) - clearance
        : Math.max(target.right, ...corridorBlockers.map((obstacle) => obstacle.right)) + clearance;
    // If the assigned outer port already lies beyond every intermediate box,
    // keep that x-coordinate as the bypass lane. This turns a long merge edge
    // into one vertical run plus its final approach instead of adding a purely
    // decorative excursion farther outside the diagram.
    const laneX =
      side === 'left'
        ? start.x <= blockerBoundary
          ? start.x
          : blockerBoundary
        : start.x >= blockerBoundary
          ? start.x
          : blockerBoundary;
    const targetApproachY = target.top - CLEARANCE;
    const points = simplify([
      start,
      { x: start.x, y: source.bottom + CLEARANCE },
      { x: laneX, y: source.bottom + CLEARANCE },
      { x: laneX, y: targetApproachY },
      { x: end.x, y: targetApproachY },
      end,
    ]);
    return routeSegmentsClear(points, otherObstacles) ? points : undefined;
  }

  const outgoing = edges.filter(
    (candidate) =>
      isLayeredWorkflowEdge(candidate) &&
      layeredRankSpan(candidate) === 1 &&
      candidate.start === edge.start
  );
  const incoming = edges.filter(
    (candidate) =>
      isLayeredWorkflowEdge(candidate) &&
      layeredRankSpan(candidate) === 1 &&
      candidate.end === edge.end
  );
  const usesOutgoingBundle = outgoing.length >= incoming.length;
  const bundle = (usesOutgoingBundle ? outgoing : incoming).sort((left, right) => {
    const leftOther = nodes.get(usesOutgoingBundle ? left.end! : left.start!)!;
    const rightOther = nodes.get(usesOutgoingBundle ? right.end! : right.start!)!;
    return leftOther.x! - rightOther.x! || left.id.localeCompare(right.id);
  });
  const index = Math.max(0, bundle.indexOf(edge));
  const bundleSources = bundle.map((candidate) => rectFor(nodes.get(candidate.start!)!)!);
  const bundleTargets = bundle.map((candidate) => rectFor(nodes.get(candidate.end!)!)!);
  const minimumLane = Math.max(...bundleSources.map((rect) => rect.bottom)) + CLEARANCE;
  const maximumLane = Math.min(...bundleTargets.map((rect) => rect.top)) - CLEARANCE;
  if (minimumLane > maximumLane + EPSILON) {
    return undefined;
  }
  const laneIndex = (() => {
    if (!usesOutgoingBundle) {
      return index;
    }
    // Each side of a downward fan needs the lane order facing its own
    // direction: left-going branches grow away from the left source port,
    // while right-going branches grow away from the right source port. A
    // single reversed order merely moves the self-crossing from one side of
    // the fan to the other.
    const leftBranches = bundle.filter(
      (candidate) => nodes.get(candidate.end!)!.x! < source.node.x! - EPSILON
    );
    const rightBranches = bundle.filter((candidate) => !leftBranches.includes(candidate));
    const branch =
      nodes.get(edge.end!)!.x! < source.node.x! - EPSILON ? leftBranches : rightBranches;
    const branchIndex = Math.max(0, branch.indexOf(edge));
    return branch === leftBranches ? branchIndex : branch.length - 1 - branchIndex;
  })();
  const laneCount = usesOutgoingBundle
    ? Math.max(
        bundle.filter((candidate) => nodes.get(candidate.end!)!.x! < source.node.x! - EPSILON)
          .length,
        bundle.filter((candidate) => nodes.get(candidate.end!)!.x! >= source.node.x! - EPSILON)
          .length
      )
    : bundle.length;
  let laneY =
    laneCount === 1
      ? (minimumLane + maximumLane) / 2
      : minimumLane + ((maximumLane - minimumLane) * laneIndex) / (laneCount - 1);
  const label = (edge.label ?? edge.text ?? '').trim();
  if (label) {
    const dimensions = labelDimensions(label);
    const labelHeight = Math.max(edge.height ?? 0, dimensions.height);
    const safeMinimum = source.bottom + labelHeight / 2 + LABEL_CLEARANCE;
    const safeMaximum = target.top - labelHeight / 2 - LABEL_CLEARANCE;
    if (safeMinimum > safeMaximum + EPSILON) {
      return undefined;
    }
    laneY = Math.max(safeMinimum, Math.min(safeMaximum, laneY));
  }
  const points = simplify([start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]);
  return routeSegmentsClear(points, otherObstacles) ? points : undefined;
}

/**
 * Coordinate every arrival at a layered merge, including rank-skipping edges.
 * Sources on opposite sides share a bend level; on the same side the farther
 * source turns later, after the nearer source has left its column. This keeps
 * symmetric fork/merge pairs symmetric and avoids crossings with long arrivals.
 * If an intermediate node blocks a source column, retain the bypass fallback.
 */
function routeLayeredConvergence(
  edge: Edge,
  source: Rect,
  target: Rect,
  start: Point,
  end: Point,
  edges: Edge[],
  nodes: Map<string, Node>,
  obstacles: Rect[]
): Point[] | undefined {
  const incoming = edges.filter(
    (candidate) => isLayeredWorkflowEdge(candidate) && candidate.end === edge.end
  );
  if (
    incoming.length < 2 ||
    edges.filter((candidate) => candidate.start === edge.start).length !== 1
  ) {
    return undefined;
  }
  const sources = incoming.map((candidate) => rectFor(nodes.get(candidate.start!)!)!);
  const minimumLane = Math.max(...sources.map((rect) => rect.bottom)) + CLEARANCE;
  const maximumLane = target.top - CLEARANCE;
  if (minimumLane > maximumLane + EPSILON) {
    return undefined;
  }
  const left = source.node.x! < target.node.x!;
  const side = incoming
    .filter((candidate) => {
      const sourceOnLeft = nodes.get(candidate.start!)!.x! < target.node.x!;
      return sourceOnLeft === left;
    })
    .sort(
      (a, b) =>
        Math.abs(nodes.get(a.start!)!.x! - target.node.x!) -
          Math.abs(nodes.get(b.start!)!.x! - target.node.x!) || a.id.localeCompare(b.id)
    );
  const index = side.indexOf(edge);
  const laneY =
    side.length === 1
      ? (minimumLane + maximumLane) / 2
      : minimumLane + ((maximumLane - minimumLane) * index) / (side.length - 1);
  const label = (edge.label ?? edge.text ?? '').trim();
  if (label) {
    const height = Math.max(edge.height ?? 0, labelDimensions(label).height);
    if (
      laneY < source.bottom + height / 2 + LABEL_CLEARANCE ||
      laneY > target.top - height / 2 - LABEL_CLEARANCE
    ) {
      return undefined;
    }
  }
  const points = simplify([start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]);
  return routeSegmentsClear(points, obstacles) ? points : undefined;
}

function routeSegmentsClear(points: Point[], obstacles: Rect[]): boolean {
  return points.slice(1).every((point, index) => segmentClear(points[index], point, obstacles));
}

/**
 * A group endpoint represents its frame, so it may use any clear point on the
 * facing frame side. Requiring that endpoint to use the frame centre is both
 * semantically unnecessary and visually harmful when a member row lies near
 * the centre. If the external leaf has deliberately been placed on a clear
 * row inside the frame's vertical span, connect it directly to that row.
 */
function routeStraightGroupFrameConnection(
  source: Rect,
  target: Rect,
  obstacles: Rect[]
): Point[] | undefined {
  const sourceIsGroup = source.node.isGroup === true;
  const targetIsGroup = target.node.isGroup === true;
  if (sourceIsGroup === targetIsGroup) {
    return undefined;
  }

  const frame = sourceIsGroup ? source : target;
  const leaf = sourceIsGroup ? target : source;
  const row = leaf.node.y!;
  if (row <= frame.top + EPSILON || row >= frame.bottom - EPSILON) {
    return undefined;
  }

  let framePoint: Point;
  let leafPoint: Point;
  if (leaf.right < frame.left - EPSILON) {
    framePoint = { x: frame.left, y: row };
    leafPoint = { x: leaf.right, y: row };
  } else if (leaf.left > frame.right + EPSILON) {
    framePoint = { x: frame.right, y: row };
    leafPoint = { x: leaf.left, y: row };
  } else {
    return undefined;
  }

  const points = sourceIsGroup ? [framePoint, leafPoint] : [leafPoint, framePoint];
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return segmentClear(points[0], points[1], otherObstacles) ? points : undefined;
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

/**
 * Sibling frames that are aligned within the grid tolerance should connect
 * directly at their facing centre points. Generic Manhattan routing adds two
 * clearance stubs for their sub-pixel centre difference, creating a visibly
 * sharp dogleg in an otherwise empty inter-frame gap.
 */
function routeAlignedSiblingGroupConnection(
  source: Rect,
  target: Rect,
  obstacles: Rect[]
): Point[] | undefined {
  if (
    !source.node.isGroup ||
    !target.node.isGroup ||
    source.node.parentId !== target.node.parentId
  ) {
    return undefined;
  }
  const vertical = Math.abs(source.node.x! - target.node.x!) <= AXIS_ALIGNMENT_TOLERANCE;
  const topAligned = Math.abs(source.top - target.top) <= EPSILON;
  const horizontal =
    Math.abs(source.node.y! - target.node.y!) <= AXIS_ALIGNMENT_TOLERANCE || topAligned;
  if (vertical === horizontal) {
    return undefined;
  }
  const sourceBeforeTarget = vertical
    ? source.node.y! < target.node.y!
    : source.node.x! < target.node.x!;
  const sharedCoordinate = vertical
    ? (source.node.x! + target.node.x!) / 2
    : topAligned
      ? (Math.max(source.top, target.top) + Math.min(source.bottom, target.bottom)) / 2
      : (source.node.y! + target.node.y!) / 2;
  const points = vertical
    ? [
        { x: sharedCoordinate, y: sourceBeforeTarget ? source.bottom : source.top },
        { x: sharedCoordinate, y: sourceBeforeTarget ? target.top : target.bottom },
      ]
    : [
        { x: sourceBeforeTarget ? source.right : source.left, y: sharedCoordinate },
        { x: sourceBeforeTarget ? target.left : target.right, y: sharedCoordinate },
      ];
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return segmentClear(points[0], points[1], otherObstacles) ? points : undefined;
}

/**
 * A frame connection that skips another frame belongs outside the row. Use
 * the upper lane for forward links and the lower lane for feedback, so the
 * two directions do not compete for the same corridor and cross each other.
 */
function routeFrameRowBypass(
  edge: Edge,
  source: Rect,
  target: Rect,
  nodes: Map<string, Node>,
  direction: LayoutData['direction'],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  if ((!source.node.isGroup && !target.node.isGroup) || edge.startSide || edge.endSide) {
    return undefined;
  }
  const frameFor = (node: Node) => {
    const frame = node.isGroup ? node : nodes.get(node.parentId ?? '');
    return frame?.isGroup && !frame.parentId ? rectFor(frame) : undefined;
  };
  const sourceFrame = frameFor(source.node);
  const targetFrame = frameFor(target.node);
  if (
    !sourceFrame ||
    !targetFrame ||
    sourceFrame.node === targetFrame.node ||
    Math.abs(sourceFrame.top - targetFrame.top) > EPSILON
  ) {
    return undefined;
  }
  const sign = Math.sign(targetFrame.node.x! - sourceFrame.node.x!);
  const left = Math.min(sourceFrame.node.x!, targetFrame.node.x!);
  const right = Math.max(sourceFrame.node.x!, targetFrame.node.x!);
  const between = [...nodes.values()].filter(
    (node) =>
      node.isGroup &&
      !node.parentId &&
      node.x! > left &&
      node.x! < right &&
      Math.abs(node.y! - node.height! / 2 - sourceFrame.top) <= EPSILON
  );
  if (between.length === 0) {
    return undefined;
  }
  const forward = sign === (direction === 'RL' ? -1 : 1);
  const row = [sourceFrame, targetFrame, ...between.map((node) => rectFor(node)!)];
  const lane = forward
    ? Math.min(...row.map((rect) => rect.top)) - CLEARANCE
    : Math.max(...row.map((rect) => rect.bottom)) + CLEARANCE;
  const port = (rect: Rect, toward: number): Point => ({
    // Top ports sit beside the frame title; bottom ports need no title inset.
    x:
      forward && rect.node.isGroup
        ? rect.node.x! + toward * (rect.node.width! / 2 - CLEARANCE)
        : rect.node.x!,
    y: forward ? rect.top : rect.bottom,
  });
  const start = port(source, sign);
  const end = port(target, -sign);
  if (
    forward &&
    (
      [
        [source, start],
        [target, end],
      ] as const
    ).some(([rect, point]) => {
      return (
        rect.node.isGroup &&
        Math.abs(point.x - rect.node.x!) <
          (rect.node.labelBBox?.width ?? 0) / 2 + ROUTE_LANE_CLEARANCE
      );
    })
  ) {
    return undefined;
  }
  const points = [start, { x: start.x, y: lane }, { x: end.x, y: lane }, end];
  const otherObstacles = obstacles.filter(
    (rect) => rect.node !== source.node && rect.node !== target.node
  );
  return routeIsClear(points, otherObstacles, routedPaths) ? points : undefined;
}

/**
 * Entering a member of a neighbouring sibling frame must cross that frame's
 * border, rather than borrowing the row immediately outside it. The generic
 * visibility graph can otherwise travel beside the target frame until its
 * final turn, which becomes a border-hugging segment after the renderer has
 * accounted for the subgraph title. Use the open corridor between the frames,
 * then enter the target member from its facing side on the member's own row.
 */
function routeSiblingFrameMemberConnection(
  edge: Edge,
  source: Rect,
  target: Rect,
  sourceNode: Node,
  targetNode: Node,
  start: Point,
  end: Point,
  edges: Edge[],
  ports: Map<string, Point>,
  nodes: Map<string, Node>,
  obstacles: Rect[],
  routedPaths: Point[][]
): { points: Point[]; labelPoint?: Point } | undefined {
  const sourceFrame = sourceNode.parentId ? nodes.get(sourceNode.parentId) : undefined;
  const targetFrame = targetNode.parentId ? nodes.get(targetNode.parentId) : undefined;
  if (
    !sourceFrame?.isGroup ||
    !targetFrame?.isGroup ||
    sourceFrame === targetFrame ||
    sourceFrame.parentId !== targetFrame.parentId
  ) {
    return undefined;
  }

  const sourceOnLeft = sourceFrame.x! < targetFrame.x!;
  const startSide = sideAtPort(source, start, sideToward(sourceNode, targetNode, 'start'));
  const endSide = sideAtPort(target, end, sideToward(targetNode, sourceNode, 'end'));
  const parallel = edges
    .filter((candidate) => candidate.start === edge.start && candidate.end === edge.end)
    .sort((a, b) => a.id.localeCompare(b.id));
  const firstLane = sourceFrame.y! + sourceFrame.height! / 2 + CLEARANCE;
  const lastLane = targetFrame.y! - targetFrame.height! / 2 - CLEARANCE;
  if (
    sourceFrame.parentId &&
    parallel.length > 1 &&
    parallel.every(
      (candidate) =>
        !(candidate.label ?? candidate.text ?? '').trim() &&
        !candidate.startSide &&
        !candidate.endSide &&
        (candidate.minlen ?? 1) <= 1
    ) &&
    // A sloped diamond port has no single bounding-box side. Follow the
    // bridge's intended approach rather than its nearest rectangular side.
    (isDiamondNode(sourceNode) ? sideToward(sourceNode, targetNode, 'start') : startSide) ===
      'bottom' &&
    (isDiamondNode(targetNode) ? sideToward(targetNode, sourceNode, 'end') : endSide) === 'top' &&
    lastLane - firstLane >= (parallel.length - 1) * ROUTE_LANE_CLEARANCE
  ) {
    // Nested bridge separation has reserved this band. Use ordered parallel
    // lanes rather than leaving and then re-entering the source frame to
    // avoid the earlier edge. Keep the globally allocated diamond ports.
    // Order physical ports, not IDs: opposite diamond slopes distribute their
    // ports in opposite directions. Both ends must have the same x ordering.
    const ordered = [...parallel].sort(
      (a, b) => ports.get(`${a.id}:start`)!.x - ports.get(`${b.id}:start`)!.x
    );
    if (
      ordered.some(
        (candidate, index) =>
          index > 0 &&
          ports.get(`${candidate.id}:end`)!.x <
            ports.get(`${ordered[index - 1].id}:end`)!.x - EPSILON
      )
    ) {
      return undefined;
    }
    const portIndex = ordered.indexOf(edge);
    // Rightward runs need the rightmost port to turn first; leftward runs
    // need the leftmost port first. This keeps every terminal approach clear.
    const laneIndex = end.x > start.x ? parallel.length - 1 - portIndex : portIndex;
    const laneY = firstLane + ((lastLane - firstLane) * laneIndex) / (parallel.length - 1);
    const points = simplify([start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end]);
    const otherObstacles = obstacles.filter(
      (obstacle) => obstacle.node !== sourceNode && obstacle.node !== targetNode
    );
    if (
      routeAvoidsEndpointBoxes(points, source, target) &&
      routeIsClear(points, otherObstacles, routedPaths)
    ) {
      return { points };
    }
  }
  if (
    (sourceOnLeft && (startSide !== 'right' || endSide !== 'left')) ||
    (!sourceOnLeft && (startSide !== 'left' || endSide !== 'right'))
  ) {
    return undefined;
  }

  const sourceBorder = sourceOnLeft
    ? sourceFrame.x! + sourceFrame.width! / 2
    : sourceFrame.x! - sourceFrame.width! / 2;
  const targetBorder = sourceOnLeft
    ? targetFrame.x! - targetFrame.width! / 2
    : targetFrame.x! + targetFrame.width! / 2;
  const escapeX = sourceBorder + (sourceOnLeft ? CLEARANCE : -CLEARANCE);
  const corridorEnd = targetBorder + (sourceOnLeft ? -CLEARANCE : CLEARANCE);
  const label = (edge.label ?? edge.text ?? '').trim();
  const { width: labelWidth } = labelDimensions(label);
  if (label && Math.abs(corridorEnd - escapeX) < labelWidth) {
    return undefined;
  }

  const points = simplify([start, { x: escapeX, y: start.y }, { x: escapeX, y: end.y }, end]);
  if (!routeIsClear(points, obstacles, routedPaths)) {
    return undefined;
  }
  return {
    points,
    labelPoint: label ? { x: (escapeX + corridorEnd) / 2, y: end.y } : undefined,
  };
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

/**
 * Keep the last parallel routing band far enough from a leaf endpoint. Group
 * exits sometimes use a compact specialized route whose final approach is a
 * few pixels shorter than the generic port stub. Moving both ends of the
 * adjacent band preserves every right angle while retaining the assigned
 * endpoint port.
 */
function reserveEndpointApproachClearance(
  points: Point[],
  source: Rect,
  target: Rect,
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] {
  if (points.length < 4) {
    return points;
  }
  const end = points.at(-1)!;
  const beforeEnd = points.at(-2)!;
  const approachHorizontal = Math.abs(end.y - beforeEnd.y) <= EPSILON;
  const approachLength = approachHorizontal
    ? Math.abs(end.x - beforeEnd.x)
    : Math.abs(end.y - beforeEnd.y);
  if (approachLength >= CLEARANCE - EPSILON) {
    return points;
  }

  const offset = CLEARANCE - approachLength;
  const direction = approachHorizontal
    ? Math.sign(beforeEnd.x - end.x) || (end.x <= target.left ? -1 : 1)
    : Math.sign(beforeEnd.y - end.y) || (end.y <= target.top ? -1 : 1);
  const candidate = points.map((point) => ({ ...point }));
  for (const index of [candidate.length - 3, candidate.length - 2]) {
    if (approachHorizontal) {
      candidate[index].x += direction * offset;
    } else {
      candidate[index].y += direction * offset;
    }
  }
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  return routeIsClear(candidate, otherObstacles, routedPaths) ? simplify(candidate) : points;
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
    isDiamondNode(source.node) ||
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

function labelObstacle(point: Point, label: string, edge: Edge): Rect {
  const { width, height } = measuredLabelDimensions(edge, label);
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

function measuredLabelDimensions(edge: Edge, label: string): { width: number; height: number } {
  return captionDimensions(label, edge, 'renderer');
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

/**
 * Equal facing borders and centred terminal children admit reflected routes.
 * Use one shared bend row/column instead of letting the visibility grid choose
 * a different equally short lane for each side of a rectangular framed fork.
 * Retain allocated ports and reject the lane if foreign content obstructs it.
 */
function routeSymmetricTerminalFrameFan(
  source: Node,
  target: Node,
  start: Point,
  end: Point,
  data: LayoutData,
  nodes: Map<string, Node>,
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  if (!source.parentId || !['rect', 'squareRect'].includes(source.shape ?? '')) {
    return undefined;
  }
  const outgoing = data.edges.filter((candidate) => candidate.start === source.id);
  if (
    outgoing.length !== 2 ||
    outgoing.some(
      (candidate) =>
        candidate.startSide !== undefined ||
        candidate.endSide !== undefined ||
        (candidate.minlen ?? 1) > 1 ||
        candidate.isLayoutOnly === true
    )
  ) {
    return undefined;
  }
  const branches = outgoing.map((candidate) => nodes.get(candidate.end ?? ''));
  if (
    branches.some(
      (node) =>
        !node ||
        node.isGroup ||
        node.parentId !== source.parentId ||
        !['rect', 'squareRect'].includes(node.shape ?? '') ||
        data.edges.filter((candidate) => candidate.start === node.id || candidate.end === node.id)
          .length !== 1
    )
  ) {
    return undefined;
  }
  const [first, second] = branches as Node[];
  if (first === second) {
    return undefined;
  }
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  const along = horizontal ? 'x' : 'y';
  const across = horizontal ? 'y' : 'x';
  const size = horizontal ? 'width' : 'height';
  const sign = data.direction === 'BT' || data.direction === 'RL' ? -1 : 1;
  const facing = target[along]! - (sign * target[size]!) / 2;
  if (
    Math.abs((first[across]! + second[across]!) / 2 - source[across]!) > EPSILON ||
    Math.abs(
      first[along]! - (sign * first[size]!) / 2 - second[along]! + (sign * second[size]!) / 2
    ) > EPSILON ||
    Math.abs(start[along] - source[along]! - (sign * source[size]!) / 2) > EPSILON ||
    Math.abs(end[along] - facing) > EPSILON ||
    Math.abs(end[across] - target[across]!) > EPSILON
  ) {
    return undefined;
  }
  const bend = facing - sign * CLEARANCE;
  if (sign * (bend - start[along]) < CLEARANCE) {
    return undefined;
  }
  const points = [start, { ...start, [along]: bend }, { ...end, [along]: bend }, end];
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source && obstacle.node !== target
  );
  return routeIsClear(points, otherObstacles, routedPaths) ? points : undefined;
}

function routeSymmetricDiamondFan(
  source: Node,
  target: Node,
  start: Point,
  end: Point,
  isSymmetricFan: boolean,
  isLateralFan: boolean,
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  if (!isSymmetricFan && !isLateralFan) {
    return undefined;
  }
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source && obstacle.node !== target
  );
  if (isLateralFan) {
    const direction = Math.sign(target.x! - source.x!);
    const targetRect = rectFor(target)!;
    const targetPort = {
      x: direction > 0 ? targetRect.left : targetRect.right,
      y: target.y!,
    };
    // Equal facing borders give both branches the same bend column and a
    // full arrowhead approach. Do not let visibility-grid tie-breaking pick
    // different, equally short corridors for the two reflected routes.
    const bendX = targetPort.x - direction * CLEARANCE;
    if (direction * (bendX - source.x!) <= source.width! / 2) {
      return undefined;
    }
    const points = [start, { x: bendX, y: start.y }, { x: bendX, y: targetPort.y }, targetPort];
    return routeIsClear(points, otherObstacles, routedPaths) ? points : undefined;
  }
  // Leave a sloped diamond face horizontally, then run vertically into the
  // facing side of each target. The two mirrored branches therefore need one
  // turn each, rather than a short stub followed by two visual kinks or a
  // vertical approach that accidentally enters a side port.
  const direction = Math.sign(target.x! - source.x!);
  if (direction === 0) {
    return undefined;
  }
  const targetRect = rectFor(target)!;
  const targetPort = {
    x: target.x! - direction * (PORT_SPACING / 2),
    y: target.y! > source.y! ? targetRect.top : targetRect.bottom,
  };
  const bend = { x: targetPort.x, y: start.y };
  if (
    !segmentClear(start, bend, otherObstacles) ||
    !segmentClear(bend, targetPort, otherObstacles) ||
    routeInteractionPenalty(start, bend, routedPaths) > 0 ||
    routeInteractionPenalty(bend, targetPort, routedPaths) > 0
  ) {
    return undefined;
  }
  return [start, bend, targetPort];
}

/**
 * A broad workflow fan may skip several rows before reaching its fallback
 * target, while a labelled decision branch can enter a downstream column from
 * the side.  The generic visibility graph sees both as ordinary diagonal
 * edges and is prone to reuse the column already occupied by a nearer path.
 * Keep those two cases in their own corridors: the fallback uses an outside
 * lane and the labelled branch clears the source before entering the target's
 * side port.  This is topology-based, so it also applies to similarly shaped
 * edit/build pipelines without depending on node names.
 */
function routeLongWorkflowBranch(
  edge: Edge,
  source: Rect,
  target: Rect,
  start: Point,
  end: Point,
  edges: Edge[],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  const label = (edge.label ?? edge.text ?? '').trim();
  const outgoing = edges.filter((candidate) => candidate.start === source.node.id && candidate.end);
  const incoming = edges.filter((candidate) => candidate.end === target.node.id && candidate.start);
  const outgoingTargetIds = new Set(outgoing.map((candidate) => candidate.end!));
  const deepestTargetY = Math.max(
    ...obstacles
      .filter((obstacle) => outgoingTargetIds.has(obstacle.node.id))
      .map((obstacle) => obstacle.node.y!)
  );
  const sourceIsDiamond = isDiamondNode(source.node);
  const targetIsBelow = target.node.y! > source.node.y! + EPSILON;
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );

  // The deepest unlabelled target of a broad fan is a fallback, not an
  // invitation to run through every intermediate branch. It usually has a
  // clear, one-turn path from the source's right side; use an outside lane
  // only when that short route is genuinely blocked.
  if (
    !label &&
    outgoing.length >= 4 &&
    targetIsBelow &&
    target.node.x! > source.node.x! + EPSILON &&
    target.node.y! >= deepestTargetY - EPSILON
  ) {
    // Keep the outer fallback above nearer right-hand branches. They can
    // then descend from a neighbouring lower port without crossing this
    // horizontal run.
    const fallbackStart = { x: source.right, y: source.node.y! - PORT_SPACING / 2 };
    const targetPort = { x: target.node.x!, y: target.top };
    const directPoints = [fallbackStart, { x: targetPort.x, y: fallbackStart.y }, targetPort];
    if (routeIsClear(directPoints, otherObstacles, routedPaths)) {
      return directPoints;
    }
    const laneX =
      Math.max(target.right, ...otherObstacles.map((obstacle) => obstacle.right)) + CLEARANCE;
    const laneY = targetPort.y - CLEARANCE;
    const points = simplify([
      fallbackStart,
      { x: laneX, y: fallbackStart.y },
      { x: laneX, y: laneY },
      { x: targetPort.x, y: laneY },
      targetPort,
    ]);
    return routeIsClear(points, otherObstacles, routedPaths) ? points : undefined;
  }

  // The intermediate right-hand branch of a broad classifier should visibly
  // depart from the right side alongside its deeper fallback. Keeping that
  // departure on the bottom edge makes an otherwise clear column look like a
  // detour through the classifier.
  if (
    !label &&
    outgoing.length >= 4 &&
    targetIsBelow &&
    target.node.x! > source.node.x! + EPSILON &&
    target.node.y! < deepestTargetY - EPSILON
  ) {
    const start = { x: source.right, y: source.node.y! + PORT_SPACING / 2 };
    const targetPort = { x: target.node.x!, y: target.top };
    const points = [start, { x: targetPort.x, y: start.y }, targetPort];
    if (routeIsClear(points, otherObstacles, routedPaths)) {
      return points;
    }
  }

  // When a labelled decision branch rejoins a task directly below its
  // diamond, it is an ordinary vertical flow.  Do not send it through a
  // side port just to distinguish it from the other exit: that creates two
  // pointless sharp bends immediately before the target.
  if (
    label &&
    sourceIsDiamond &&
    outgoing.length === 2 &&
    incoming.length >= 2 &&
    targetIsBelow &&
    Math.abs(target.node.x! - source.node.x!) <= AXIS_ALIGNMENT_TOLERANCE
  ) {
    const directPoints = simplify([
      start,
      { x: start.x, y: target.top - CLEARANCE },
      { x: target.node.x!, y: target.top - CLEARANCE },
      { x: target.node.x!, y: target.top },
    ]);
    if (routeIsClear(directPoints, otherObstacles, routedPaths)) {
      return directPoints;
    }
  }

  // A second decision can join that same task from the right. Give it the
  // adjacent top port, rather than crowding the centred vertical arrival.
  // The two incoming arrows remain visually related but no longer touch.
  if (
    label &&
    sourceIsDiamond &&
    outgoing.length === 2 &&
    incoming.length >= 2 &&
    targetIsBelow &&
    target.node.x! < source.node.x! - EPSILON
  ) {
    const targetPort = { x: target.node.x! + PORT_SPACING, y: target.top };
    const points = simplify([start, { x: targetPort.x, y: start.y }, targetPort]);
    if (routeIsClear(points, otherObstacles, routedPaths)) {
      return points;
    }
  }

  // A lower-right labelled decision branch follows its allocated exit and
  // enters the downstream task through its existing left port. The escape
  // lane stays outside the diamond for both sloped and vertex departures.
  if (
    label &&
    sourceIsDiamond &&
    outgoing.length === 2 &&
    incoming.length >= 2 &&
    targetIsBelow &&
    target.node.x! > source.node.x! + EPSILON &&
    sideAtPort(target, end, sideToward(target.node, source.node, 'end')) === 'left'
  ) {
    const escapeX = source.right + CLEARANCE;
    const points = simplify([start, { x: escapeX, y: start.y }, { x: escapeX, y: end.y }, end]);
    return routeIsClear(points, otherObstacles, routedPaths) ? points : undefined;
  }

  return undefined;
}

/** Identifies a uniform, axis-aligned endpoint pair with parallel edges. */
function isParallelBundleMember(edge: Edge, edges: Edge[], nodes: Map<string, Node>): boolean {
  const source = edge.start ? nodes.get(edge.start) : undefined;
  const target = edge.end ? nodes.get(edge.end) : undefined;
  if (!source || !target) {
    return false;
  }
  const axisAligned =
    Math.abs(source.x! - target.x!) <= AXIS_ALIGNMENT_TOLERANCE ||
    Math.abs(source.y! - target.y!) <= AXIS_ALIGNMENT_TOLERANCE;
  if (!axisAligned) {
    return false;
  }
  const forward = edges.filter(
    (candidate) => candidate.start === source.id && candidate.end === target.id
  );
  const reverse = edges.filter(
    (candidate) => candidate.start === target.id && candidate.end === source.id
  );
  const labelled = Boolean((edge.label ?? edge.text ?? '').trim());
  return (
    forward.length + reverse.length >= 2 &&
    (forward.length >= 2 || reverse.length >= 2) &&
    [...forward, ...reverse].every(
      (candidate) => Boolean((candidate.label ?? candidate.text ?? '').trim()) === labelled
    )
  );
}

/**
 * Parallel edges are a bundle, not independent paths. Assign a stable lane
 * to every uniformly labelled or unlabelled member of an axis-aligned
 * endpoint pair and use that same coordinate on both endpoints. This also
 * works when one direction has more copies than the other, or either endpoint
 * has unrelated edges.
 */
function routeOrderedParallelEdgeBundle(
  edge: Edge,
  source: Rect,
  target: Rect,
  edges: Edge[],
  obstacles: Rect[]
): Point[] | undefined {
  const vertical = Math.abs(source.node.x! - target.node.x!) <= AXIS_ALIGNMENT_TOLERANCE;
  const horizontal = Math.abs(source.node.y! - target.node.y!) <= AXIS_ALIGNMENT_TOLERANCE;
  if (!vertical && !horizontal) {
    return undefined;
  }

  const [first, second] = vertical
    ? [source, target].sort((left, right) => left.node.y! - right.node.y!)
    : [source, target].sort((left, right) => left.node.x! - right.node.x!);
  const forward = edges
    .filter((candidate) => candidate.start === first.node.id && candidate.end === second.node.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const reverse = edges
    .filter((candidate) => candidate.start === second.node.id && candidate.end === first.node.id)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ordered = [...forward, ...reverse];
  if (ordered.length < 2 || (forward.length < 2 && reverse.length < 2)) {
    return undefined;
  }

  const labelled = Boolean((edge.label ?? edge.text ?? '').trim());
  if (
    ordered.some(
      (candidate) => Boolean((candidate.label ?? candidate.text ?? '').trim()) !== labelled
    )
  ) {
    return undefined;
  }

  const laneIndex = ordered.indexOf(edge);
  const laneCount = ordered.length;
  if (laneIndex < 0) {
    return undefined;
  }
  const laneSize = vertical
    ? Math.min(first.node.width!, second.node.width!)
    : Math.min(first.node.height!, second.node.height!);
  const cornerClearance = labelled
    ? LABELLED_PARALLEL_BUNDLE_CORNER_CLEARANCE
    : PARALLEL_BUNDLE_CORNER_CLEARANCE;
  const usableSpan = laneSize - cornerClearance * 2;
  if (usableSpan < (laneCount - 1) * PARALLEL_BUNDLE_LANE_GAP) {
    return undefined;
  }
  if (labelled) {
    const gap = vertical
      ? Math.abs(source.node.y! - target.node.y!) - (source.node.height! + target.node.height!) / 2
      : Math.abs(source.node.x! - target.node.x!) - (source.node.width! + target.node.width!) / 2;
    const labelSpan = Math.max(
      ...ordered.map((candidate) => {
        const dimensions = labelDimensions((candidate.label ?? candidate.text ?? '').trim());
        return vertical ? dimensions.height : dimensions.width;
      })
    );
    if (gap < labelSpan + LABEL_CLEARANCE * 2) {
      return undefined;
    }
  }
  const center = vertical
    ? (first.node.x! + second.node.x!) / 2
    : (first.node.y! + second.node.y!) / 2;
  const lane = center - usableSpan / 2 + (usableSpan * laneIndex) / Math.max(1, laneCount - 1);
  const points = vertical
    ? source.node === first.node
      ? [
          { x: lane, y: first.bottom },
          { x: lane, y: second.top },
        ]
      : [
          { x: lane, y: second.top },
          { x: lane, y: first.bottom },
        ]
    : source.node === first.node
      ? [
          { x: first.right, y: lane },
          { x: second.left, y: lane },
        ]
      : [
          { x: second.left, y: lane },
          { x: first.right, y: lane },
        ];
  const otherObstacles = obstacles.filter(
    (obstacle) => obstacle.node !== source.node && obstacle.node !== target.node
  );
  // The bundle's lanes can be closer than ordinary independent routes on a
  // narrow node, but they are distinct, parallel, and their order is fixed at
  // both ends. Ordinary route-interaction scoring would reject that harmless
  // close spacing as though it were an accidental shared lane.
  return segmentClear(points[0], points[1], otherObstacles) ? points : undefined;
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
    sourceRect,
    targetRect,
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
    sourceRect,
    targetRect,
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
    // Sloped diamond ports sit inside the bounding rectangle. Their outward
    // terminal segment is legitimate; only subsequent re-entry is forbidden.
    if (isDiamondNode(obstacle.node)) {
      const onBoundary = (point: Point) =>
        Math.abs(
          Math.abs((point.x - obstacle.node.x!) / (obstacle.node.width! / 2)) +
            Math.abs((point.y - obstacle.node.y!) / (obstacle.node.height! / 2)) -
            1
        ) <= EPSILON;
      const outward = (port: Point, other: Point) =>
        (other.x - port.x) * (port.x - obstacle.node.x!) >= 0 &&
        (other.y - port.y) * (port.y - obstacle.node.y!) >= 0;
      if (
        (index === 1 && onBoundary(a) && outward(a, b)) ||
        (index === route.length - 1 && onBoundary(b) && outward(b, a))
      ) {
        continue;
      }
    }
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
  sourceRect: Rect,
  targetRect: Rect,
  obstacles: Rect[],
  gridSpacing: number,
  routedPaths: Point[][],
  forbidSharedLanes = false
): Point[] {
  // Stubs give the visibility-grid route room to turn away from its port.
  // This also keeps diamond-side attachments on the outside of the shape.
  const startStub = extendPort(start, startSide, sourceRect);
  const endStub = extendPort(end, endSide, targetRect);
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
  const diamondInputsBySide = new Map<string, { edge: Edge; node: Node; side: Side }[]>();
  const diamondOutputsBySide = new Map<string, { edge: Edge; node: Node; side: Side }[]>();
  const diamondAssignments = new Map<
    string,
    {
      edge: Edge;
      endpoint: 'start' | 'end';
      node: Node;
      xSign: number;
      ySign: number;
      other: Node;
    }[]
  >();
  const parallelBundleEdgeIds = new Set(
    edges.filter((edge) => isParallelBundleMember(edge, edges, nodes)).map((edge) => edge.id)
  );
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
  const alignedDiamondContinuations = new Set(
    [...nodes.values()]
      .filter((node) => hasAlignedDiamondContinuation(node, edges, nodes))
      .map((node) => node.id)
  );
  for (const edge of edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target || source === target) {
      continue;
    }
    const sourceSide =
      edge.startSide ??
      sideForCrowdedFan(
        source,
        target,
        'start',
        sideForParallelFrameFeedback(
          source,
          target,
          'start',
          sideToward(
            source,
            target,
            'start',
            diamondFanVertices.has(source.id),
            symmetricDiamondFans.has(source.id)
          ),
          edges,
          nodes
        ),
        edges,
        nodes
      );
    const targetSide =
      edge.endSide ??
      sideForCrowdedFan(target, source, 'end', sideToward(target, source, 'end'), edges, nodes);
    const allocatedSourceSide = edge.startSide
      ? sourceSide
      : sideEscapingParallelBundle(
          edge,
          source,
          target,
          'start',
          sourceSide,
          parallelBundleEdgeIds,
          edges,
          nodes
        );
    const allocatedTargetSide = edge.endSide
      ? targetSide
      : sideEscapingParallelBundle(
          edge,
          target,
          source,
          'end',
          targetSide,
          parallelBundleEdgeIds,
          edges,
          nodes
        );
    for (const [node, other, endpoint, side] of [
      [source, target, 'start', allocatedSourceSide],
      [target, source, 'end', allocatedTargetSide],
    ] as const) {
      if (isDiamondNode(node)) {
        if (endpoint === 'end') {
          add(diamondInputsBySide, `${node.id}:${side}`, { edge, node, side });
        } else {
          add(diamondOutputsBySide, `${node.id}:${side}`, { edge, node, side });
        }
        // Group by physical slope, including both inputs and outputs. An
        // aligned edge chooses the upper-left or lower-right midpoint with
        // a stable tie-break, while feedback follows its actual counterpart.
        const tie = endpoint === 'end' ? -1 : 1;
        const xSign =
          side === 'left' ? -1 : side === 'right' ? 1 : Math.sign(other.x! - node.x!) || tie;
        const ySign =
          side === 'top' ? -1 : side === 'bottom' ? 1 : Math.sign(other.y! - node.y!) || tie;
        add(diamondAssignments, `${node.id}:${xSign}:${ySign}`, {
          edge,
          endpoint,
          node,
          xSign,
          ySign,
          other,
        });
      } else {
        add(assignments, `${node.id}:${side}`, { edge, endpoint, side });
      }
    }
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
    // Direct parallel-bundle routes own their lanes and do not consume a
    // normal port slot. Otherwise an unrelated edge can be pushed to a node
    // corner solely by bundle members that never use their allocated ports.
    const allocatedValues = values.filter((value) => !parallelBundleEdgeIds.has(value.edge.id));
    const portValues = allocatedValues.length > 0 ? allocatedValues : values;
    const alignedCount = portValues.filter((value) =>
      isAxisAligned(node, value.edge, nodes)
    ).length;
    const centeredIndex = portValues.findIndex(
      (value) =>
        supportsCenteredPort(node) && alignedCount === 1 && isAxisAligned(node, value.edge, nodes)
    );
    values.forEach((value, index) => {
      const portIndex = portValues.indexOf(value);
      // Retain a valid fallback port for a bundled edge, even though the
      // normal straight-lane path bypasses it.
      const usesFallbackPort = portIndex < 0;
      const allocationIndex = usesFallbackPort ? index : portIndex;
      const allocationCount = usesFallbackPort ? values.length : portValues.length;
      const reservedCenter = !usesFallbackPort && allocationIndex === centeredIndex;
      const parallelCount = portValues.filter(
        (candidate) =>
          candidate.edge.start === value.edge.start && candidate.edge.end === value.edge.end
      ).length;
      const cornerInset =
        allocationCount > 1 &&
        (parallelCount > 1 ||
          (isLayeredWorkflowEdge(value.edge) && value.endpoint === 'end') ||
          (allocationCount === 3 &&
            centeredIndex >= 0 &&
            node.isGroup !== true &&
            ['rect', 'squareRect'].includes(node.shape ?? '')))
          ? Math.max(
              PORT_CORNER_CLEARANCE,
              (side === 'top' || side === 'bottom' ? node.width! : node.height!) *
                RECTANGULAR_PORT_CORNER_FRACTION
            )
          : PORT_CORNER_CLEARANCE;
      let port = portOnSide(
        node,
        side,
        allocationIndex,
        allocationCount,
        reservedCenter,
        cornerInset
      );
      // The regular distribution includes the middle coordinate for odd
      // counts. If an aligned edge reserves that coordinate, an adjacent
      // non-aligned edge can otherwise be given the identical port. Move only
      // the assignments that would cross that reserved slot, retaining their
      // order and leaving ordinary fans unchanged.
      if (!usesFallbackPort && centeredIndex >= 0 && !reservedCenter) {
        const coordinate = distributedPortCoordinateAvoidingCenter(
          side === 'top' || side === 'bottom' ? node.x! : node.y!,
          side === 'top' || side === 'bottom' ? node.width! : node.height!,
          allocationIndex,
          allocationCount,
          centeredIndex,
          cornerInset
        );
        port =
          side === 'top' || side === 'bottom'
            ? { ...port, x: coordinate }
            : { ...port, y: coordinate };
      }
      ports.set(
        `${value.edge.id}:${value.endpoint}`,
        offsetGroupPortTowardCounterpart(node, port, side, value.edge, value.endpoint, nodes)
      );
    });
  }
  const vertexTerminals = new Set<string>();
  for (const inputs of diamondInputsBySide.values()) {
    if (inputs.length === 1) {
      const { edge, node, side } = inputs[0];
      const key = `${edge.id}:end`;
      // A lone arrival uses the facing vertex. Multiple arrivals on that
      // cardinal side retain distinct sloped ports instead of sharing a tip.
      ports.set(key, portOnSide(node, side, 0, 1, true));
      vertexTerminals.add(key);
    }
  }
  for (const [sideKey, outputs] of diamondOutputsBySide) {
    if (
      outputs.length === 1 &&
      alignedDiamondContinuations.has(outputs[0].node.id) &&
      !diamondInputsBySide.has(sideKey)
    ) {
      const { edge, node, side } = outputs[0];
      const key = `${edge.id}:start`;
      // An aligned continuation into a merge needs no side-to-axis dogleg.
      // Its sibling may use another free vertex, but multiple exits on the
      // same cardinal side still retain distributed sloped ports.
      ports.set(key, portOnSide(node, side, 0, 1, true));
      vertexTerminals.add(key);
    }
  }
  for (const assignedValues of diamondAssignments.values()) {
    const values = assignedValues.filter(
      (value) => !vertexTerminals.has(`${value.edge.id}:${value.endpoint}`)
    );
    if (values.length === 0) {
      continue;
    }
    const { node, xSign, ySign } = values[0];
    // Sort along the slope from top to bottom, independent of input/output
    // role or edge insertion order. The midpoint remains the centre of a fan.
    values.sort(
      (a, b) =>
        a.other.y! - b.other.y! ||
        -xSign * (a.other.x! - b.other.x!) ||
        a.edge.id.localeCompare(b.edge.id)
    );
    const halfWidth = node.width! / 2;
    const halfHeight = node.height! / 2;
    const step = Math.min(
      PORT_SPACING / Math.max(halfWidth, halfHeight),
      0.6 / Math.max(1, values.length - 1)
    );
    for (const [index, value] of values.entries()) {
      const fraction = 0.5 + (index - (values.length - 1) / 2) * step;
      ports.set(`${value.edge.id}:${value.endpoint}`, {
        x: node.x! + xSign * halfWidth * (ySign < 0 ? fraction : 1 - fraction),
        y: node.y! + ySign * halfHeight * (ySign < 0 ? 1 - fraction : fraction),
      });
    }
  }
  const diamondCircle = isolatedDiamondCircleBundle({ nodes: [...nodes.values()], edges });
  if (diamondCircle) {
    const { diamond, circle } = diamondCircle;
    const xSign = Math.sign(circle.x! - diamond.x!) || 1;
    const ySign = Math.sign(circle.y! - diamond.y!) || 1;
    for (const [index, edge] of diamondCircle.edges.entries()) {
      const fraction =
        DIAMOND_CIRCLE_PORT_MARGIN +
        (DIAMOND_CIRCLE_PORT_SPAN * index) / (diamondCircle.edges.length - 1);
      ports.set(`${edge.id}:start`, {
        x: diamond.x! + ((xSign * diamond.width!) / 2) * (ySign < 0 ? fraction : 1 - fraction),
        y: diamond.y! + ((ySign * diamond.height!) / 2) * (ySign < 0 ? 1 - fraction : fraction),
      });
    }
  }
  // Mixed styled parallel edges need coherent ports on both diamonds. Keep
  // the labelled lane above the plain lanes rather than fanning all starts
  // downwards and all arrivals upwards through the same narrow corridor.
  for (const edge of edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target) {
      continue;
    }
    const bundle = mixedDiamondBundle(edge, source, target, edges);
    if (!bundle) {
      continue;
    }
    ports.set(`${edge.id}:start`, bundle.start);
    ports.set(`${edge.id}:end`, bundle.end);
  }
  return ports;
}

function mixedDiamondBundle(
  edge: Edge,
  source: Node,
  target: Node,
  edges: Edge[]
): { start: Point; end: Point; fraction: number; vertical: boolean } | undefined {
  if (!isDiamondNode(source) || !isDiamondNode(target)) {
    return undefined;
  }
  const vertical = Math.abs(source.x! - target.x!) <= AXIS_ALIGNMENT_TOLERANCE;
  if (!vertical && Math.abs(source.y! - target.y!) > AXIS_ALIGNMENT_TOLERANCE) {
    return undefined;
  }
  const labelled = (candidate: Edge) => Boolean((candidate.label ?? candidate.text ?? '').trim());
  const parallel = edges
    .filter(
      (candidate) =>
        (candidate.start === edge.start && candidate.end === edge.end) ||
        (candidate.start === edge.end && candidate.end === edge.start)
    )
    .sort((a, b) => Number(labelled(b)) - Number(labelled(a)) || a.id.localeCompare(b.id));
  if (!parallel.some(labelled) || parallel.every(labelled)) {
    return undefined;
  }
  const index = parallel.indexOf(edge);
  const fraction = index / (parallel.length - 1) - 0.5;
  const direction = Math.sign(vertical ? target.y! - source.y! : target.x! - source.x!);
  const port = (node: Node, facing: number): Point =>
    vertical
      ? {
          x: node.x! + (node.width! / 2) * fraction,
          y: node.y! + ((facing * node.height!) / 2) * (1 - Math.abs(fraction)),
        }
      : {
          x: node.x! + ((facing * node.width!) / 2) * (1 - Math.abs(fraction)),
          y: node.y! + (node.height! / 2) * fraction,
        };
  return { start: port(source, direction), end: port(target, -direction), fraction, vertical };
}

function routeMixedDiamondBundle(
  edge: Edge,
  source: Rect,
  target: Rect,
  start: Point,
  end: Point,
  edges: Edge[],
  obstacles: Rect[],
  routedPaths: Point[][]
): Point[] | undefined {
  const bundle = mixedDiamondBundle(edge, source.node, target.node, edges);
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!bundle || !label || Math.abs(bundle.fraction) <= EPSILON) {
    return undefined;
  }
  const dimensions = labelDimensions(label);
  const points = bundle.vertical
    ? (() => {
        const laneX =
          bundle.fraction < 0
            ? Math.min(source.left, target.left) - dimensions.width / 2 - LABEL_CLEARANCE
            : Math.max(source.right, target.right) + dimensions.width / 2 + LABEL_CLEARANCE;
        return [start, { x: laneX, y: start.y }, { x: laneX, y: end.y }, end];
      })()
    : (() => {
        const laneY =
          bundle.fraction < 0
            ? Math.min(source.top, target.top) - dimensions.height / 2 - LABEL_CLEARANCE
            : Math.max(source.bottom, target.bottom) + dimensions.height / 2 + LABEL_CLEARANCE;
        return [start, { x: start.x, y: laneY }, { x: end.x, y: laneY }, end];
      })();
  return routeIsClear(
    points,
    obstacles.filter((obstacle) => obstacle.node !== source.node && obstacle.node !== target.node),
    routedPaths
  )
    ? points
    : undefined;
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

function isDiamondNode(node: Node): boolean {
  return /^(diamond|rhombus|diam|question|decision)$/.test(String(node.shape));
}

function hasAlignedDiamondContinuation(
  node: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): boolean {
  if (!isDiamondNode(node) || node.isGroup === true) {
    return false;
  }
  const outgoing = edges.filter((edge) => edge.start === node.id);
  if (
    outgoing.length !== 2 ||
    new Set(outgoing.map((edge) => edge.end)).size !== 2 ||
    outgoing.some(
      (edge) =>
        !edge.end ||
        edge.end === node.id ||
        !nodes.has(edge.end) ||
        nodes.get(edge.end)!.isGroup === true ||
        edge.startSide !== undefined ||
        edge.endSide !== undefined
    )
  ) {
    return false;
  }
  return outgoing.some((edge) => {
    const target = nodes.get(edge.end!);
    if (
      !target ||
      target.isGroup === true ||
      new Set(
        edges
          .filter(
            (candidate) =>
              candidate.end === target.id && candidate.start && candidate.start !== target.id
          )
          .map((candidate) => candidate.start)
      ).size < 2
    ) {
      return false;
    }
    const dx = Math.abs(target.x! - node.x!);
    const dy = Math.abs(target.y! - node.y!);
    return (
      (dx <= EPSILON && dy > (node.height! + target.height!) / 2 + EPSILON) ||
      (dy <= EPSILON && dx > (node.width! + target.width!) / 2 + EPSILON)
    );
  });
}

function isSymmetricDiamondFan(
  node: Node,
  edges: Edge[],
  nodes: Map<string, Node>,
  axis: Axis = 'V'
): boolean {
  if (!isDiamondNode(node)) {
    return false;
  }
  const targets = edges
    .filter((edge) => edge.start === node.id && edge.end)
    .map((edge) => nodes.get(edge.end!))
    .filter((target): target is Node => target !== undefined)
    .sort((left, right) => left.x! - right.x!);
  if (axis === 'H') {
    if (
      targets.length !== 2 ||
      edges.some(
        (edge) =>
          edge.start === node.id &&
          (edge.startSide || edge.endSide || (edge.label ?? edge.text ?? '').trim())
      ) ||
      targets.some(
        (target) =>
          target.isGroup === true ||
          !/^(rect|squareRect)$/.test(String(target.shape)) ||
          edges.filter((edge) => edge.start === target.id || edge.end === target.id).length !== 1
      )
    ) {
      return false;
    }
    const direction = Math.sign(targets[0].x! - node.x!);
    return (
      direction !== 0 &&
      Math.sign(targets[1].x! - node.x!) === direction &&
      (targets[0].y! - node.y!) * (targets[1].y! - node.y!) < 0 &&
      Math.abs((targets[0].y! + targets[1].y!) / 2 - node.y!) <= EPSILON &&
      Math.abs(
        targets[0].x! -
          (direction * targets[0].width!) / 2 -
          (targets[1].x! - (direction * targets[1].width!) / 2)
      ) <= EPSILON
    );
  }
  return (
    targets.length === 2 &&
    Math.abs(targets[0].y! - targets[1].y!) <= EPSILON &&
    targets[0].x! < node.x! - EPSILON &&
    targets[1].x! > node.x! + EPSILON
  );
}

function supportsCenteredPort(node: Node): boolean {
  return !isDiamondNode(node) && !/circle|ellipse/.test(String(node.shape));
}

function needsDiamondFanVertices(node: Node, edges: Edge[], nodes: Map<string, Node>): boolean {
  if (!isDiamondNode(node)) {
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
    (Math.abs((node.x ?? 0) - (other.x ?? 0)) <= AXIS_ALIGNMENT_TOLERANCE ||
      Math.abs((node.y ?? 0) - (other.y ?? 0)) <= AXIS_ALIGNMENT_TOLERANCE)
  );
}

function portOrderCoordinate(node: Node, edge: Edge, side: Side, nodes: Map<string, Node>): number {
  if (
    (side === 'top' || side === 'bottom') &&
    isLayeredWorkflowEdge(edge) &&
    layeredRankSpan(edge) > 1 &&
    layeredColumnBlocked(edge, nodes)
  ) {
    return edge.metadata?.stressAndGridBypassSide === 'right'
      ? Number.POSITIVE_INFINITY
      : Number.NEGATIVE_INFINITY;
  }
  const otherId = edge.start === node.id ? edge.end : edge.start;
  const other = otherId ? nodes.get(otherId) : undefined;
  if (!other) {
    return 0;
  }
  return side === 'top' || side === 'bottom' ? (other.x ?? 0) : (other.y ?? 0);
}

function layeredColumnBlocked(edge: Edge, nodes: Map<string, Node>): boolean {
  const source = edge.start ? nodes.get(edge.start) : undefined;
  const target = edge.end ? nodes.get(edge.end) : undefined;
  const sourceRect = source && rectFor(source);
  const targetRect = target && rectFor(target);
  if (!source || !target || !sourceRect || !targetRect) {
    return true;
  }
  return [...nodes.values()].some((node) => {
    const rect = rectFor(node);
    return (
      node !== source &&
      node !== target &&
      rect !== undefined &&
      rect.bottom > sourceRect.bottom &&
      rect.top < targetRect.top &&
      rect.left < source.x! + EPSILON &&
      rect.right > source.x! - EPSILON
    );
  });
}

function add<T>(map: Map<string | number, T[]>, key: string | number, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

/**
 * In a two-frame parallel stage, both frames naturally enter the merge node
 * from the same side. If its feedback edge also points in that direction, all
 * three routes are forced onto a small node edge and the frame inputs land on
 * its corners. Send only that feedback exit below the stage, leaving the two
 * lateral ports evenly distributed for the parallel inputs.
 */
function sideForParallelFrameFeedback(
  node: Node,
  other: Node,
  endpoint: 'start' | 'end',
  preferredSide: Side,
  edges: Edge[],
  nodes: Map<string, Node>
): Side {
  if (endpoint !== 'start' || (preferredSide !== 'left' && preferredSide !== 'right')) {
    return preferredSide;
  }
  const parent = node.parentId ? nodes.get(node.parentId) : undefined;
  if (!parent?.isGroup || other.parentId) {
    return preferredSide;
  }
  const parallelFrameInputs = edges.filter((candidate) => {
    if (candidate.end !== node.id || !candidate.start) {
      return false;
    }
    const source = nodes.get(candidate.start);
    return source?.isGroup === true && source.parentId === parent.id;
  });
  const feedsBackIntoStage = edges.some((candidate) => {
    if (candidate.start !== other.id || !candidate.end) {
      return false;
    }
    const target = nodes.get(candidate.end);
    return target !== undefined && isAncestorOf(parent, target, nodes);
  });
  if (parallelFrameInputs.length !== 2 || !feedsBackIntoStage) {
    return preferredSide;
  }
  return 'bottom';
}

/**
 * A narrow node cannot host three distinct ports on the same side without
 * putting the outer two at its corners. When the destinations fan above,
 * alongside, and below it, use the natural top/right/bottom (or
 * top/left/bottom) exits instead. This preserves distinct ports and gives the
 * router a longer first segment for the diagonal branches.
 */
function sideForCrowdedFan(
  node: Node,
  other: Node,
  endpoint: 'start' | 'end',
  preferredSide: Side,
  edges: Edge[],
  nodes: Map<string, Node>
): Side {
  if (preferredSide !== 'left' && preferredSide !== 'right') {
    return preferredSide;
  }
  const dx = (other.x ?? 0) - (node.x ?? 0);
  const dy = (other.y ?? 0) - (node.y ?? 0);
  if (Math.abs(dx) <= EPSILON || Math.abs(dy) <= EPSILON) {
    return preferredSide;
  }
  const sameSide = edges.filter((candidate) => {
    const otherId = endpoint === 'start' ? candidate.end : candidate.start;
    const candidateOther = otherId ? nodes.get(otherId) : undefined;
    return (
      candidateOther !== undefined &&
      (endpoint === 'start' ? candidate.start : candidate.end) === node.id &&
      sideToward(node, candidateOther, endpoint) === preferredSide
    );
  });
  if (sameSide.length < 3 || node.height! >= (sameSide.length - 1) * PORT_SPACING + 4) {
    return preferredSide;
  }
  return dy < 0 ? 'top' : 'bottom';
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
    isDiamondNode(from) &&
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

/**
 * A direct parallel bundle reserves its own lanes rather than ordinary port
 * positions. A diagonal edge approaching the same side would otherwise be
 * assigned into the bundle's middle lane, so let it use the lateral or
 * vertical side that faces its counterpart instead.
 */
function sideEscapingParallelBundle(
  edge: Edge,
  node: Node,
  other: Node,
  endpoint: 'start' | 'end',
  preferredSide: Side,
  parallelBundleEdgeIds: Set<string>,
  edges: Edge[],
  nodes: Map<string, Node>
): Side {
  const dx = (other.x ?? 0) - (node.x ?? 0);
  const dy = (other.y ?? 0) - (node.y ?? 0);
  if (
    parallelBundleEdgeIds.has(edge.id) ||
    Math.abs(dx) <= EPSILON ||
    Math.abs(dy) <= EPSILON ||
    !edges.some((candidate) => {
      if (!parallelBundleEdgeIds.has(candidate.id)) {
        return false;
      }
      const candidateOtherId = endpoint === 'start' ? candidate.end : candidate.start;
      const candidateOther = candidateOtherId ? nodes.get(candidateOtherId) : undefined;
      return (
        candidateOther !== undefined &&
        (endpoint === 'start' ? candidate.start : candidate.end) === node.id &&
        sideToward(node, candidateOther, endpoint) === preferredSide
      );
    })
  ) {
    return preferredSide;
  }
  if (preferredSide === 'top' || preferredSide === 'bottom') {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function portOnSide(
  node: Node,
  side: Side,
  index: number,
  count: number,
  forceCenter = false,
  cornerInset = PORT_CORNER_CLEARANCE
): Point {
  const rect = rectFor(node)!;
  if (side === 'top' || side === 'bottom') {
    return {
      x: forceCenter
        ? node.x!
        : distributedPortCoordinate(node.x!, node.width!, index, count, cornerInset),
      y: side === 'top' ? rect.top : rect.bottom,
    };
  }
  return {
    x: side === 'left' ? rect.left : rect.right,
    y: forceCenter
      ? node.y!
      : distributedPortCoordinate(node.y!, node.height!, index, count, cornerInset),
  };
}

function distributedPortCoordinate(
  center: number,
  size: number,
  index: number,
  count: number,
  cornerInset = PORT_CORNER_CLEARANCE
): number {
  if (count <= 1) {
    return center;
  }
  // A side needs enough room for every incident edge. Fixed insets collapse
  // high-degree nodes, so retain a small corner clearance and share the rest.
  const span = Math.min((count - 1) * PORT_SPACING, Math.max(0, size - 2 * cornerInset));
  return center - span / 2 + (span * index) / (count - 1);
}

function distributedPortCoordinateAvoidingCenter(
  center: number,
  size: number,
  index: number,
  count: number,
  centeredIndex: number,
  cornerInset = PORT_CORNER_CLEARANCE
): number {
  if (count % 2 === 0) {
    return distributedPortCoordinate(center, size, index, count, cornerInset);
  }
  const middleIndex = (count - 1) / 2;
  let adjustedIndex = index;
  if (centeredIndex < middleIndex && index >= middleIndex) {
    adjustedIndex++;
  } else if (centeredIndex > middleIndex && index <= middleIndex) {
    adjustedIndex--;
  }
  const span = Math.min((count - 1) * PORT_SPACING, Math.max(0, size - 2 * cornerInset));
  const coordinate = center + (adjustedIndex - middleIndex) * (span / (count - 1));
  return Math.max(
    center - size / 2 + cornerInset,
    Math.min(center + size / 2 - cornerInset, coordinate)
  );
}

function extendPort(point: Point, side: Side, rect: Rect): Point {
  return {
    top: { x: point.x, y: Math.min(point.y, rect.top) - CLEARANCE },
    right: { x: Math.max(point.x, rect.right) + CLEARANCE, y: point.y },
    bottom: { x: point.x, y: Math.max(point.y, rect.bottom) + CLEARANCE },
    left: { x: Math.min(point.x, rect.left) - CLEARANCE, y: point.y },
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
  return obstacles.every(
    (obstacle) => !segmentIntersectsRect(a, b, obstacle) && !segmentHugsRectBorder(a, b, obstacle)
  );
}

function segmentHugsRectBorder(a: Point, b: Point, rect: Rect): boolean {
  // Label reserves use an anonymous sentinel node. Parallel labelled bundles
  // may legitimately run on the conservative reserve boundary: the actual
  // label box remains clear, and treating that synthetic edge as a solid
  // node border would turn the second straight lane into a perimeter detour.
  if (!rect.node.id) {
    return false;
  }
  if (Math.abs(a.y - b.y) <= EPSILON) {
    const onHorizontalBorder =
      Math.abs(a.y - rect.top) <= BORDER_HUG_PROXIMITY ||
      Math.abs(a.y - rect.bottom) <= BORDER_HUG_PROXIMITY;
    const overlap =
      Math.min(Math.max(a.x, b.x), rect.right) - Math.max(Math.min(a.x, b.x), rect.left);
    return onHorizontalBorder && overlap >= BORDER_HUG_MIN_LENGTH;
  }
  if (Math.abs(a.x - b.x) <= EPSILON) {
    const onVerticalBorder =
      Math.abs(a.x - rect.left) <= BORDER_HUG_PROXIMITY ||
      Math.abs(a.x - rect.right) <= BORDER_HUG_PROXIMITY;
    const overlap =
      Math.min(Math.max(a.y, b.y), rect.bottom) - Math.max(Math.min(a.y, b.y), rect.top);
    return onVerticalBorder && overlap >= BORDER_HUG_MIN_LENGTH;
  }
  return false;
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

function selfLoopSide(node: Node, edges: Edge[], nodes: Map<string, Node>): Side {
  const usage = new Map<Side, number>([
    ['top', 0],
    ['right', 0],
    ['bottom', 0],
    ['left', 0],
  ]);
  for (const edge of edges) {
    const endpoint = edge.start === node.id ? 'start' : edge.end === node.id ? 'end' : undefined;
    const otherId = endpoint === 'start' ? edge.end : endpoint === 'end' ? edge.start : undefined;
    const other = otherId ? nodes.get(otherId) : undefined;
    if (!endpoint || !other || other === node) {
      continue;
    }
    const side = sideToward(node, other, endpoint);
    usage.set(side, usage.get(side)! + 1);
  }
  // Side order gives a stable result when more than one side is unused. The
  // left loop is a good default for a left-to-right fan because it stays out
  // of the diagram's active downstream corridor.
  const sides: Side[] = ['left', 'top', 'right', 'bottom'];
  return sides.sort((first, second) => usage.get(first)! - usage.get(second)!)[0];
}

function selfLoop(rect: Rect, gridSpacing: number, side: Side): Point[] {
  const x = (rect.left + rect.right) / 2;
  const y = (rect.top + rect.bottom) / 2;
  // Self loops should read as local annotations, not span an entire grid
  // cell. Keeping the reach within normal frame padding also avoids crossing
  // an unrelated branch above or below the node.
  const reach = Math.max(CLEARANCE, Math.min(gridSpacing / 4, 32));
  const halfPortGap = PORT_SPACING / 2;
  return {
    top: [
      { x: x - halfPortGap, y: rect.top },
      { x: x - halfPortGap, y: rect.top - reach },
      { x: x + halfPortGap, y: rect.top - reach },
      { x: x + halfPortGap, y: rect.top },
    ],
    right: [
      { x: rect.right, y: y - halfPortGap },
      { x: rect.right + reach, y: y - halfPortGap },
      { x: rect.right + reach, y: y + halfPortGap },
      { x: rect.right, y: y + halfPortGap },
    ],
    bottom: [
      { x: x - halfPortGap, y: rect.bottom },
      { x: x - halfPortGap, y: rect.bottom + reach },
      { x: x + halfPortGap, y: rect.bottom + reach },
      { x: x + halfPortGap, y: rect.bottom },
    ],
    left: [
      { x: rect.left, y: y - halfPortGap },
      { x: rect.left - reach, y: y - halfPortGap },
      { x: rect.left - reach, y: y + halfPortGap },
      { x: rect.left, y: y + halfPortGap },
    ],
  }[side];
}
