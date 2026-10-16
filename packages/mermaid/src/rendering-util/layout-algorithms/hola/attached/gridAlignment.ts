import type { LayoutData, Node } from '../../../types.js';
import { nodeGroupClearanceOf } from '../../layout-utils/validateLayout.js';
import type { GridAttachedOptions } from './options.js';
import { countEdgeCrossings, countEdgesThroughForeignNodes } from '../parts/partQuality.js';
import { collectSubgraphs, fitSubgraphFrames } from './subgraphs.js';

const EPSILON = 1e-6;

/**
 * Soft grid snapping can leave several nearby ranks where one row or column was
 * intended. Settle those ranks together before routing, preserving exact existing
 * alignments. The capture window is bounded by the smallest measured half-extent,
 * so a chain of small offsets cannot collapse distinct ranks into one.
 */
export function settleNearbyGridLines(
  layout: LayoutData,
  solverData: LayoutData,
  options: GridAttachedOptions
): void {
  const nodes = layout.nodes.filter((node) => !node.isGroup);
  for (const axis of ['x', 'y'] as const) {
    const ordered = [...nodes].sort((a, b) => (a[axis] ?? 0) - (b[axis] ?? 0));
    // Exact lines move as units, even when their members have different sizes.
    const lines: Node[][] = [];
    for (const node of ordered) {
      const previous = lines.at(-1);
      if (previous && Math.abs((previous[0][axis] ?? 0) - (node[axis] ?? 0)) <= EPSILON) {
        previous.push(node);
      } else {
        lines.push([node]);
      }
    }
    const captureWindow = (line: Node[]) =>
      Math.min(options.snapDistance, ...line.map((node) => extent(node, axis) / 2));
    let start = 0;
    while (start < lines.length) {
      let end = start + 1;
      let window = captureWindow(lines[start]);
      while (end < lines.length) {
        const nextWindow = Math.min(window, captureWindow(lines[end]));
        if ((lines[end][0][axis] ?? 0) - (lines[start][0][axis] ?? 0) > nextWindow) {
          break;
        }
        window = nextWindow;
        end++;
      }
      const rank = lines.slice(start, end).flat();
      const spread = (rank.at(-1)![axis] ?? 0) - (rank[0][axis] ?? 0);
      if (spread > EPSILON) {
        const mean = rank.reduce((sum, node) => sum + (node[axis] ?? 0), 0) / rank.length;
        const members = new Set(rank.map((node) => node.id));
        // The mean minimises movement, but an existing line can be the nearest
        // feasible anchor when a foreign frame already limits one side.
        const anchors = new Set([
          mean,
          ...lines.slice(start, end).map((line) => line[0][axis] ?? 0),
        ]);
        for (const centre of anchors) {
          const trial = nodes.map((node) =>
            members.has(node.id) ? { ...node, [axis]: centre } : node
          );
          if (safeAlignment(layout, solverData, nodes, trial, options)) {
            for (const node of rank) {
              node[axis] = centre;
            }
            break;
          }
        }
      }
      start = end;
    }
  }
  settleParallelGroupRanks(layout, solverData, options);
}

/** Align a repeated cross-group connection without disturbing either group's grid. */
function settleParallelGroupRanks(
  layout: LayoutData,
  solverData: LayoutData,
  options: GridAttachedOptions
): void {
  const model = collectSubgraphs(solverData);
  const groups = model.ordered.filter((group) => !group.parentId);
  const groupOf = new Map(
    groups.flatMap((group) => group.leafIds.map((id) => [id, group] as const))
  );
  const bundles = new Map<string, { source: string; target: string; count: number }>();
  for (const edge of layout.edges) {
    if (edge.isLayoutOnly || !edge.start || !edge.end || edge.start === edge.end) {
      continue;
    }
    const [source, target] = [edge.start, edge.end].sort();
    const key = `${source}\u0000${target}`;
    const bundle = bundles.get(key);
    if (bundle) {
      bundle.count++;
    } else {
      bundles.set(key, { source, target, count: 1 });
    }
  }
  const nodes = layout.nodes.filter((node) => !node.isGroup);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const flowAxis = layout.direction === 'LR' || layout.direction === 'RL' ? 'x' : 'y';
  const axes: ('x' | 'y')[] = flowAxis === 'x' ? ['y', 'x'] : ['x', 'y'];
  const bends = (trial: Node[]) => {
    const positions = new Map(trial.map((node) => [node.id, node]));
    return layout.edges.filter((edge) => {
      const a = positions.get(edge.start ?? '');
      const b = positions.get(edge.end ?? '');
      return (
        !edge.isLayoutOnly &&
        a &&
        b &&
        Math.abs((a.x ?? 0) - (b.x ?? 0)) > EPSILON &&
        Math.abs((a.y ?? 0) - (b.y ?? 0)) > EPSILON
      );
    }).length;
  };
  for (const bundle of [...bundles.values()]
    .filter((bundle) => bundle.count > 1)
    .sort((a, b) => b.count - a.count)) {
    const source = byId.get(bundle.source);
    const target = byId.get(bundle.target);
    const sourceGroup = groupOf.get(bundle.source);
    const targetGroup = groupOf.get(bundle.target);
    if (!source || !target || !sourceGroup || !targetGroup || sourceGroup === targetGroup) {
      continue;
    }
    const moves = axes.flatMap((axis) => {
      const delta = (source[axis] ?? 0) - (target[axis] ?? 0);
      return Math.abs(delta) < EPSILON
        ? []
        : [
            { group: targetGroup, shift: delta, axis },
            { group: sourceGroup, shift: -delta, axis },
          ].sort((a, b) => a.group.leafIds.length - b.group.leafIds.length);
    });
    for (const { group, shift, axis } of moves) {
      const members = new Set(group.leafIds);
      const trial = nodes.map((node) =>
        members.has(node.id) ? { ...node, [axis]: (node[axis] ?? 0) + shift } : node
      );
      const trialById = new Map(trial.map((node) => [node.id, node]));
      const keepsFlowOrder = layout.edges.every((edge) => {
        if (edge.isLayoutOnly) {
          return true;
        }
        const a = byId.get(edge.start ?? '');
        const b = byId.get(edge.end ?? '');
        const nextA = trialById.get(edge.start ?? '');
        const nextB = trialById.get(edge.end ?? '');
        return (
          !a ||
          !b ||
          !nextA ||
          !nextB ||
          ((b[flowAxis] ?? 0) - (a[flowAxis] ?? 0)) *
            ((nextB[flowAxis] ?? 0) - (nextA[flowAxis] ?? 0)) >=
            -EPSILON
        );
      });
      if (
        keepsFlowOrder &&
        bends(trial) < bends(nodes) &&
        safeAlignment(layout, solverData, nodes, trial, options)
      ) {
        for (const node of nodes) {
          if (members.has(node.id)) {
            node[axis] = (node[axis] ?? 0) + shift;
          }
        }
        break;
      }
    }
  }
}

