/**
 * Push apart edge runs that end up drawn too close to read as two edges.
 *
 * HOLA parks a route's legs at whichever distance the step that made them cared
 * about: a terminal leg sits at `minTerminalLegLength` from its node, a route
 * passing the same node sits at `routingClearance`. Those two numbers are chosen
 * independently, and nothing downstream compares them — so wherever a terminal
 * leg runs alongside a passing route, the pair lands exactly
 * `minTerminalLegLength - routingClearance` apart. With the shipped options that
 * is 6px, and two lines 6px apart over 120px read as one thick line.
 *
 * The validator draws the line at {@link MIN_PARALLEL_GAP}: parallel sections
 * closer than that, overlapping by more than a hair, are a hard issue. Rather
 * than re-tune the constants each step uses — they are load-bearing for reasons
 * that have nothing to do with each other — this pass runs last and fixes the
 * pairs that actually collided.
 *
 * ## What it will not do
 *
 * It moves a segment only when the move is provably safe:
 *
 * - **Interior segments only.** The first and last segments of a polyline carry
 *   the point attached to a node boundary; moving those detaches the edge.
 * - **Orthogonality is preserved by construction.** Shifting a horizontal
 *   segment's `y` moves both its endpoints, which only lengthens or shortens the
 *   vertical segments either side — they keep their `x`, so the polyline stays
 *   axis-aligned.
 * - **Never past a neighbour's far end.** A shift that would invert the segment
 *   either side of it is skipped rather than clamped, because a zero-length or
 *   reversed leg is a worse drawing than the one it replaced.
 *
 * Anything it cannot fix safely it leaves alone, so the worst case is the
 * drawing it was given.
 */
import type { Edge } from '../../../types.js';

/**
 * Perpendicular distance below which two parallel runs stop reading as two
 * edges. Matches `EPS_PARALLEL_EDGE_GAP` in `validateLayout`; the pass targets
 * one pixel beyond it so a rounding difference cannot land back on the line.
 */
const MIN_PARALLEL_GAP = 8;

/** Minimum projected overlap for two parallel runs to be worth separating. */
const MIN_OVERLAP = 8;

/** A leg shorter than this is not a leg; refuse shifts that would create one. */
const MIN_LEG = 2;

interface Run {
  edge: Edge;
  /** Index of the run's first point; the run spans `index` → `index + 1`. */
  index: number;
  horizontal: boolean;
  /** The shared coordinate: `y` for a horizontal run, `x` for a vertical one. */
  at: number;
  /** Extent along the run's own axis, ordered low → high. */
  from: number;
  to: number;
}

function runsOf(edge: Edge): Run[] {
  const points = edge.points;
  if (!points || points.length < 4) {
    // Fewer than four points means every segment touches a terminal point.
    return [];
  }
  const runs: Run[] = [];
  // Skip the first and last segment: both carry a node-attached point.
  for (let index = 1; index < points.length - 2; index++) {
    const a = points[index];
    const b = points[index + 1];
    const horizontal = Math.abs(a.y - b.y) < 1e-6;
    const vertical = Math.abs(a.x - b.x) < 1e-6;
    if (horizontal === vertical) {
      // Diagonal, or a zero-length stub: not something to move.
      continue;
    }
    runs.push({
      edge,
      index,
      horizontal,
      at: horizontal ? a.y : a.x,
      from: Math.min(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
      to: Math.max(horizontal ? a.x : a.y, horizontal ? b.x : b.y),
    });
  }
  return runs;
}

/** How far the two runs overlap when projected onto their shared axis. */
function projectedOverlap(a: Run, b: Run): number {
  return Math.min(a.to, b.to) - Math.max(a.from, b.from);
}

/**
 * Move a run to `target`, if the legs either side survive it.
 *
 * Returns whether the move was applied. The neighbours are the segments at
 * `index - 1` and `index + 1`; each is perpendicular to the run, so the run's
 * shift changes their length and nothing else.
 */
function shiftRun(run: Run, target: number): boolean {
  const points = run.edge.points;
  if (!points) {
    return false;
  }
  const before = points[run.index - 1];
  const after = points[run.index + 2];
  const current = run.at;
  // The neighbours anchor at `before` and `after`; the run may not cross either,
  // or the leg that reached it would double back.
  const lower = Math.min(run.horizontal ? before.y : before.x, run.horizontal ? after.y : after.x);
  const upper = Math.max(run.horizontal ? before.y : before.x, run.horizontal ? after.y : after.x);
  const movingUp = target > current;
  if (movingUp ? target > upper - MIN_LEG : target < lower + MIN_LEG) {
    return false;
  }
  if (run.horizontal) {
    points[run.index].y = target;
    points[run.index + 1].y = target;
  } else {
    points[run.index].x = target;
    points[run.index + 1].x = target;
  }
  run.at = target;
  return true;
}

/**
 * Separate parallel runs drawn closer than {@link MIN_PARALLEL_GAP}.
 *
 * Mutates `edge.points` in place. Safe to call on any set of edges: routes it
 * cannot separate without harming them are left exactly as they were.
 */
export function separateParallelRuns(edges: readonly Edge[]): number {
  const runs: Run[] = [];
  for (const edge of edges) {
    if (edge.isLayoutOnly) {
      continue;
    }
    runs.push(...runsOf(edge));
  }

  let moved = 0;
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      const a = runs[i];
      const b = runs[j];
      if (a.edge === b.edge || a.horizontal !== b.horizontal) {
        continue;
      }
      const gap = Math.abs(a.at - b.at);
      if (gap < 1e-6 || gap >= MIN_PARALLEL_GAP) {
        // Collinear runs are a shared subpath, a different defect with a
        // different fix; anything already clear needs nothing.
        continue;
      }
      if (projectedOverlap(a, b) < MIN_OVERLAP) {
        continue;
      }
      // Push the two apart symmetrically where both can move, and put the whole
      // correction on one where only one can. Splitting it keeps each route
      // closer to the position the router chose for it.
      const need = MIN_PARALLEL_GAP - gap;
      const [low, high] = a.at < b.at ? [a, b] : [b, a];
      const half = need / 2;
      const lowOk = shiftRun(low, low.at - half);
      const highOk = shiftRun(high, high.at + (lowOk ? half : need));
      if (!lowOk && !highOk) {
        continue;
      }
      if (lowOk && !highOk) {
        shiftRun(low, low.at - half);
      }
      moved++;
    }
  }
  return moved;
}
