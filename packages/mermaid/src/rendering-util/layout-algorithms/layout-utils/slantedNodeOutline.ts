import type { Node } from '../../types.js';
import type { Point } from './types.js';

const TRAPEZOIDS = new Set(['trap-b', 'priority', 'trapezoid-bottom', 'trapezoid']);
const PARALLELOGRAMS = new Set(['lean-l', 'lean-left', 'out-in', 'lean_left']);
const EPSILON = 1e-6;

/**
 * The polygons drawn by trapezoid.ts and leanLeft.ts, in layout coordinates.
 * Measured width includes the slanted wings, unlike the label body's width.
 */
export function slantedNodePolygon(node: Node): Point[] | undefined {
  const trapezoid = TRAPEZOIDS.has(String(node.shape));
  if (!trapezoid && !PARALLELOGRAMS.has(String(node.shape))) {
    return undefined;
  }
  const { x, y, width, height } = node;
  if (x == null || y == null || width == null || height == null || width <= 0 || height <= 0) {
    return undefined;
  }
  const left = x - width / 2;
  const right = x + width / 2;
  const top = y - height / 2;
  const bottom = y + height / 2;
  const inset = height / 2;
  return trapezoid
    ? [
        { x: left, y: bottom },
        { x: right, y: bottom },
        { x: right - inset, y: top },
        { x: left + inset, y: top },
      ]
    : [
        { x: left, y: top },
        { x: right - inset, y: top },
        { x: right, y: bottom },
        { x: left + inset, y: bottom },
      ];
}

/** Extend a rectangular port to the drawn outline along its existing H/V lane. */
export function projectToSlantedNodeOutline(node: Node, port: Point, outside: Point): Point {
  const polygon = slantedNodePolygon(node);
  if (!polygon) {
    return port;
  }
  const horizontal = Math.abs(port.y - outside.y) <= EPSILON;
  const vertical = Math.abs(port.x - outside.x) <= EPSILON;
  if (horizontal === vertical) {
    return port;
  }
  const axis = horizontal ? 'x' : 'y';
  const fixedAxis = horizontal ? 'y' : 'x';
  const intersections: number[] = [];
  for (const [index, a] of polygon.entries()) {
    const b = polygon[(index + 1) % polygon.length];
    const delta = b[fixedAxis] - a[fixedAxis];
    if (Math.abs(delta) <= EPSILON) {
      if (Math.abs(port[fixedAxis] - a[fixedAxis]) <= EPSILON) {
        intersections.push(a[axis], b[axis]);
      }
      continue;
    }
    const t = (port[fixedAxis] - a[fixedAxis]) / delta;
    if (t >= -EPSILON && t <= 1 + EPSILON) {
      intersections.push(a[axis] + t * (b[axis] - a[axis]));
    }
  }
  if (intersections.length === 0) {
    return port;
  }
  return {
    ...port,
    [axis]: outside[axis] > port[axis] ? Math.max(...intersections) : Math.min(...intersections),
  };
}

/** Signed inward distances to a convex polygon's supporting lines, in pixels. */
function inwardDistances(point: Point, polygon: Point[]): number[] {
  const center = {
    x: polygon.reduce((sum, p) => sum + p.x, 0) / polygon.length,
    y: polygon.reduce((sum, p) => sum + p.y, 0) / polygon.length,
  };
  return polygon.map((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const orientation = Math.sign(dx * (center.y - a.y) - dy * (center.x - a.x));
    return (orientation * (dx * (point.y - a.y) - dy * (point.x - a.x))) / Math.hypot(dx, dy);
  });
}

export function pointInsidePolygonInterior(
  point: Point,
  polygon: Point[],
  margin: number
): boolean {
  return inwardDistances(point, polygon).every((distance) => distance > margin);
}

/** Clip against inward half-planes; touching the outline alone is not an interior hit. */
export function segmentIntersectsPolygonInterior(
  a: Point,
  b: Point,
  polygon: Point[],
  margin: number
): boolean {
  const startDistances = inwardDistances(a, polygon);
  const endDistances = inwardDistances(b, polygon);
  let from = 0;
  let to = 1;
  for (const [index, start] of startDistances.entries()) {
    const delta = endDistances[index] - start;
    if (Math.abs(delta) <= EPSILON) {
      if (start <= margin) {
        return false;
      }
      continue;
    }
    const crossing = (margin - start) / delta;
    if (delta > 0) {
      from = Math.max(from, crossing);
    } else {
      to = Math.min(to, crossing);
    }
    if (from >= to) {
      return false;
    }
  }
  return from < to;
}