function extent(node: Node, axis: 'x' | 'y'): number {
  return axis === 'x' ? (node.width ?? 0) : (node.height ?? 0);
}

function safeAlignment(
  layout: LayoutData,
  solverData: LayoutData,
  before: Node[],
  after: Node[],
  options: GridAttachedOptions
): boolean {
  for (let i = 0; i < after.length; i++) {
    for (let j = i + 1; j < after.length; j++) {
      const gap = (nodes: Node[], axis: 'x' | 'y') =>
        Math.abs((nodes[i][axis] ?? 0) - (nodes[j][axis] ?? 0)) -
        (extent(nodes[i], axis) + extent(nodes[j], axis)) / 2;
      const x = gap(after, 'x');
      const y = gap(after, 'y');
      if (
        (y < options.rankSpacing - EPSILON &&
          x < Math.min(gap(before, 'x'), options.nodeSpacing) - EPSILON) ||
        (x < options.nodeSpacing - EPSILON &&
          y < Math.min(gap(before, 'y'), options.rankSpacing) - EPSILON)
      ) {
        return false;
      }
    }
  }
  const measuredLayout = (nodes: Node[]): LayoutData => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    return {
      ...layout,
      nodes,
      edges: layout.edges
        .filter((edge) => !edge.isLayoutOnly)
        .map((edge) => {
          const source = byId.get(edge.start ?? '');
          const target = byId.get(edge.end ?? '');
          return {
            ...edge,
            points:
              source && target
                ? [
                    { x: source.x ?? 0, y: source.y ?? 0 },
                    { x: target.x ?? 0, y: target.y ?? 0 },
                  ]
                : edge.points,
          };
        }),
    };
  };
  const original = measuredLayout(before);
  const candidate = measuredLayout(after);
  const bends = (data: LayoutData) =>
    data.edges.filter((edge) => {
      const points = edge.points;
      return (
        points?.length === 2 &&
        Math.abs(points[0].x - points[1].x) > EPSILON &&
        Math.abs(points[0].y - points[1].y) > EPSILON
      );
    }).length;
  if (
    countEdgesThroughForeignNodes(candidate) > countEdgesThroughForeignNodes(original) ||
    countEdgeCrossings(candidate) > countEdgeCrossings(original) ||
    bends(candidate) > bends(original)
  ) {
    return false;
  }
  const frameGeometry = (nodes: Node[]) => {
    const data = {
      ...solverData,
      nodes: [
        ...nodes,
        ...solverData.nodes.filter((node) => node.isGroup).map((node) => ({ ...node })),
      ],
    };
    const model = collectSubgraphs(data);
    const frames = fitSubgraphFrames(model, nodes, options);
    const clearances = new Map<string, number>();
    for (const frame of frames) {
      const own = new Set(model.byId.get(frame.id)?.leafIds);
      for (const node of nodes) {
        if (own.has(node.id)) {
          continue;
        }
        const x = node.x ?? 0;
        const y = node.y ?? 0;
        const gapX = Math.max(
          frame.bounds.minX - x - extent(node, 'x') / 2,
          x - extent(node, 'x') / 2 - frame.bounds.maxX
        );
        const gapY = Math.max(
          frame.bounds.minY - y - extent(node, 'y') / 2,
          y - extent(node, 'y') / 2 - frame.bounds.maxY
        );
        clearances.set(`${frame.id}\u0000${node.id}`, Math.max(0, gapX, gapY));
      }
    }
    return {
      conflicts: new Map(frames.map((frame) => [frame.id, new Set(frame.foreign)])),
      clearances,
    };
  };
  const originalFrames = frameGeometry(before);
  const candidateFrames = frameGeometry(after);
  const clearance = nodeGroupClearanceOf(solverData);
  return (
    [...candidateFrames.conflicts].every(([id, conflicts]) =>
      [...conflicts].every((nodeId) => originalFrames.conflicts.get(id)?.has(nodeId))
    ) &&
    [...candidateFrames.clearances].every(
      ([pair, gap]) =>
        gap >= Math.min(originalFrames.clearances.get(pair) ?? gap, clearance) - EPSILON
    )
  );
}
