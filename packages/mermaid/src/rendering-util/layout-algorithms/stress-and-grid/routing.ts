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

type Side = 'top' | 'right' | 'bottom' | 'left';
type Axis = 'H' | 'V';

const CLEARANCE = 20;
const PORT_SPACING = 14;
const TURN_PENALTY = 12;
const ROUTE_INTERACTION_PENALTY = 10_000;
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
        : routeBetweenPorts(
            ports.get(`${edge.id}:start`)!,
            sideAtPort(sourceRect, ports.get(`${edge.id}:start`)!, sideToward(source, target)),
            ports.get(`${edge.id}:end`)!,
            sideAtPort(targetRect, ports.get(`${edge.id}:end`)!, sideToward(target, source)),
            obstacles.filter((rect) => rect.node !== source && rect.node !== target),
            gridSpacing,
            routedPaths
          );
    edge.points = points;
    routedPaths.push(points);
    const midpoint = pointAtHalfLength(points);
    edge.x = midpoint.x;
    edge.y = midpoint.y;
    // Rounded corners retain the exact obstacle-avoiding polyline while
    // matching ELK's polished edge treatment.
    edge.curve = 'rounded';
    edge.roundedCornerRadius = Math.min(16, gridSpacing / 8);
    edge.hasIntersectionPoints = true;
  }
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
  routedPaths: Point[][]
): Point[] {
  // Stubs give the visibility-grid route room to turn away from its port.
  // This also keeps diamond-side attachments on the outside of the shape.
  const startStub = extendPort(start, startSide);
  const endStub = extendPort(end, endSide);
  return simplify([
    start,
    startStub,
    ...findRoute(startStub, endStub, obstacles, gridSpacing, routedPaths),
    endStub,
    end,
  ]);
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
  for (const edge of edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target || source === target) {
      continue;
    }
    const sourceSide = sideToward(source, target);
    const targetSide = sideToward(target, source);
    add(assignments, `${source.id}:${sourceSide}`, { edge, endpoint: 'start', side: sourceSide });
    add(assignments, `${target.id}:${targetSide}`, { edge, endpoint: 'end', side: targetSide });
  }

  const ports = new Map<string, Point>();
  for (const [key, values] of assignments) {
    const [nodeId, side] = key.split(':') as [string, Side];
    const node = nodes.get(nodeId)!;
    values.sort((a, b) => a.edge.id.localeCompare(b.edge.id));
    values.forEach((value, index) => {
      ports.set(
        `${value.edge.id}:${value.endpoint}`,
        portOnSide(node, side, value.endpoint, index - (values.length - 1) / 2)
      );
    });
  }
  return ports;
}

function add<T>(map: Map<string | number, T[]>, key: string | number, value: T): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function sideToward(from: Node, to: Node): Side {
  const dx = (to.x ?? 0) - (from.x ?? 0);
  const dy = (to.y ?? 0) - (from.y ?? 0);
  if (Math.abs(dx) > Math.abs(dy)) {
    return dx >= 0 ? 'right' : 'left';
  }
  return dy >= 0 ? 'bottom' : 'top';
}

function portOnSide(node: Node, side: Side, endpoint: 'start' | 'end', offsetIndex: number): Point {
  const rect = rectFor(node)!;
  if (/diamond|rhombus/.test(String(node.shape))) {
    if (endpoint === 'end') {
      // A decision's incoming flow reads most clearly when it resolves at a
      // vertex; only outgoing branches need the extra room of sloped sides.
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
    const offset = offsetIndex > 0 ? 1 : -1;
    return {
      top: { x: node.x! + (offset * node.width!) / 4, y: node.y! - node.height! / 4 },
      right: { x: node.x! + node.width! / 4, y: node.y! + (offset * node.height!) / 4 },
      bottom: { x: node.x! + (offset * node.width!) / 4, y: node.y! + node.height! / 4 },
      left: { x: node.x! - node.width! / 4, y: node.y! + (offset * node.height!) / 4 },
    }[side];
  }
  const offset = offsetIndex * PORT_SPACING;
  if (side === 'top' || side === 'bottom') {
    const inset = usablePortInset(node.width!);
    return {
      x: clamp(node.x! + offset, rect.left + inset, rect.right - inset),
      y: side === 'top' ? rect.top : rect.bottom,
    };
  }
  const inset = usablePortInset(node.height!);
  return {
    x: side === 'left' ? rect.left : rect.right,
    y: clamp(node.y! + offset, rect.top + inset, rect.bottom - inset),
  };
}

function usablePortInset(size: number): number {
  // Do not invert the clamp range on small nodes. Leave a two-pixel span so
  // repeated ports can still fan out instead of collapsing to one point.
  return Math.min(CLEARANCE, Math.max(0, size / 2 - 2));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
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
  routedPaths: Point[][]
): Point[] {
  if (segmentClear(start, end, obstacles)) {
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
    visibilityGraph(points, obstacles, routedPaths),
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
  routedPaths: Point[][]
): Map<number, VisibilityEdge[]> {
  const graph = new Map<number, VisibilityEdge[]>();
  const rows = new Map<number, number[]>();
  const columns = new Map<number, number[]>();
  points.forEach((point, index) => {
    add(rows, point.y, index);
    add(columns, point.x, index);
  });
  addLineEdges(rows, points, obstacles, routedPaths, 'H', graph);
  addLineEdges(columns, points, obstacles, routedPaths, 'V', graph);
  return graph;
}

function addLineEdges(
  lines: Map<number, number[]>,
  points: Point[],
  obstacles: Rect[],
  routedPaths: Point[][],
  axis: Axis,
  graph: Map<number, VisibilityEdge[]>
): void {
  for (const indices of lines.values()) {
    indices.sort((a, b) => (axis === 'H' ? points[a].x - points[b].x : points[a].y - points[b].y));
    for (let index = 1; index < indices.length; index++) {
      const a = indices[index - 1];
      const b = indices[index];
      if (segmentClear(points[a], points[b], obstacles)) {
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

function segmentsInteract(a: Point, b: Point, c: Point, d: Point): boolean {
  const aHorizontal = Math.abs(a.y - b.y) <= EPSILON;
  const cHorizontal = Math.abs(c.y - d.y) <= EPSILON;
  if (aHorizontal === cHorizontal) {
    if (aHorizontal ? Math.abs(a.y - c.y) > EPSILON : Math.abs(a.x - c.x) > EPSILON) {
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
