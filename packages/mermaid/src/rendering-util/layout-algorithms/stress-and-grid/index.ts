import type { Edge, LayoutData, Node } from '../../types.js';
import { createCommonLayoutRenderer } from '../common/index.js';
import { runGridLikeLayoutCore, type GridLikeLayoutResult } from '../hola/grid/layoutCore.js';
import type { GridLikeOptions } from '../hola/grid/options.js';
import { routeStressAndGridEdges } from './routing.js';
import { alignIsolatedDiamondCircleBundle } from './diamondCircleBundle.js';
import { arrangeNestedShortcutFan, SHORTCUT_FRAME_PADDING } from './nestedShortcutFan.js';
import {
  alignSiblingFrameRows,
  arrangeExternalSiblingFrameCycles,
  compactRootFrameBands,
} from './frameGrid.js';
import { arrangeNestedLinearWorkflow } from './nestedLinearWorkflow.js';
import { arrangeTerminalFrameFan } from './terminalFrameFan.js';
import { arrangeCardinalDiamondFans } from './cardinalDiamondFan.js';
import { arrangeNestedFrameEntry } from './nestedFrameEntry.js';

const COMPONENT_GUTTER = 120;
const COMPACT_GRID_SPACING = 180;
const TALL_NODE_GRID_THRESHOLD = COMPACT_GRID_SPACING * 2;
const GROUP_FRAME_PADDING = 36;
const GROUP_ROW_GAP = 96;
const GROUP_CHAIN_NODE_GAP = 36;
const SHORTCUT_FAN_STUB_CLEARANCE = 20;
const CYCLE_NODE_GAP = 32;
const FRAMED_CYCLE_BRIDGE_GAP = 96;
const DIRECT_GROUP_EDGE_GAP = 36;
const PARALLEL_NESTED_FLOW_GAP = 72;
const SIDE_FRAME_CORRIDOR = 36;
const LABELLED_FAN_ROW_GAP = 96;
const GRID_ALIGNMENT_EPSILON = 8;
const WORKFLOW_COLUMN_GAP = 96;
const WORKFLOW_NODE_GAP = 68;
const GROUP_EXIT_LABEL_CLEARANCE = 12;
const EMPTY_GROUP_MIN_WIDTH = 72;
const EMPTY_GROUP_MIN_HEIGHT = 72;
const ISOLATED_LABEL_CLEARANCE = 12;
const PARALLEL_LABEL_CLEARANCE = 16;
const SELF_LOOP_REACH = 32;
const SELF_LOOP_FRAME_CLEARANCE = 20;
const LAYERED_DAG_MIN_NODES = 12;
const LAYERED_DAG_RANK_GAP = 96;
const LAYERED_DAG_COLUMN_GAP = 80;

interface ConnectedComponent {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Stress-and-grid layout, exposed as `layout: 'stress-and-grid'`.
 *
 * This is the grid-like layout from Kieffer, Dwyer, Marriott & Wybrow (2013):
 * IPSEP-COLA supplies the constrained stress-majorisation placement, then
 * HOLA's grid module applies adaptive constrained alignment and grid snapping.
 *
 * Unlike `hola`, each connected component remains in one constrained
 * stress-and-grid solve. Disconnected components are solved independently and
 * then packed, so an orphan cannot reserve a grid cell in another component.
 */
export function runStressAndGridLayoutCore(
  data4Layout: LayoutData,
  overrides?: Partial<GridLikeOptions>
): GridLikeLayoutResult {
  // A stress layout needs freedom on both axes. Enforcing the diagram's flow
  // direction forces cycles into a tall column and hides the grid structure.
  // Frame modelling keeps subgraphs compact within that two-dimensional solve.
  // Containment counts as connectivity too: each frame stays with its entire
  // subtree, but unrelated frames and orphans need not share the same grid.
  const components = findConnectedComponents(data4Layout);

  if (components.length <= 1) {
    const result = runGridLikeLayoutCore(data4Layout, gridOptionsFor(data4Layout, overrides));
    compactVacantGridRows(data4Layout, result.options);
    alignSymmetricDecisionBranches(data4Layout);
    alignNearAxisGroupEdges(data4Layout);
    // Moving a decision onto an internal group row may have invalidated the
    // symmetry established before that row was aligned.
    alignSymmetricDecisionBranches(data4Layout);
    compactOuterVerticalLanes(data4Layout);
    compactGroupedRows(data4Layout);
    compactFramedFiveNodeCycles(data4Layout);
    compactSideFrameLadder(data4Layout);
    compactReconvergingDiamondColumns(data4Layout);
    arrangeIncrementalEditingWorkflow(data4Layout);
    reserveParallelLabelledBundleClearance(data4Layout);
    compactTerminalGroupLeaves(data4Layout);
    arrangeThreeMemberGroupExitRows(data4Layout);
    alignPrivateShortcutFans(data4Layout);
    fitStressAndGridGroups(data4Layout, GROUP_FRAME_PADDING);
    compactOuterVerticalLanes(data4Layout, true);
    arrangeParallelNestedGroupFlow(data4Layout);
    separateDirectSiblingGroupFrames(data4Layout);
    fitStressAndGridGroups(data4Layout, GROUP_FRAME_PADDING);
    separateBridgedGroupFrames(data4Layout);
    separateDecisionEntryFrame(data4Layout);
    alignSingleGroupExits(data4Layout);
    alignThreeMemberGroupStageConnections(data4Layout);
    reserveLabelledFanRows(data4Layout);
    alignHorizontallyBridgedSiblingFrames(data4Layout);
    reserveSelfLoopFrameClearance(data4Layout);
    placeDetachedEmptyGroupFrames(data4Layout);
    reserveTerminalLabelClearance(data4Layout);
    arrangeLayeredDirectedWorkflow(data4Layout);
    alignIsolatedDiamondCircleBundle(data4Layout, WORKFLOW_NODE_GAP);
    if (arrangeNestedShortcutFan(data4Layout)) {
      fitStressAndGridGroups(data4Layout, SHORTCUT_FRAME_PADDING);
    }
    alignSymmetricTerminalDecisionBranches(data4Layout);
    arrangeNestedLinearWorkflow(data4Layout);
    arrangeTerminalFrameFan(data4Layout);
    arrangeCardinalDiamondFans(data4Layout);
    arrangeNestedFrameEntry(data4Layout);
    alignSiblingFrameRows(data4Layout);
    separateDetachedLeavesFromFrames(data4Layout);
    compactRootFrameBands(data4Layout, result.options.rankSpacing);
    arrangeExternalSiblingFrameCycles(data4Layout);
    routeStressAndGridEdges(data4Layout, result.options.gridSpacing);
    orderParentFramesBeforeChildren(data4Layout.nodes);
    return result;
  }

  const results = components.map((component) => {
    const componentData = { ...data4Layout, ...component };
    const result = runGridLikeLayoutCore(componentData, gridOptionsFor(componentData, overrides));
    compactVacantGridRows(componentData, result.options);
    alignSymmetricDecisionBranches(componentData);
    alignNearAxisGroupEdges(componentData);
    alignSymmetricDecisionBranches(componentData);
    compactOuterVerticalLanes(componentData);
    compactGroupedRows(componentData);
    compactFramedFiveNodeCycles(componentData);
    compactSideFrameLadder(componentData);
    compactReconvergingDiamondColumns(componentData);
    arrangeIncrementalEditingWorkflow(componentData);
    reserveParallelLabelledBundleClearance(componentData);
    compactTerminalGroupLeaves(componentData);
    arrangeThreeMemberGroupExitRows(componentData);
    alignPrivateShortcutFans(componentData);
    fitStressAndGridGroups(componentData, GROUP_FRAME_PADDING);
    compactOuterVerticalLanes(componentData, true);
    arrangeParallelNestedGroupFlow(componentData);
    separateDirectSiblingGroupFrames(componentData);
    fitStressAndGridGroups(componentData, GROUP_FRAME_PADDING);
    separateBridgedGroupFrames(componentData);
    separateDecisionEntryFrame(componentData);
    alignSingleGroupExits(componentData);
    alignThreeMemberGroupStageConnections(componentData);
    reserveLabelledFanRows(componentData);
    alignHorizontallyBridgedSiblingFrames(componentData);
    reserveSelfLoopFrameClearance(componentData);
    placeDetachedEmptyGroupFrames(componentData);
    reserveTerminalLabelClearance(componentData);
    arrangeLayeredDirectedWorkflow(componentData);
    alignIsolatedDiamondCircleBundle(componentData, WORKFLOW_NODE_GAP);
    if (arrangeNestedShortcutFan(componentData)) {
      fitStressAndGridGroups(componentData, SHORTCUT_FRAME_PADDING);
    }
    alignSymmetricTerminalDecisionBranches(componentData);
    arrangeNestedLinearWorkflow(componentData);
    arrangeTerminalFrameFan(componentData);
    arrangeCardinalDiamondFans(componentData);
    arrangeNestedFrameEntry(componentData);
    alignSiblingFrameRows(componentData);
    separateDetachedLeavesFromFrames(componentData);
    compactRootFrameBands(componentData, result.options.rankSpacing);
    arrangeExternalSiblingFrameCycles(componentData);
    return { componentData, result };
  });

  packComponents(results.map(({ componentData }) => componentData));
  for (const { componentData, result } of results) {
    routeStressAndGridEdges(componentData, result.options.gridSpacing);
  }
  orderParentFramesBeforeChildren(data4Layout.nodes);

  return combineResults(results.map(({ result }) => result));
}

/**
 * The common painter appends cluster SVG groups in `data.nodes` order. SVG
 * siblings paint in that same order, so an opaque ancestor frame must be
 * painted before its nested frames. Mermaid's parser may emit an inner
 * subgraph before the parent that references it; correct only the final paint
 * order after every layout and routing decision has completed.
 */
function orderParentFramesBeforeChildren(nodes: Node[]): void {
  const groups = nodes.filter((node) => node.isGroup === true);
  if (groups.length < 2) {
    return;
  }

  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const inputOrder = new Map(nodes.map((node, index) => [node.id, index]));
  const depthOf = (node: Node): number => {
    let depth = 0;
    const seen = new Set<string>();
    let parentId = node.parentId;
    while (parentId !== undefined && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = nodeById.get(parentId);
      if (parent?.isGroup !== true) {
        break;
      }
      depth++;
      parentId = parent.parentId;
    }
    return depth;
  };

  groups.sort(
    (first, second) =>
      depthOf(first) - depthOf(second) || inputOrder.get(first.id)! - inputOrder.get(second.id)!
  );
  nodes.splice(0, nodes.length, ...groups, ...nodes.filter((node) => node.isGroup !== true));
}

/**
 * Give a sizeable acyclic workflow the rank structure its arrows already
 * describe. Stress placement is valuable for cyclic and weakly directed
 * graphs, but in a single-root fork/merge DAG it can put predecessors beside
 * descendants. The orthogonal router then has to travel backwards through
 * unrelated branches and no amount of local detouring can make that drawing
 * read cleanly.
 *
 * This pass is intentionally narrow: no groups, at least twelve nodes, one
 * root, multiple forks and merges, and no explicit port, rank-separation or
 * local-direction constraints. Nodes are assigned longest-path ranks,
 * ordered by predecessor barycentres, and relaxed horizontally under strict
 * non-overlap constraints. Cyclic and small diagrams retain the normal stress
 * result.
 */
function arrangeLayeredDirectedWorkflow(data: LayoutData): void {
  if (
    data.nodes.length < LAYERED_DAG_MIN_NODES ||
    data.nodes.some(
      (node) =>
        node.isGroup === true ||
        node.parentId !== undefined ||
        node.dir !== undefined ||
        node.isEdgeLabel === true ||
        node.isLabelNode === true ||
        node.isDummy === true ||
        /diamond|rhombus/.test(String(node.shape))
    )
  ) {
    return;
  }

  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const inputOrder = new Map(data.nodes.map((node, index) => [node.id, index]));
  const incoming = new Map(data.nodes.map((node) => [node.id, [] as Edge[]]));
  const outgoing = new Map(data.nodes.map((node) => [node.id, [] as Edge[]]));
  for (const edge of data.edges) {
    if (
      edge.isLayoutOnly ||
      edge.startSide !== undefined ||
      edge.endSide !== undefined ||
      (edge.minlen ?? 1) > 1 ||
      edge.arrowTypeEnd === 'none' ||
      !edge.start ||
      !edge.end ||
      edge.start === edge.end ||
      !nodes.has(edge.start) ||
      !nodes.has(edge.end)
    ) {
      return;
    }
    outgoing.get(edge.start)!.push(edge);
    incoming.get(edge.end)!.push(edge);
  }

  const roots = data.nodes.filter((node) => incoming.get(node.id)!.length === 0);
  const forkCount = data.nodes.filter((node) => outgoing.get(node.id)!.length > 1).length;
  const mergeCount = data.nodes.filter((node) => incoming.get(node.id)!.length > 1).length;
  if (roots.length !== 1 || forkCount < 2 || mergeCount < 2) {
    return;
  }

  const remainingIncoming = new Map(
    data.nodes.map((node) => [node.id, incoming.get(node.id)!.length])
  );
  const rank = new Map(data.nodes.map((node) => [node.id, 0]));
  const ready = [...roots];
  const topological: Node[] = [];
  while (ready.length > 0) {
    ready.sort((left, right) => inputOrder.get(left.id)! - inputOrder.get(right.id)!);
    const node = ready.shift()!;
    topological.push(node);
    for (const edge of outgoing.get(node.id)!) {
      const target = nodes.get(edge.end!)!;
      rank.set(target.id, Math.max(rank.get(target.id)!, rank.get(node.id)! + 1));
      const remaining = remainingIncoming.get(target.id)! - 1;
      remainingIncoming.set(target.id, remaining);
      if (remaining === 0) {
        ready.push(target);
      }
    }
  }
  if (topological.length !== data.nodes.length) {
    return;
  }

  const rankCount = Math.max(...rank.values()) + 1;
  if (rankCount < 5) {
    return;
  }
  const levels = Array.from({ length: rankCount }, () => [] as Node[]);
  for (const node of data.nodes) {
    levels[rank.get(node.id)!].push(node);
  }

  const position = new Map<string, number>();
  for (const level of levels) {
    level.sort((left, right) => {
      const leftBarycentre = predecessorOrderBarycentre(left, incoming, nodes, position);
      const rightBarycentre = predecessorOrderBarycentre(right, incoming, nodes, position);
      return (
        leftBarycentre - rightBarycentre || inputOrder.get(left.id)! - inputOrder.get(right.id)!
      );
    });
    level.forEach((node, index) => position.set(node.id, index));
    packLayeredRow(level);
  }

  for (let iteration = 0; iteration < 6; iteration++) {
    for (let levelIndex = 1; levelIndex < levels.length; levelIndex++) {
      placeLayeredRowNearNeighbours(levels[levelIndex], incoming, nodes, true);
    }
    for (let levelIndex = levels.length - 2; levelIndex >= 0; levelIndex--) {
      placeLayeredRowNearNeighbours(levels[levelIndex], outgoing, nodes, false);
    }
  }

  alignNearLayeredWorkflowColumns(data.edges, incoming, outgoing, rank, levels, nodes);
  alignLayeredWorkflowChains(incoming, outgoing, rank, levels, nodes);

  let y = Math.max(...levels[0].map((node) => node.height!)) / 2;
  for (let levelIndex = 0; levelIndex < levels.length; levelIndex++) {
    const level = levels[levelIndex];
    const levelHeight = Math.max(...level.map((node) => node.height!));
    if (levelIndex > 0) {
      const previous = levels[levelIndex - 1];
      const previousHeight = Math.max(...previous.map((node) => node.height!));
      const labelHeight = data.edges
        .filter((edge) => rank.get(edge.start!)! < levelIndex && rank.get(edge.end!)! >= levelIndex)
        .reduce((height, edge) => Math.max(height, edge.height ?? 0), 0);
      y += previousHeight / 2 + Math.max(LAYERED_DAG_RANK_GAP, labelHeight + 24) + levelHeight / 2;
    }
    for (const node of level) {
      node.y = y;
    }
  }

  const left = Math.min(...data.nodes.map((node) => node.x! - node.width! / 2));
  const right = Math.max(...data.nodes.map((node) => node.x! + node.width! / 2));
  translateNodes(data.nodes, -(left + right) / 2, 0);
  for (const edge of data.edges) {
    edge.startSide = 'bottom';
    edge.endSide = 'top';
    const source = nodes.get(edge.start!)!;
    const target = nodes.get(edge.end!)!;
    edge.metadata = {
      ...edge.metadata,
      stressAndGridLayered: true,
      stressAndGridRankSpan: rank.get(target.id)! - rank.get(source.id)!,
      // A common left-side bypass lets each long branch clear only the boxes
      // in its own column. Its lane is then selected from those blockers,
      // rather than sweeping through unrelated branches on the right.
      stressAndGridBypassSide: 'left',
    };
  }
}

/**
 * Barycentric relaxation deliberately allows small offsets to balance a row.
 * A one-in/one-out chain has no such trade-off: preserving a nearby existing
 * column makes its edge straight and avoids a false grid-misalignment.
 */
function alignNearLayeredWorkflowColumns(
  edges: Edge[],
  incoming: Map<string, Edge[]>,
  outgoing: Map<string, Edge[]>,
  rank: Map<string, number>,
  levels: Node[][],
  nodes: Map<string, Node>
): void {
  for (const edge of edges) {
    if (!edge.start || !edge.end || rank.get(edge.end)! - rank.get(edge.start)! !== 1) {
      continue;
    }
    const source = nodes.get(edge.start)!;
    const target = nodes.get(edge.end)!;
    if (
      incoming.get(target.id)!.length !== 1 ||
      outgoing.get(source.id)!.length !== 1 ||
      Math.abs(source.x! - target.x!) > GRID_ALIGNMENT_EPSILON
    ) {
      continue;
    }

    const previousX = target.x!;
    target.x = source.x;
    if (
      levels[rank.get(target.id)!].some(
        (sibling) => sibling !== target && nodeBoxesOverlap(target, sibling)
      )
    ) {
      target.x = previousX;
    }
  }
}

/**
 * A private linear branch has no reason to drift toward its eventual merge.
 * Keep the whole chain on its first node's column, rather than letting each
 * later rank's barycentre pull it through an unrelated branch. Move atomically
 * and retain the layered row clearance; constrained rows keep their placement.
 */
function alignLayeredWorkflowChains(
  incoming: Map<string, Edge[]>,
  outgoing: Map<string, Edge[]>,
  rank: Map<string, number>,
  levels: Node[][],
  nodes: Map<string, Node>
): void {
  const chains: Node[][] = [];
  for (const first of nodes.values()) {
    const predecessors = incoming.get(first.id)!;
    if (
      outgoing.get(first.id)!.length !== 1 ||
      (predecessors.length === 1 && outgoing.get(predecessors[0].start!)!.length === 1)
    ) {
      continue;
    }
    const chain = [first];
    let cursor = first;
    while (outgoing.get(cursor.id)!.length === 1) {
      const next = nodes.get(outgoing.get(cursor.id)![0].end!)!;
      if (incoming.get(next.id)!.length !== 1) {
        break;
      }
      chain.push(next);
      cursor = next;
    }
    if (chain.length > 1) {
      chains.push(chain);
    }
  }
  // One chain can free the destination column of another. Each successful
  // move fixes one disjoint chain, so this reaches a fixed point in at most
  // `chains.length` passes, without moving any already aligned chain again.
  let remainingPasses = chains.length;
  while (remainingPasses > 0) {
    remainingPasses--;
    let changed = false;
    for (const chain of chains) {
      const members = new Set(chain);
      const column = chain[0].x!;
      if (chain.every((node) => node.x === column)) {
        continue;
      }
      if (
        chain.some((node) =>
          levels[rank.get(node.id)!].some(
            (sibling) =>
              !members.has(sibling) &&
              Math.abs(column - sibling.x!) <
                (node.width! + sibling.width!) / 2 + LAYERED_DAG_COLUMN_GAP - 1e-6
          )
        )
      ) {
        continue;
      }
      for (const node of chain) {
        node.x = column;
      }
      changed = true;
    }
    if (!changed) {
      break;
    }
  }
}

function predecessorOrderBarycentre(
  node: Node,
  incoming: Map<string, Edge[]>,
  nodes: Map<string, Node>,
  position: Map<string, number>
): number {
  const predecessors = incoming
    .get(node.id)!
    .map((edge) => nodes.get(edge.start!)!)
    .map((predecessor) => position.get(predecessor.id))
    .filter((value): value is number => value !== undefined);
  return predecessors.length > 0
    ? predecessors.reduce((sum, value) => sum + value, 0) / predecessors.length
    : 0;
}

function packLayeredRow(level: Node[]): void {
  let cursor = 0;
  for (const node of level) {
    node.x = cursor + node.width! / 2;
    cursor += node.width! + LAYERED_DAG_COLUMN_GAP;
  }
  const center = (level[0].x! - level[0].width! / 2 + cursor - LAYERED_DAG_COLUMN_GAP) / 2;
  for (const node of level) {
    node.x! -= center;
  }
}

function placeLayeredRowNearNeighbours(
  level: Node[],
  incident: Map<string, Edge[]>,
  nodes: Map<string, Node>,
  useSources: boolean
): void {
  const offsets = [0];
  for (let index = 1; index < level.length; index++) {
    offsets.push(
      offsets[index - 1] +
        level[index - 1].width! / 2 +
        LAYERED_DAG_COLUMN_GAP +
        level[index].width! / 2
    );
  }
  const desired = level.map((node, index) => {
    const neighbours = incident
      .get(node.id)!
      .map((edge) => nodes.get((useSources ? edge.start : edge.end)!)!)
      .filter((neighbour) => Number.isFinite(neighbour.x));
    const desiredX =
      neighbours.length > 0
        ? neighbours.reduce((sum, neighbour) => sum + neighbour.x!, 0) / neighbours.length
        : node.x!;
    return desiredX - offsets[index];
  });
  const projected = monotonicMeans(desired);
  for (const [index, node] of level.entries()) {
    node.x = projected[index] + offsets[index];
  }
}

/** Pool-adjacent-violators projection for ordered, non-overlapping rows. */
function monotonicMeans(values: number[]): number[] {
  const blocks: { start: number; end: number; sum: number; count: number }[] = [];
  for (const [index, value] of values.entries()) {
    blocks.push({ start: index, end: index, sum: value, count: 1 });
    while (blocks.length > 1) {
      const current = blocks.at(-1)!;
      const previous = blocks.at(-2)!;
      if (previous.sum / previous.count <= current.sum / current.count) {
        break;
      }
      blocks.splice(-2, 2, {
        start: previous.start,
        end: current.end,
        sum: previous.sum + current.sum,
        count: previous.count + current.count,
      });
    }
  }
  const result = Array(values.length).fill(0) as number[];
  for (const block of blocks) {
    const mean = block.sum / block.count;
    for (let index = block.start; index <= block.end; index++) {
      result[index] = mean;
    }
  }
  return result;
}

/**
 * A labelled diagonal branch needs a real corridor, not a label parked beside
 * its route. When an unlabelled child already occupies the source's lower
 * column, place the labelled lower-right child on the next row so its label
 * can remain centered on a vertical run between the two leaves.
 */
function reserveLabelledFanRows(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const outgoingCount = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.start && edge.end) {
      outgoingCount.set(edge.start, (outgoingCount.get(edge.start) ?? 0) + 1);
    }
  }
  arrangeDenseFanIngress(data, nodes, outgoingCount);
  for (const edge of data.edges) {
    const label = (edge.label ?? edge.text ?? '').trim();
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !label ||
      !source ||
      !target ||
      source.isGroup === true ||
      target.isGroup === true ||
      (outgoingCount.get(source.id) ?? 0) < 4 ||
      target.x! <= source.x! ||
      target.y! < source.y!
    ) {
      continue;
    }
    const lowerSibling = data.edges
      .filter((candidate) => candidate.start === source.id && candidate.end !== target.id)
      .map((candidate) => (candidate.end ? nodes.get(candidate.end) : undefined))
      .find(
        (candidate): candidate is Node =>
          candidate !== undefined &&
          !(candidate.parentId ?? '') &&
          !(candidate.isGroup === true) &&
          Math.abs(candidate.x! - source.x!) <= 1e-6 &&
          candidate.y! >= source.y!
      );
    if (!lowerSibling) {
      continue;
    }
    const targetY =
      lowerSibling.y! + (lowerSibling.height! + target.height!) / 2 + LABELLED_FAN_ROW_GAP;
    if (target.y! >= targetY) {
      continue;
    }
    const previousY = target.y!;
    target.y = targetY;
    if (overlapsAnyLeaf(target, data.nodes)) {
      target.y = previousY;
    }
  }
}

/**
 * A dense fan can leave an incoming leaf stranded in the same row as the
 * hub's left-hand output.  Swapping those two rows makes the inbound edge a
 * direct horizontal connection and keeps the left/right fan symmetric.  Do
 * the moves atomically: checking either move on its own would see the other
 * leaf in its old position and incorrectly reject this valid exchange.
 */
function arrangeDenseFanIngress(
  data: LayoutData,
  nodes: Map<string, Node>,
  outgoingCount: Map<string, number>
): void {
  const isDirectLeaf = (node: Node | undefined): node is Node =>
    node !== undefined && node.isGroup !== true && !(node.parentId ?? '');

  for (const hub of data.nodes) {
    if (hub.isGroup === true || !isDirectLeaf(hub) || (outgoingCount.get(hub.id) ?? 0) < 4) {
      continue;
    }

    const outputs = data.edges
      .filter((edge) => edge.start === hub.id)
      .map((edge) => (edge.end ? nodes.get(edge.end) : undefined))
      .filter(isDirectLeaf);
    const leftOutput = outputs.find(
      (node) => node.x! < hub.x! && Math.abs(node.y! - hub.y!) <= 1e-6
    );
    const upperRightOutput = outputs
      .filter((node) => node.x! > hub.x! && node.y! < hub.y!)
      .sort((left, right) => left.y! - right.y!)[0];
    const upperLeftInput = data.edges
      .filter((edge) => edge.end === hub.id)
      .map((edge) => (edge.start ? nodes.get(edge.start) : undefined))
      .filter(isDirectLeaf)
      .find((node) => node.x! < hub.x! && node.y! < hub.y!);

    if (!leftOutput || !upperRightOutput || !upperLeftInput) {
      continue;
    }

    const previousLeftOutputY = leftOutput.y!;
    const previousUpperLeftInputY = upperLeftInput.y!;
    leftOutput.y = upperRightOutput.y;
    upperLeftInput.y = hub.y;
    if (overlapsAnyLeaf(leftOutput, data.nodes) || overlapsAnyLeaf(upperLeftInput, data.nodes)) {
      leftOutput.y = previousLeftOutputY;
      upperLeftInput.y = previousUpperLeftInputY;
    }
  }
}

function alignSymmetricDecisionBranches(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Node[]>();
  for (const edge of data.edges) {
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (edge.start && target) {
      const targets = outgoing.get(edge.start) ?? [];
      targets.push(target);
      outgoing.set(edge.start, targets);
    }
  }

  for (const decision of data.nodes) {
    if (!/diamond|rhombus/.test(String(decision.shape))) {
      continue;
    }
    const branches = outgoing.get(decision.id) ?? [];
    if (branches.length !== 2) {
      continue;
    }
    const branchesJoin = branchesReconverge(branches, outgoing);
    // A normal split should preserve the solver's closest branch row, leaving
    // space for the merge below it. A feedback branch can instead be pulled
    // above its decision, so its lower child defines the branch row.
    const reference = branchesJoin
      ? [...branches].sort(
          (left, right) =>
            Math.abs(left.x! - decision.x!) +
            Math.abs(left.y! - decision.y!) -
            (Math.abs(right.x! - decision.x!) + Math.abs(right.y! - decision.y!))
        )[0]
      : [...branches].sort((left, right) => right.y! - left.y!)[0];
    for (const branch of branches) {
      if (branch === reference || Math.abs(branch.y! - reference.y!) <= 1e-6) {
        continue;
      }
      const previousY = branch.y!;
      branch.y = reference.y;
      if (
        data.nodes.some(
          (other) => other !== branch && other.isGroup !== true && nodeBoxesOverlap(branch, other)
        )
      ) {
        branch.y = previousY;
      }
    }
    centerSymmetricBranches(decision, branches, data.nodes);
  }
}

function branchesReconverge(branches: Node[], outgoing: Map<string, Node[]>): boolean {
  const [first, second] = branches;
  const firstTargets = outgoing.get(first.id) ?? [];
  const secondTargetIds = new Set((outgoing.get(second.id) ?? []).map((node) => node.id));
  return firstTargets.some((node) => secondTargetIds.has(node.id));
}

function centerSymmetricBranches(decision: Node, branches: Node[], nodes: Node[]): void {
  const [left, right] = [...branches].sort(
    (first, second) => first.x! - second.x! || first.id.localeCompare(second.id)
  );
  // Retain the solver's chosen separation when it is already generous, while
  // guaranteeing that the two branch boxes have a readable corridor between
  // them. Their midpoint is the decision's center, not one branch's column.
  const halfGap = Math.max(Math.abs(right.x! - left.x!) / 2, (left.width! + right.width!) / 4 + 20);
  const previous = [left.x!, right.x!];
  left.x = decision.x! - halfGap;
  right.x = decision.x! + halfGap;

  const branchGroupIds = new Set(
    [left.parentId, right.parentId].filter((parentId): parentId is string => parentId !== undefined)
  );
  const surroundingNodes = nodes.filter(
    (node) =>
      node !== left &&
      node !== right &&
      node.isGroup !== true &&
      !branchGroupIds.has(node.parentId ?? '')
  );
  if (
    surroundingNodes.some((node) => nodeBoxesOverlap(left, node) || nodeBoxesOverlap(right, node))
  ) {
    [left.x, right.x] = previous;
  }
}

function nodeBoxesOverlap(left: Node, right: Node): boolean {
  return (
    left.x! - left.width! / 2 < right.x! + right.width! / 2 &&
    left.x! + left.width! / 2 > right.x! - right.width! / 2 &&
    left.y! - left.height! / 2 < right.y! + right.height! / 2 &&
    left.y! + left.height! / 2 > right.y! - right.height! / 2
  );
}

/**
 * Balance a decision's two free terminal branches after group-exit placement.
 * Processing those exits separately aligns the first with the decision and
 * pushes the second into an arbitrary collision-free row. Move the leaves as
 * one fan instead, preserving their order and centring them on the decision.
 * Framed, connected, labelled, or obstructed targets retain their layout.
 */
function alignSymmetricTerminalDecisionBranches(data: LayoutData): void {
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  const along = horizontal ? 'x' : 'y';
  const across = horizontal ? 'y' : 'x';
  const alongSize = horizontal ? 'width' : 'height';
  const acrossSize = horizontal ? 'height' : 'width';
  const sign = data.direction === 'RL' || data.direction === 'BT' ? -1 : 1;
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));

  for (const decision of data.nodes) {
    if (!/^(diamond|rhombus|diam|question|decision)$/.test(String(decision.shape))) {
      continue;
    }
    const outgoing = data.edges.filter((edge) => edge.start === decision.id);
    if (
      outgoing.length !== 2 ||
      outgoing.some(
        (edge) => edge.startSide || edge.endSide || (edge.label ?? edge.text ?? '').trim()
      )
    ) {
      continue;
    }
    const branches = outgoing.map((edge) => nodes.get(edge.end ?? ''));
    if (
      branches.some(
        (node) =>
          !node ||
          node.isGroup === true ||
          node.parentId !== undefined ||
          !/^(rect|squareRect)$/.test(String(node.shape)) ||
          data.edges.filter((edge) => edge.start === node.id || edge.end === node.id).length !== 1
      )
    ) {
      continue;
    }
    const [first, second] = (branches as Node[]).sort(
      (left, right) => left[across]! - right[across]! || left.id.localeCompare(right.id)
    );
    // Root-level targets must stay outside every frame containing the source.
    const boundary = outermostAncestorGroup(decision, nodes) ?? decision;
    const facingBorder =
      sign *
      Math.max(
        sign * first[along]! - first[alongSize]! / 2,
        sign * second[along]! - second[alongSize]! / 2,
        sign * boundary[along]! + boundary[alongSize]! / 2 + GROUP_FRAME_PADDING
      );
    const halfGap = Math.max(
      Math.abs(second[across]! - first[across]!) / 2,
      (first[acrossSize]! + second[acrossSize]!) / 4 + 20,
      decision[acrossSize]! / 4 + 20
    );
    const previous = [first.x!, first.y!, second.x!, second.y!];
    first[along] = facingBorder + (sign * first[alongSize]!) / 2;
    second[along] = facingBorder + (sign * second[alongSize]!) / 2;
    first[across] = decision[across]! - halfGap;
    second[across] = decision[across]! + halfGap;

    const obstacles = data.nodes.filter((node) => node !== first && node !== second);
    if (
      obstacles.some(
        (node) =>
          nodeBoxesNeedClearance(first, node, 30) || nodeBoxesNeedClearance(second, node, 30)
      )
    ) {
      [first.x, first.y, second.x, second.y] = previous;
      continue;
    }
  }
}

/**
 * Match the validator's leaf-to-leaf readability rule before accepting a
 * post-layout translation.  An exit may avoid a literal overlap while still
 * landing in the next node's row with only a few pixels between their boxes.
 * Those are exactly the cases that later become `node-node-padding` issues.
 */
function nodeBoxesNeedClearance(left: Node, right: Node, clearance: number): boolean {
  const leftEdge = left.x! - left.width! / 2;
  const rightEdge = left.x! + left.width! / 2;
  const topEdge = left.y! - left.height! / 2;
  const bottomEdge = left.y! + left.height! / 2;
  const otherLeft = right.x! - right.width! / 2;
  const otherRight = right.x! + right.width! / 2;
  const otherTop = right.y! - right.height! / 2;
  const otherBottom = right.y! + right.height! / 2;
  const xOverlap = leftEdge < otherRight && otherLeft < rightEdge;
  const yOverlap = topEdge < otherBottom && otherTop < bottomEdge;

  if (xOverlap && yOverlap) {
    return true;
  }
  if (xOverlap) {
    return Math.max(topEdge, otherTop) - Math.min(bottomEdge, otherBottom) < clearance;
  }
  if (yOverlap) {
    return Math.max(leftEdge, otherLeft) - Math.min(rightEdge, otherRight) < clearance;
  }
  return false;
}

function alignNearAxisGroupEdges(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const preferredAxis = new Map<string, 'horizontal' | 'vertical'>();
  const flowDirectionByGroup = new Map<string, number>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target) {
      continue;
    }
    if (target.parentId && source.parentId !== target.parentId) {
      flowDirectionByGroup.set(target.parentId, Math.sign(target.x! - source.x!) || 1);
    }
    if (source.parentId && source.parentId === target.parentId) {
      preferredAxis.set(
        edge.id,
        Math.abs(target.x! - source.x!) > Math.abs(target.y! - source.y!)
          ? 'horizontal'
          : 'vertical'
      );
    }
  }

  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !source ||
      !target ||
      !source.parentId ||
      source.parentId !== target.parentId ||
      /diamond|rhombus/.test(String(source.shape))
    ) {
      continue;
    }
    if (preferredAxis.get(edge.id) === 'horizontal') {
      alignHorizontalGroupEdge(
        source,
        target,
        flowDirectionByGroup.get(source.parentId) ?? (Math.sign(target.x! - source.x!) || 1),
        data.nodes
      );
    } else if (preferredAxis.get(edge.id) === 'vertical') {
      moveWithoutOverlappingLeaves(target, 'x', source.x!, data.nodes);
    }
  }
}

function alignHorizontalGroupEdge(
  source: Node,
  target: Node,
  direction: number,
  nodes: Node[]
): void {
  const previous = { x: target.x!, y: target.y! };
  target.y = source.y;
  // Keep a readable inter-node corridor, then route the whole group in the
  // direction in which it was entered from its parent flow.
  target.x = source.x! + direction * ((source.width! + target.width!) / 2 + 36);
  if (!overlapsAnyLeaf(target, nodes)) {
    return;
  }
  target.x = previous.x;
  target.y = previous.y;
}

function moveWithoutOverlappingLeaves(
  node: Node,
  axis: 'x' | 'y',
  value: number,
  nodes: Node[]
): void {
  const previous = node[axis]!;
  node[axis] = value;
  if (overlapsAnyLeaf(node, nodes)) {
    node[axis] = previous;
  }
}

function overlapsAnyLeaf(node: Node, nodes: Node[]): boolean {
  return nodes.some(
    (other) => other !== node && other.isGroup !== true && nodeBoxesOverlap(node, other)
  );
}

/**
 * Frames intentionally retain their title/label clearance, but that should
 * not leave unused grid lanes in the unframed spine above them. Compact only
 * a direct, vertically aligned outer edge and translate every lower leaf as
 * one block. A symmetric decision entering the top row of a frame can also
 * shed unused solver space, while retaining title and branch-label clearance.
 */
function compactOuterVerticalLanes(data: LayoutData, decisionEntriesOnly = false): void {
  if (!data.nodes.some((node) => node.isGroup === true)) {
    return;
  }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const lanes = data.edges
    .map((edge) => ({
      source: edge.start ? nodes.get(edge.start) : undefined,
      target: edge.end ? nodes.get(edge.end) : undefined,
    }))
    .map((lane) => ({
      ...lane,
      entryGap: decisionEntriesOnly
        ? decisionGroupEntryGap(lane.source, lane.target, data, nodes)
        : undefined,
    }))
    .filter(
      (lane): lane is { source: Node; target: Node; entryGap: number | undefined } =>
        !!lane.source &&
        !!lane.target &&
        !lane.source.parentId &&
        (decisionEntriesOnly
          ? lane.entryGap !== undefined
          : !lane.target.parentId && Math.abs(lane.source.x! - lane.target.x!) <= 8) &&
        lane.target.y! > lane.source.y!
    )
    .sort((left, right) => left.source.y! - right.source.y!);

  for (const { source, target, entryGap } of lanes) {
    const gap = target.y! - target.height! / 2 - (source.y! + source.height! / 2);
    const shift = (entryGap ?? GROUP_ROW_GAP) - gap;
    if (shift >= 0) {
      continue;
    }
    const moved = data.nodes.filter((node) => node.isGroup !== true && node.y! >= target.y! - 1e-6);
    if (entryGap !== undefined) {
      // Frame entries are compacted after fitting. Keep complete frames rigid;
      // cutting through an unrelated frame would disturb its internal rows.
      const frames = data.nodes.filter((node) => node.isGroup === true);
      const members = frames.map((frame) =>
        data.nodes.filter((node) => node.isGroup !== true && isDescendantOf(node, frame.id, nodes))
      );
      if (
        members.some(
          (children) =>
            children.some((node) => moved.includes(node)) &&
            !children.every((node) => moved.includes(node))
        )
      ) {
        continue;
      }
      moved.push(
        ...frames.filter(
          (_, index) =>
            members[index].length > 0 && members[index].every((node) => moved.includes(node))
        )
      );
    }
    for (const node of moved) {
      node.y! += shift;
    }
    if (
      moved.some((node) =>
        data.nodes
          .filter((other) => !moved.includes(other))
          .some((other) =>
            entryGap !== undefined
              ? nodeBoxesNeedClearance(node, other, 30)
              : other.isGroup !== true && nodeBoxesOverlap(node, other)
          )
      )
    ) {
      for (const node of moved) {
        node.y! -= shift;
      }
    }
  }
}

/** Compact a split entering a flat frame's first row, preserving upper feedback branches. */
function decisionGroupEntryGap(
  source: Node | undefined,
  target: Node | undefined,
  data: LayoutData,
  nodes: Map<string, Node>
): number | undefined {
  if (
    !source ||
    !target ||
    source.isGroup ||
    source.parentId ||
    !/^(diamond|rhombus|diam|question|decision)$/.test(String(source.shape)) ||
    !target.parentId
  ) {
    return undefined;
  }
  const group = nodes.get(target.parentId);
  const branches = data.edges.filter((edge) => edge.start === source.id);
  const children = data.nodes.filter((node) => node.parentId === group?.id);
  const targets = branches.map((edge) => nodes.get(edge.end ?? ''));
  if (
    !group?.isGroup ||
    group.parentId ||
    branches.length !== 2 ||
    branches.some(
      (edge) => Boolean(edge.startSide) || Boolean(edge.endSide) || (edge.minlen ?? 1) > 1
    ) ||
    targets.some((node) => !node || node.isGroup || node.y! > target.y! + 1e-6) ||
    targets.some((node) => node?.parentId && node.parentId !== group.id) ||
    children.some((node) => node.isGroup || node.y! < target.y! - 1e-6)
  ) {
    return undefined;
  }
  const entryInset =
    target.y! -
    target.height! / 2 -
    Math.min(...children.map((node) => node.y! - node.height! / 2)) +
    GROUP_FRAME_PADDING +
    (group.labelBBox?.height ?? 0);
  return (
    Math.max(
      GROUP_ROW_GAP,
      entryInset + GROUP_FRAME_PADDING,
      // The label is centered on the vertical run from the diamond's slope
      // midpoint, and must finish above the frame's padded title strip.
      2 * (entryInset + GROUP_EXIT_LABEL_CLEARANCE) +
        Math.max(...branches.map((edge) => edge.height ?? 24)) -
        source.height! / 4,
      ...branches.map((edge) => (edge.height ?? 0) + 2 * GROUP_EXIT_LABEL_CLEARANCE)
    ) +
    (Math.max(...targets.map((node) => node!.height!)) - target.height!) / 2
  );
}

/** Preserve split symmetry when an outside branch nearly touches the fitted frame. */
function separateDecisionEntryFrame(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    const source = nodes.get(edge.start ?? '');
    const target = nodes.get(edge.end ?? '');
    if (decisionGroupEntryGap(source, target, data, nodes) === undefined) {
      continue;
    }
    const frame = nodes.get(target!.parentId!)!;
    const siblingEdge = data.edges.find(
      (candidate) => candidate.start === source!.id && candidate !== edge
    )!;
    const sibling = nodes.get(siblingEdge.end ?? '')!;
    if (
      sibling.parentId ||
      sibling.y! < frame.y! - frame.height! / 2 ||
      sibling.y! > frame.y! + frame.height! / 2
    ) {
      continue;
    }
    const sign = Math.sign(sibling.x! - target!.x!);
    const gap = sign * (sibling.x! - frame.x!) - (sibling.width! + frame.width!) / 2;
    const shift = (30 + 1e-6 - gap) / 2;
    if (shift <= 0 || !sign) {
      continue;
    }
    const members = data.nodes.filter(
      (node) => node === frame || isDescendantOf(node, frame.id, nodes)
    );
    translateNodes(members, -sign * shift, 0);
    sibling.x! += sign * shift;
    const stationary = data.nodes.filter((node) => node !== sibling && !members.includes(node));
    if (
      [frame, sibling].some((node) =>
        stationary.some((other) => nodeBoxesNeedClearance(node, other, 30))
      )
    ) {
      translateNodes(members, sign * shift, 0);
      sibling.x! -= sign * shift;
    }
  }
}

/**
 * Remove solver-sized empty lanes below the entry row of a subgraph. The entry
 * row deliberately stays fixed: it may be aligned with a branch outside the
 * frame. Subsequent visual rows move together, so straight internal edges and
 * symmetric decision branches remain straight and symmetric.
 */
function compactGroupedRows(data: LayoutData): void {
  for (const group of data.nodes.filter((node) => node.isGroup === true)) {
    const children = data.nodes.filter(
      (node) => node.parentId === group.id && node.isGroup !== true
    );
    const rows = groupedRows(children);
    const gap = isPrivateStraightGroupChain(group, rows, data)
      ? GROUP_CHAIN_NODE_GAP
      : GROUP_ROW_GAP;

    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1];
      const current = rows[index];
      const shift = compactRowShift(previous.nodes, current.nodes, gap);
      if (shift >= 0) {
        continue;
      }

      const moved = rows.slice(index).flatMap((row) => row.nodes);
      for (const node of moved) {
        node.y! += shift;
      }
      if (
        moved.some((node) =>
          overlapsAnyLeaf(
            node,
            data.nodes.filter((other) => !moved.includes(other))
          )
        )
      ) {
        for (const node of moved) {
          node.y! -= shift;
        }
        continue;
      }
      for (const row of rows.slice(index)) {
        row.top += shift;
        row.bottom += shift;
      }
    }
  }
}

/**
 * A private, unlabelled chain needs no routing lane between its rows. Frame
 * connections do not constrain the members, but member connections, labels,
 * forks and nested frames can, so retain the wider clearance for those cases.
 */
function isPrivateStraightGroupChain(
  group: Node,
  rows: ReturnType<typeof groupedRows>,
  data: LayoutData
): boolean {
  if (
    rows.length < 2 ||
    rows.some((row) => row.nodes.length !== 1) ||
    data.nodes.some((node) => node.parentId === group.id && node.isGroup === true)
  ) {
    return false;
  }
  const members = rows.map((row) => row.nodes[0]);
  if (
    members.some(
      (node) =>
        !['rect', 'squareRect'].includes(node.shape ?? '') ||
        node.isEdgeLabel === true ||
        node.isLabelNode === true ||
        node.isDummy === true ||
        Math.abs(node.x! - members[0].x!) > 1e-6
    )
  ) {
    return false;
  }
  const ids = new Set(members.map((node) => node.id));
  const incident = data.edges.filter(
    (edge) => ids.has(edge.start ?? '') || ids.has(edge.end ?? '')
  );
  return (
    incident.length === members.length - 1 &&
    incident.every(
      (edge) =>
        ids.has(edge.start ?? '') &&
        ids.has(edge.end ?? '') &&
        !(edge.label ?? edge.text ?? '').trim() &&
        !edge.startSide &&
        !edge.endSide &&
        (edge.minlen ?? 1) <= 1
    ) &&
    members
      .slice(1)
      .every((node, index) =>
        incident.some(
          (edge) =>
            (edge.start === members[index].id && edge.end === node.id) ||
            (edge.end === members[index].id && edge.start === node.id)
        )
      )
  );
}

/**
 * Two forks sharing two terminal leaves form a planar fan, not a crossed
 * quadrilateral. Keep the common source between its leaves and the second
 * fork beside that column. Only private, flat frames are eligible: externally
 * constrained members and explicit port assignments keep their placement.
 */
function alignPrivateShortcutFans(data: LayoutData): void {
  for (const group of data.nodes.filter((node) => node.isGroup === true)) {
    const children = data.nodes.filter((node) => node.parentId === group.id);
    if (
      children.length !== 4 ||
      children.some(
        (node) =>
          node.isGroup === true ||
          !['rect', 'squareRect'].includes(node.shape ?? '') ||
          node.isEdgeLabel === true ||
          node.isLabelNode === true ||
          node.isDummy === true
      )
    ) {
      continue;
    }
    const ids = new Set(children.map((node) => node.id));
    const incident = data.edges.filter(
      (edge) => ids.has(edge.start ?? '') || ids.has(edge.end ?? '')
    );
    if (
      incident.some(
        (edge) =>
          !ids.has(edge.start ?? '') ||
          !ids.has(edge.end ?? '') ||
          edge.startSide !== undefined ||
          edge.endSide !== undefined ||
          (edge.minlen ?? 1) > 1 ||
          edge.isLayoutOnly === true ||
          edge.arrowTypeEnd === 'none'
      )
    ) {
      continue;
    }
    const links = incident.filter((edge) => edge.start !== edge.end);
    const source = children.find(
      (node) =>
        links.filter((edge) => edge.start === node.id).length === 3 &&
        links.every((edge) => edge.end !== node.id)
    );
    const fork = children.find(
      (node) => links.filter((edge) => edge.start === node.id).length === 2
    );
    if (
      !source ||
      !fork ||
      links.length !== 5 ||
      !links.some((edge) => edge.start === source.id && edge.end === fork.id)
    ) {
      continue;
    }
    const leaves = children.filter((node) => node !== source && node !== fork);
    if (
      !leaves.every(
        (leaf) =>
          links.some((edge) => edge.start === source.id && edge.end === leaf.id) &&
          links.some((edge) => edge.start === fork.id && edge.end === leaf.id)
      ) ||
      incident.some(
        (edge) =>
          edge.start === edge.end &&
          (edge.start !== source.id || (edge.label ?? edge.text ?? '').trim())
      ) ||
      incident.filter((edge) => edge.start === edge.end).length > 1
    ) {
      continue;
    }
    const labels = links.filter((edge) => (edge.label ?? edge.text ?? '').trim());
    if (labels.length === 0 || labels.some((edge) => edge.start !== fork.id)) {
      continue;
    }
    const horizontal = data.direction !== 'TB' && data.direction !== 'BT';
    const primarySize = (node: Node) => (horizontal ? node.width! : node.height!);
    const secondarySize = (node: Node) => (horizontal ? node.height! : node.width!);
    const labelWidths = labels.map((edge) => {
      const lines = (edge.label ?? edge.text ?? '')
        .replace(/<br\s*\/?\s*>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .split('\n');
      return Math.max(40, edge.width ?? 0, ...lines.map((line) => line.trim().length * 8));
    });
    const labelSpan = horizontal
      ? Math.max(...labelWidths)
      : Math.max(24, ...labels.map((edge) => edge.height ?? 0));
    // Wide text makes a rotated fan use lateral ports too. Its leaf columns
    // therefore need the same label-sized channel as the horizontal version.
    const secondaryGap = horizontal
      ? GROUP_CHAIN_NODE_GAP
      : Math.max(
          WORKFLOW_COLUMN_GAP,
          Math.max(...labelWidths) + 2 * ISOLATED_LABEL_CLEARANCE + SHORTCUT_FAN_STUB_CLEARANCE
        );
    const rowDistance =
      primarySize(fork) / 2 +
      Math.max(...[source, ...leaves].map(primarySize)) / 2 +
      Math.max(
        WORKFLOW_COLUMN_GAP,
        labelSpan + 2 * ISOLATED_LABEL_CLEARANCE + SHORTCUT_FAN_STUB_CLEARANCE
      );
    // In a vertical fan, keep the label's main run away from the straight
    // source-to-leaf row. Otherwise a longer final horizontal approach can
    // become the dominant segment and put the text on that sibling edge.
    const distance = horizontal
      ? rowDistance
      : Math.max(
          rowDistance,
          secondaryGap + Math.max(...children.map(primarySize)) / 2 + 2 * ISOLATED_LABEL_CLEARANCE
        );
    const sign = data.direction === 'RL' || data.direction === 'BT' ? -1 : 1;
    const original = children.map((node) => ({ node, x: node.x!, y: node.y! }));
    const place = (node: Node, primary: number, secondary: number) => {
      node.x = group.x! + (horizontal ? primary : secondary);
      node.y = group.y! + (horizontal ? secondary : primary);
    };
    place(source, (-sign * distance) / 2, 0);
    place(fork, (sign * distance) / 2, 0);
    leaves.forEach((leaf, index) =>
      place(
        leaf,
        (-sign * distance) / 2,
        (index === 0 ? -1 : 1) *
          (secondarySize(source) / 2 + secondarySize(leaf) / 2 + secondaryGap)
      )
    );
    if (
      children.some((node) =>
        overlapsAnyLeaf(
          node,
          data.nodes.filter((other) => !ids.has(other.id))
        )
      )
    ) {
      for (const entry of original) {
        entry.node.x = entry.x;
        entry.node.y = entry.y;
      }
    }
  }
}

function compactRowShift(previous: Node[], current: Node[], gap: number): number {
  const requiredShifts = current.flatMap((node) =>
    previous
      .filter((candidate) => horizontalBoxesOverlap(candidate, node))
      .map((candidate) => candidate.y! + candidate.height! / 2 + gap - (node.y! - node.height! / 2))
  );

  // Rows whose columns do not overlap may share vertical space. This keeps a
  // staircase-like group tight without allowing boxes in the same lane to
  // encroach on one another.
  return requiredShifts.length === 0 ? 0 : Math.max(...requiredShifts);
}

function horizontalBoxesOverlap(left: Node, right: Node): boolean {
  return (
    left.x! - left.width! / 2 < right.x! + right.width! / 2 &&
    left.x! + left.width! / 2 > right.x! - right.width! / 2
  );
}

function groupedRows(nodes: Node[]): { nodes: Node[]; top: number; bottom: number }[] {
  const tolerance = Math.max(1, Math.max(...nodes.map((node) => node.height ?? 0)) / 2);
  const rows: { nodes: Node[]; top: number; bottom: number; center: number }[] = [];
  for (const node of [...nodes].sort((left, right) => left.y! - right.y!)) {
    const row = rows.at(-1);
    if (!row || node.y! - row.center > tolerance) {
      rows.push({
        nodes: [node],
        top: node.y! - node.height! / 2,
        bottom: node.y! + node.height! / 2,
        center: node.y!,
      });
      continue;
    }
    row.nodes.push(node);
    row.center = row.nodes.reduce((sum, member) => sum + member.y!, 0) / row.nodes.length;
    row.top = Math.min(row.top, node.y! - node.height! / 2);
    row.bottom = Math.max(row.bottom, node.y! + node.height! / 2);
  }
  return rows;
}

interface FramedFiveNodeCycle {
  group: Node;
  members: Node[];
  anchor: Node;
  aroundAnchor: [Node, Node, Node, Node];
  bridge: Edge;
}

/**
 * A five-node cycle is most legible as a compact two-row ring. The global
 * stress solve intentionally leaves cycles free to rotate, which can put a
 * bridge node in the middle of a frame and force two perimeter edges through
 * long detours. When exactly one cycle member links outside its frame, retain
 * that member as the centred entry/exit and arrange the other four around it.
 */
function compactFramedFiveNodeCycles(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const cycles = data.nodes
    .filter((node) => node.isGroup === true)
    .map((group) => framedFiveNodeCycle(group, data.edges, nodes))
    .filter((cycle): cycle is FramedFiveNodeCycle => cycle !== undefined);

  for (const cycle of cycles) {
    placeFramedFiveNodeCycle(cycle);
  }

  const cycleByAnchor = new Map(cycles.map((cycle) => [cycle.anchor.id, cycle]));
  for (const cycle of cycles) {
    const sourceCycle = cycle.bridge.start ? cycleByAnchor.get(cycle.bridge.start) : undefined;
    const targetCycle = cycle.bridge.end ? cycleByAnchor.get(cycle.bridge.end) : undefined;
    if (!sourceCycle || !targetCycle || sourceCycle === targetCycle) {
      continue;
    }
    translateNodes(targetCycle.members, sourceCycle.anchor.x! - targetCycle.anchor.x!, 0);
    separateFramedCycles(sourceCycle, targetCycle);
  }
}

function separateFramedCycles(source: FramedFiveNodeCycle, target: FramedFiveNodeCycle): void {
  const sourceContentBottom = Math.max(
    ...source.members.map((member) => member.y! + member.height! / 2)
  );
  const targetContentTop = Math.min(
    ...target.members.map((member) => member.y! - member.height! / 2)
  );
  // `fitStressAndGridGroups` puts a title above a group's child bounds, while
  // the bottom has only frame padding. Account for both so the requested
  // corridor is the visible frame-to-frame distance, not merely leaf space.
  const sourceFrameBottom = sourceContentBottom + GROUP_FRAME_PADDING;
  const targetFrameTop =
    targetContentTop - GROUP_FRAME_PADDING - (target.group.labelBBox?.height ?? 0);
  const shift = sourceFrameBottom + FRAMED_CYCLE_BRIDGE_GAP - targetFrameTop;
  if (shift > 0) {
    translateNodes(target.members, 0, shift);
  }
}

function framedFiveNodeCycle(
  group: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): FramedFiveNodeCycle | undefined {
  const members = [...nodes.values()].filter(
    (node) => node.isGroup !== true && node.parentId === group.id
  );
  if (members.length !== 5) {
    return undefined;
  }

  const memberIds = new Set(members.map((member) => member.id));
  const internalEdges = edges.filter(
    (edge) =>
      edge.start !== undefined &&
      edge.end !== undefined &&
      memberIds.has(edge.start) &&
      memberIds.has(edge.end)
  );
  if (internalEdges.length !== members.length) {
    return undefined;
  }

  const neighbours = new Map(members.map((member) => [member.id, new Set<string>()]));
  for (const edge of internalEdges) {
    neighbours.get(edge.start!)!.add(edge.end!);
    neighbours.get(edge.end!)!.add(edge.start!);
  }
  if ([...neighbours.values()].some((neighboursForNode) => neighboursForNode.size !== 2)) {
    return undefined;
  }

  const bridges = edges.filter(
    (edge) =>
      edge.start !== undefined &&
      edge.end !== undefined &&
      memberIds.has(edge.start) !== memberIds.has(edge.end)
  );
  if (bridges.length !== 1) {
    return undefined;
  }

  const bridge = bridges[0];
  const anchor = nodes.get(memberIds.has(bridge.start!) ? bridge.start! : bridge.end!);
  if (!anchor) {
    return undefined;
  }
  const [firstNeighbour, secondNeighbour] = [...neighbours.get(anchor.id)!]
    .map((id) => nodes.get(id)!)
    .sort((left, right) => left.x! - right.x! || left.id.localeCompare(right.id));
  const aroundAnchor = traceCycleSide(
    anchor.id,
    firstNeighbour.id,
    secondNeighbour.id,
    neighbours,
    nodes
  );
  if (!aroundAnchor) {
    return undefined;
  }

  return { group, members, anchor, aroundAnchor, bridge };
}

function traceCycleSide(
  anchorId: string,
  firstId: string,
  lastId: string,
  neighbours: Map<string, Set<string>>,
  nodes: Map<string, Node>
): [Node, Node, Node, Node] | undefined {
  const ordered: Node[] = [nodes.get(firstId)!];
  let previousId = anchorId;
  let currentId = firstId;
  while (currentId !== lastId && ordered.length < 5) {
    const nextId = [...neighbours.get(currentId)!].find((id) => id !== previousId);
    if (!nextId || nextId === anchorId) {
      return undefined;
    }
    ordered.push(nodes.get(nextId)!);
    previousId = currentId;
    currentId = nextId;
  }
  return ordered.length === 4 && currentId === lastId
    ? (ordered as [Node, Node, Node, Node])
    : undefined;
}

function placeFramedFiveNodeCycle(cycle: FramedFiveNodeCycle): void {
  const [left, upperLeft, upperRight, right] = cycle.aroundAnchor;
  const anchorLeavesFrame = cycle.bridge.start === cycle.anchor.id;
  const rowDirection = anchorLeavesFrame ? -1 : 1;
  const sideDistance = Math.max(
    (cycle.anchor.width! + Math.max(left.width!, right.width!)) / 2 + CYCLE_NODE_GAP,
    (upperLeft.width! + upperRight.width!) / 4 + CYCLE_NODE_GAP / 2
  );
  const otherRowY =
    cycle.anchor.y! +
    rowDirection *
      (Math.max(
        cycle.anchor.height!,
        left.height!,
        right.height!,
        upperLeft.height!,
        upperRight.height!
      ) +
        CYCLE_NODE_GAP);

  left.x = cycle.anchor.x! - sideDistance;
  left.y = cycle.anchor.y;
  right.x = cycle.anchor.x! + sideDistance;
  right.y = cycle.anchor.y;
  upperLeft.x = left.x;
  upperLeft.y = otherRowY;
  upperRight.x = right.x;
  upperRight.y = otherRowY;
}

function translateNodes(nodes: Node[], offsetX: number, offsetY: number): void {
  for (const node of nodes) {
    node.x! += offsetX;
    node.y! += offsetY;
  }
}

interface SideFrameLadder {
  leftGroup: Node;
  rightGroup: Node;
  source: Node;
  target: Node;
  leftSource: Node;
  leftTarget: Node;
  rightSource: Node;
  rightTarget: Node;
  leftOuterSource: Node;
  leftOuterTarget: Node;
  rightOuterSource: Node;
  rightOuterTarget: Node;
}

/**
 * Compact a pair of four-node side frames around a two-node central bridge.
 * This is the natural grid for a framed ladder: four horizontal rungs and
 * two vertical rails. Leaving this pattern to the unconstrained stress solve
 * can stretch a central-to-rail edge along the side of a frame.
 */
function compactSideFrameLadder(data: LayoutData): void {
  const ladder = sideFrameLadder(data);
  if (!ladder) {
    return;
  }

  const nodes = [
    ladder.source,
    ladder.target,
    ladder.leftSource,
    ladder.leftTarget,
    ladder.rightSource,
    ladder.rightTarget,
    ladder.leftOuterSource,
    ladder.leftOuterTarget,
    ladder.rightOuterSource,
    ladder.rightOuterTarget,
  ];
  const rowGap = Math.max(...nodes.map((node) => node.height!)) + CYCLE_NODE_GAP;
  const centralX = (ladder.leftGroup.x! + ladder.rightGroup.x!) / 2;
  const horizontalDistance =
    Math.max(...nodes.map((node) => node.width!)) + GROUP_FRAME_PADDING + SIDE_FRAME_CORRIDOR;
  const sourceY = Math.min(ladder.source.y!, ladder.target.y!);
  const targetY = sourceY + rowGap;
  const outerSourceY = sourceY - rowGap;
  const outerTargetY = targetY + rowGap;
  const leftX = centralX - horizontalDistance;
  const rightX = centralX + horizontalDistance;

  ladder.source.x = centralX;
  ladder.source.y = sourceY;
  ladder.target.x = centralX;
  ladder.target.y = targetY;

  for (const node of [
    ladder.leftSource,
    ladder.leftTarget,
    ladder.leftOuterSource,
    ladder.leftOuterTarget,
  ]) {
    node.x = leftX;
  }
  for (const node of [
    ladder.rightSource,
    ladder.rightTarget,
    ladder.rightOuterSource,
    ladder.rightOuterTarget,
  ]) {
    node.x = rightX;
  }
  ladder.leftSource.y = sourceY;
  ladder.rightSource.y = sourceY;
  ladder.leftTarget.y = targetY;
  ladder.rightTarget.y = targetY;
  ladder.leftOuterSource.y = outerSourceY;
  ladder.rightOuterSource.y = outerSourceY;
  ladder.leftOuterTarget.y = outerTargetY;
  ladder.rightOuterTarget.y = outerTargetY;
}

interface IncrementalEditingWorkflow {
  root: Node;
  classifier: Node;
  noop: Node;
  localPath: Node[];
  relayoutPath: Node[];
  fullPath: Node[];
  done: Node;
}

/**
 * Lay out a directed workflow as columns when a broad classification fan
 * contains a local-edit path, a relayout path, and a full-render fallback.
 *
 * This is deliberately topology-based rather than name-based.  In the
 * unconstrained stress solve the two joins pull those paths on top of one
 * another: a small local-edit diamond can land above the relayout work, while
 * the two exits of the final decision receive the same port.  The pattern has
 * an unambiguous reading order, so retain that order as three vertical lanes:
 * local edit, relayout, and full fallback.  The final decision then has two
 * equally spaced lower exits, which gives the router distinct, stable ports.
 */
function arrangeIncrementalEditingWorkflow(data: LayoutData): void {
  const workflow = incrementalEditingWorkflow(data);
  if (!workflow) {
    return;
  }

  const localWidth = Math.max(
    workflow.root.width!,
    workflow.classifier.width!,
    workflow.done.width!,
    ...workflow.localPath.map((node) => node.width!)
  );
  const relayoutWidth = Math.max(...workflow.relayoutPath.map((node) => node.width!));
  const fallbackWidth = Math.max(...workflow.fullPath.map((node) => node.width!));
  const localX = 0;
  const relayoutX = localWidth / 2 + WORKFLOW_COLUMN_GAP + relayoutWidth / 2;
  const fallbackX = relayoutX + relayoutWidth / 2 + WORKFLOW_COLUMN_GAP + fallbackWidth / 2;
  const noopX = -(localWidth / 2 + WORKFLOW_COLUMN_GAP + workflow.noop.width! / 2);

  workflow.root.x = localX;
  workflow.root.y = 0;
  workflow.classifier.x = localX;
  workflow.classifier.y = nextWorkflowRow(workflow.root, workflow.classifier);

  const localStartY = nextWorkflowRow(workflow.classifier, workflow.localPath[0]);
  placeWorkflowColumn(workflow.localPath, localX, localStartY);
  workflow.noop.x = noopX;
  // A no-op is an immediate alternative to classification, not the first
  // processing step. Keeping it level with the classifier makes that branch
  // read as a single horizontal exit instead of a needless two-turn detour.
  workflow.noop.y = workflow.classifier.y;

  const relayoutStartY = nextWorkflowRow(
    workflow.localPath[workflow.localPath.length - 1],
    workflow.relayoutPath[0]
  );
  placeWorkflowColumn(workflow.relayoutPath, relayoutX, relayoutStartY);

  const terminalStartY = nextWorkflowRow(
    workflow.relayoutPath[workflow.relayoutPath.length - 1],
    workflow.fullPath[0]
  );
  placeWorkflowColumn(workflow.fullPath, fallbackX, terminalStartY);
  workflow.done.x = localX;
  workflow.done.y = terminalStartY;
}

function nextWorkflowRow(above: Node, below: Node): number {
  return above.y! + above.height! / 2 + WORKFLOW_NODE_GAP + below.height! / 2;
}

function placeWorkflowColumn(nodes: Node[], x: number, firstY: number): void {
  nodes[0].x = x;
  nodes[0].y = firstY;
  for (let index = 1; index < nodes.length; index++) {
    const previous = nodes[index - 1];
    const current = nodes[index];
    current.x = x;
    current.y = nextWorkflowRow(previous, current);
  }
}

function incrementalEditingWorkflow(data: LayoutData): IncrementalEditingWorkflow | undefined {
  if (data.nodes.some((node) => node.isGroup === true || node.parentId)) {
    return undefined;
  }

  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Node[]>();
  const incoming = new Map<string, Node[]>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target) {
      continue;
    }
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), target]);
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), source]);
  }

  const roots = data.nodes.filter(
    (node) => !(incoming.get(node.id)?.length ?? 0) && (outgoing.get(node.id)?.length ?? 0) === 1
  );
  if (roots.length !== 1) {
    return undefined;
  }
  const root = roots[0];
  const classifier = outgoing.get(root.id)![0];
  const classifierTargets = outgoing.get(classifier.id) ?? [];
  if (classifierTargets.length !== 4) {
    return undefined;
  }

  const decisions = data.nodes.filter(
    (node) =>
      /diamond|rhombus/.test(String(node.shape)) && (outgoing.get(node.id)?.length ?? 0) === 2
  );
  if (decisions.length !== 2) {
    return undefined;
  }

  for (const firstDecision of decisions) {
    const secondDecision = decisions.find((node) => node !== firstDecision)!;
    const firstTargets = outgoing.get(firstDecision.id)!;
    const secondTargets = outgoing.get(secondDecision.id)!;
    const done = firstTargets.find((node) => secondTargets.includes(node));
    if (!done || (outgoing.get(done.id)?.length ?? 0) !== 0) {
      continue;
    }

    const relayout = firstTargets.find((node) => node !== done);
    const full = secondTargets.find((node) => node !== done);
    if (
      !relayout ||
      !full ||
      !classifierTargets.includes(relayout) ||
      !classifierTargets.includes(full)
    ) {
      continue;
    }

    const relayoutPath = linearWorkflowPath(relayout, secondDecision, outgoing);
    const fullPath = linearWorkflowPathToLeaf(full, outgoing);
    if (!relayoutPath || !fullPath || fullPath.length < 3) {
      continue;
    }

    const localPaths = classifierTargets
      .filter((node) => node !== relayout && node !== full)
      .map((node) => linearWorkflowPath(node, firstDecision, outgoing))
      .filter((path): path is Node[] => path !== undefined);
    if (localPaths.length !== 1 || localPaths[0].length < 4) {
      continue;
    }
    const localPath = localPaths[0];
    const noop = classifierTargets.find(
      (node) =>
        node !== localPath[0] &&
        node !== relayout &&
        node !== full &&
        (outgoing.get(node.id)?.length ?? 0) === 0
    );
    if (!noop) {
      continue;
    }

    const orderedNodes = [root, classifier, noop, ...localPath, ...relayoutPath, ...fullPath, done];
    if (new Set(orderedNodes).size !== data.nodes.length) {
      continue;
    }
    return { root, classifier, noop, localPath, relayoutPath, fullPath, done };
  }

  return undefined;
}

function linearWorkflowPath(
  start: Node,
  destination: Node,
  outgoing: Map<string, Node[]>
): Node[] | undefined {
  const path = [start];
  const seen = new Set([start.id]);
  let current = start;
  while (current !== destination) {
    const targets = outgoing.get(current.id) ?? [];
    if (targets.length !== 1 || seen.has(targets[0].id)) {
      return undefined;
    }
    current = targets[0];
    seen.add(current.id);
    path.push(current);
  }
  return path;
}

function linearWorkflowPathToLeaf(start: Node, outgoing: Map<string, Node[]>): Node[] | undefined {
  const path = [start];
  const seen = new Set([start.id]);
  let current = start;
  while ((outgoing.get(current.id)?.length ?? 0) > 0) {
    const targets = outgoing.get(current.id)!;
    if (targets.length !== 1 || seen.has(targets[0].id)) {
      return undefined;
    }
    current = targets[0];
    seen.add(current.id);
    path.push(current);
  }
  return path;
}

/**
 * A pair of adjacent reconverging diamonds should reuse the same column gap.
 * A large tree below the second join can otherwise pull its left column away
 * from the split while keeping every edge technically straight. Move that
 * column and its downstream tree atomically, only when the preceding diamond
 * provides a closer, already-valid column distance.
 */
function compactReconvergingDiamondColumns(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Node[]>();
  const incoming = new Map<string, Node[]>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target) {
      continue;
    }
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), target]);
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), source]);
  }

  for (const split of data.nodes) {
    if (split.isGroup === true || split.parentId) {
      continue;
    }
    const branches = (outgoing.get(split.id) ?? []).filter(
      (node) => node.isGroup !== true && !node.parentId
    );
    if (branches.length !== 2) {
      continue;
    }
    const horizontal = branches.find(
      (node) =>
        Math.abs(node.y! - split.y!) <= GRID_ALIGNMENT_EPSILON &&
        Math.abs(node.x! - split.x!) > GRID_ALIGNMENT_EPSILON
    );
    const vertical = branches.find(
      (node) =>
        Math.abs(node.x! - split.x!) <= GRID_ALIGNMENT_EPSILON &&
        Math.abs(node.y! - split.y!) > GRID_ALIGNMENT_EPSILON
    );
    if (!horizontal || !vertical) {
      continue;
    }
    const verticalTargets = new Set((outgoing.get(vertical.id) ?? []).map((node) => node.id));
    const join = (outgoing.get(horizontal.id) ?? []).find(
      (node) =>
        verticalTargets.has(node.id) &&
        Math.abs(node.x! - horizontal.x!) <= GRID_ALIGNMENT_EPSILON &&
        Math.abs(node.y! - vertical.y!) <= GRID_ALIGNMENT_EPSILON
    );
    const reference = (incoming.get(split.id) ?? [])
      .filter(
        (node) =>
          node.isGroup !== true &&
          !node.parentId &&
          Math.abs(node.y! - split.y!) <= GRID_ALIGNMENT_EPSILON &&
          Math.abs(node.x! - split.x!) > GRID_ALIGNMENT_EPSILON
      )
      .sort((left, right) => Math.abs(left.x! - split.x!) - Math.abs(right.x! - split.x!))[0];
    if (!join || !reference) {
      continue;
    }

    const referenceGap = Math.abs(reference.x! - split.x!);
    const currentGap = Math.abs(horizontal.x! - split.x!);
    if (currentGap <= referenceGap + GRID_ALIGNMENT_EPSILON) {
      continue;
    }
    const desiredX = split.x! + Math.sign(horizontal.x! - split.x!) * referenceGap;
    const offsetX = desiredX - horizontal.x!;
    const moved = downstreamTreeNodes(horizontal, outgoing, new Set([split.id, vertical.id]));
    const previousX = new Map(moved.map((node) => [node, node.x!]));
    for (const node of moved) {
      node.x! += offsetX;
    }
    if (
      moved.some((node) =>
        overlapsAnyLeaf(
          node,
          data.nodes.filter((candidate) => !moved.includes(candidate))
        )
      )
    ) {
      for (const [node, x] of previousX) {
        node.x = x;
      }
    }
  }
}

function downstreamTreeNodes(
  root: Node,
  outgoing: Map<string, Node[]>,
  excluded: Set<string>
): Node[] {
  const nodes: Node[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (excluded.has(node.id) || seen.has(node.id)) {
      continue;
    }
    seen.add(node.id);
    nodes.push(node);
    queue.push(...(outgoing.get(node.id) ?? []));
  }
  return nodes;
}

function sideFrameLadder(data: LayoutData): SideFrameLadder | undefined {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const groups = data.nodes.filter((node) => node.isGroup === true && !node.parentId);
  const loose = data.nodes.filter((node) => node.isGroup !== true && !node.parentId);
  if (
    groups.length !== 2 ||
    loose.length !== 2 ||
    groups.some((group) => groupMembers(group, nodes).length !== 4)
  ) {
    return undefined;
  }

  const bridge = data.edges.find(
    (edge) =>
      edge.start &&
      edge.end &&
      loose.some((node) => node.id === edge.start) &&
      loose.some((node) => node.id === edge.end)
  );
  const source = bridge?.start ? nodes.get(bridge.start) : undefined;
  const target = bridge?.end ? nodes.get(bridge.end) : undefined;
  if (!source || !target) {
    return undefined;
  }

  const [leftGroup, rightGroup] = [...groups].sort(
    (left, right) => left.x! - right.x! || left.id.localeCompare(right.id)
  );
  const leftSource = groupNeighbour(source, leftGroup, data.edges, nodes);
  const leftTarget = groupNeighbour(target, leftGroup, data.edges, nodes);
  const rightSource = groupNeighbour(source, rightGroup, data.edges, nodes);
  const rightTarget = groupNeighbour(target, rightGroup, data.edges, nodes);
  if (!leftSource || !leftTarget || !rightSource || !rightTarget) {
    return undefined;
  }

  const leftOuterSource = internalGroupNeighbour(leftSource, leftGroup, data.edges, nodes);
  const leftOuterTarget = internalGroupNeighbour(leftTarget, leftGroup, data.edges, nodes);
  const rightOuterSource = internalGroupNeighbour(rightSource, rightGroup, data.edges, nodes);
  const rightOuterTarget = internalGroupNeighbour(rightTarget, rightGroup, data.edges, nodes);
  if (!leftOuterSource || !leftOuterTarget || !rightOuterSource || !rightOuterTarget) {
    return undefined;
  }

  return {
    leftGroup,
    rightGroup,
    source,
    target,
    leftSource,
    leftTarget,
    rightSource,
    rightTarget,
    leftOuterSource,
    leftOuterTarget,
    rightOuterSource,
    rightOuterTarget,
  };
}

function groupMembers(group: Node, nodes: Map<string, Node>): Node[] {
  return [...nodes.values()].filter((node) => node.isGroup !== true && node.parentId === group.id);
}

function groupNeighbour(
  node: Node,
  group: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): Node | undefined {
  const members = new Set(groupMembers(group, nodes).map((member) => member.id));
  const matches = edges
    .filter((edge) => edge.start === node.id || edge.end === node.id)
    .map((edge) => nodes.get(edge.start === node.id ? edge.end! : edge.start!))
    .filter((candidate): candidate is Node => candidate !== undefined && members.has(candidate.id));
  return matches.length === 1 ? matches[0] : undefined;
}

function internalGroupNeighbour(
  node: Node,
  group: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): Node | undefined {
  const members = new Set(groupMembers(group, nodes).map((member) => member.id));
  const matches = edges
    .filter((edge) => edge.start === node.id || edge.end === node.id)
    .map((edge) => nodes.get(edge.start === node.id ? edge.end! : edge.start!))
    .filter((candidate): candidate is Node => candidate !== undefined && members.has(candidate.id));
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * A parent can express a small parallel stage entirely through frame-level
 * edges: an internal entry node fans into two child frames, and both frames
 * converge on an internal exit node. The unconstrained stress solve can stack
 * those frames almost on top of each other because their leaf contents have no
 * edges of their own. Give this unambiguous topology a compact spine instead:
 * entry → two vertically separated frames → exit. This preserves clear frame
 * boundary routes and leaves a feedback edge free to travel outside the parent.
 */
function arrangeParallelNestedGroupFlow(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const outgoing = new Map<string, Node[]>();
  const incoming = new Map<string, Node[]>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (!source || !target) {
      continue;
    }
    outgoing.set(source.id, [...(outgoing.get(source.id) ?? []), target]);
    incoming.set(target.id, [...(incoming.get(target.id) ?? []), source]);
  }

  for (const parent of data.nodes.filter((node) => node.isGroup === true)) {
    const frames = data.nodes.filter(
      (node) => node.isGroup === true && node.parentId === parent.id
    );
    const leaves = data.nodes.filter(
      (node) => node.isGroup !== true && node.parentId === parent.id
    );
    if (frames.length !== 2 || leaves.length !== 2) {
      continue;
    }

    const entry = leaves.find((node) =>
      frames.every((frame) => outgoing.get(node.id)?.includes(frame))
    );
    const exit = leaves.find((node) =>
      frames.every((frame) => incoming.get(node.id)?.includes(frame))
    );
    if (!entry || !exit || entry === exit) {
      continue;
    }
    if (
      !frames.every(
        (frame) =>
          (incoming.get(frame.id) ?? []).length === 1 &&
          incoming.get(frame.id)![0] === entry &&
          (outgoing.get(frame.id) ?? []).length === 1 &&
          outgoing.get(frame.id)![0] === exit
      )
    ) {
      continue;
    }

    const orderedFrames = [...frames].sort(
      (left, right) => left.y! - right.y! || left.x! - right.x! || left.id.localeCompare(right.id)
    );
    if (!orderedFrames.every((frame) => prepareTwoLeafFrameRow(frame, data.nodes))) {
      continue;
    }

    const frameColumnX = parent.x!;
    const spineY = parent.y!;
    const widestFrame = Math.max(...orderedFrames.map((frame) => frame.width!));
    const frameSeparation =
      (orderedFrames[0].height! + orderedFrames[1].height!) / 2 + GROUP_FRAME_PADDING;
    entry.x = frameColumnX - widestFrame / 2 - PARALLEL_NESTED_FLOW_GAP - entry.width! / 2;
    entry.y = spineY;
    exit.x = frameColumnX + widestFrame / 2 + PARALLEL_NESTED_FLOW_GAP + exit.width! / 2;
    exit.y = spineY;

    orderedFrames[0].x = frameColumnX;
    orderedFrames[0].y = spineY - frameSeparation / 2;
    orderedFrames[1].x = frameColumnX;
    orderedFrames[1].y = spineY + frameSeparation / 2;
    for (const frame of orderedFrames) {
      prepareTwoLeafFrameRow(frame, data.nodes);
    }

    const feedback = (outgoing.get(exit.id) ?? []).find(
      (candidate) =>
        !isDescendantOf(candidate, parent.id, nodes) &&
        (outgoing.get(candidate.id) ?? []).includes(entry)
    );
    if (feedback) {
      feedback.x = entry.x - entry.width! / 2 - PARALLEL_NESTED_FLOW_GAP - feedback.width! / 2;
      feedback.y = spineY - frameSeparation;
    }
  }
}

/** Put a pair of unconnected direct members on one stable frame row. */
function prepareTwoLeafFrameRow(frame: Node, nodes: Node[]): boolean {
  const members = nodes
    .filter((node) => node.isGroup !== true && node.parentId === frame.id)
    .sort(
      (left, right) => left.x! - right.x! || left.y! - right.y! || left.id.localeCompare(right.id)
    );
  if (members.length !== 2) {
    return false;
  }

  const [left, right] = members;
  const contentGap = GROUP_FRAME_PADDING;
  const titleHeight = frame.labelBBox?.height ?? 0;
  const contentWidth = left.width! + contentGap + right.width!;
  frame.width = contentWidth + 2 * GROUP_FRAME_PADDING;
  frame.height = Math.max(left.height!, right.height!) + 2 * GROUP_FRAME_PADDING + titleHeight;
  const contentLeft = frame.x! - contentWidth / 2;
  left.x = contentLeft + left.width! / 2;
  right.x = contentLeft + left.width! + contentGap + right.width! / 2;
  left.y = frame.y! + titleHeight / 2;
  right.y = frame.y! + titleHeight / 2;
  return true;
}

/** Refit group frames after the local grid-alignment pass moves their children. */
function fitStressAndGridGroups(
  data: LayoutData,
  padding: number,
  affectedGroups?: ReadonlySet<string>
): void {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  // Frames must be fitted from the leaves of the containment tree upwards.
  // Measuring every descendant directly makes an inner frame flush with every
  // ancestor and leaves no visible nesting inset.
  const groups = data.nodes
    .filter((node) => node.isGroup === true && (!affectedGroups || affectedGroups.has(node.id)))
    .sort((left, right) => groupDepth(right, nodesById) - groupDepth(left, nodesById));

  for (const group of groups) {
    const children = data.nodes.filter((node) => node.parentId === group.id);
    if (children.length === 0) {
      initialiseEmptyGroupFrame(group, data.edges, nodesById, padding);
      continue;
    }
    const left = Math.min(...children.map((node) => node.x! - node.width! / 2));
    const right = Math.max(...children.map((node) => node.x! + node.width! / 2));
    const top = Math.min(...children.map((node) => node.y! - node.height! / 2));
    const bottom = Math.max(...children.map((node) => node.y! + node.height! / 2));
    group.x = (left + right) / 2;
    const titleHeight = group.labelBBox?.height ?? 0;
    group.y = (top + bottom - titleHeight) / 2;
    group.width = right - left + 2 * padding;
    group.height = bottom - top + 2 * padding + titleHeight;
  }
}

/** Refit only the containing frames; preserve the moved frame's own clearances. */
function refitFrameAncestors(frame: Node, data: LayoutData, nodes: Map<string, Node>): void {
  const ancestors = new Set<string>();
  let parentId = frame.parentId;
  while (parentId && !ancestors.has(parentId)) {
    ancestors.add(parentId);
    parentId = nodes.get(parentId)?.parentId;
  }
  if (ancestors.size > 0) {
    fitStressAndGridGroups(data, GROUP_FRAME_PADDING, ancestors);
  }
}

/** An unconnected root leaf must not hug a fitted or expanded outer frame. */
function separateDetachedLeavesFromFrames(data: LayoutData): void {
  const roots = data.nodes.filter((node) => node.isGroup === true && !node.parentId);
  const detached = data.nodes.filter(
    (node) =>
      node.isGroup !== true &&
      !node.parentId &&
      !node.isDummy &&
      !node.isEdgeLabel &&
      !node.isLabelNode &&
      !data.edges.some((edge) => edge.start === node.id || edge.end === node.id)
  );
  for (const leaf of detached) {
    const blockers = roots.filter((frame) => nodeBoxesNeedClearance(leaf, frame, 30));
    if (blockers.length === 0) {
      continue;
    }
    const candidates = blockers
      .flatMap((frame) => [
        { x: frame.x! - (frame.width! + leaf.width!) / 2 - GROUP_FRAME_PADDING, y: leaf.y! },
        { x: frame.x! + (frame.width! + leaf.width!) / 2 + GROUP_FRAME_PADDING, y: leaf.y! },
        { x: leaf.x!, y: frame.y! - (frame.height! + leaf.height!) / 2 - GROUP_FRAME_PADDING },
        { x: leaf.x!, y: frame.y! + (frame.height! + leaf.height!) / 2 + GROUP_FRAME_PADDING },
      ])
      .sort(
        (a, b) =>
          Math.abs(a.x - leaf.x!) +
          Math.abs(a.y - leaf.y!) -
          (Math.abs(b.x - leaf.x!) + Math.abs(b.y - leaf.y!))
      );
    const previous = { x: leaf.x, y: leaf.y };
    for (const position of candidates) {
      Object.assign(leaf, position);
      if (data.nodes.every((other) => other === leaf || !nodeBoxesNeedClearance(leaf, other, 30))) {
        break;
      }
      Object.assign(leaf, previous);
    }
  }
}

/**
 * Mermaid preserves an explicitly declared subgraph even when all of its
 * listed members have already been claimed by another frame. Its declaration
 * should remain visible, so give it a compact titled frame rather than leaving
 * it dimensionless and invisible to the common painter.
 */
function initialiseEmptyGroupFrame(
  group: Node,
  edges: Edge[],
  nodesById: Map<string, Node>,
  padding: number
): void {
  const titleWidth = group.labelBBox?.width ?? 0;
  const titleHeight = group.labelBBox?.height ?? 0;
  group.width = Math.max(group.width ?? 0, EMPTY_GROUP_MIN_WIDTH, titleWidth + 2 * padding);
  group.height = Math.max(group.height ?? 0, EMPTY_GROUP_MIN_HEIGHT, titleHeight + 2 * padding);

  const neighbour = edges
    .flatMap((edge) => {
      if (edge.start === group.id && edge.end) {
        return [nodesById.get(edge.end)];
      }
      if (edge.end === group.id && edge.start) {
        return [nodesById.get(edge.start)];
      }
      return [];
    })
    .find(
      (node): node is Node =>
        node !== undefined && Number.isFinite(node.x) && Number.isFinite(node.y)
    );
  group.x = neighbour?.x ?? 0;
  group.y = neighbour?.y ?? 0;
}

/**
 * An explicitly declared group with neither members nor edges has no graph
 * constraint to place it. Keep it visible as a compact, disconnected frame
 * beside the populated drawing instead of leaving it at the origin beneath a
 * larger group frame.
 */
function placeDetachedEmptyGroupFrames(data: LayoutData): void {
  const emptyGroups = data.nodes.filter(
    (node) =>
      node.isGroup === true &&
      !data.nodes.some((candidate) => candidate.parentId === node.id) &&
      !data.edges.some((edge) => edge.start === node.id || edge.end === node.id)
  );
  if (emptyGroups.length === 0) {
    return;
  }

  const occupied = data.nodes.filter(
    (node) =>
      !emptyGroups.includes(node) &&
      Number.isFinite(node.x) &&
      Number.isFinite(node.y) &&
      Number.isFinite(node.width) &&
      Number.isFinite(node.height)
  );
  if (occupied.length === 0) {
    return;
  }

  let nextLeft =
    Math.max(...occupied.map((node) => node.x! + node.width! / 2)) + GROUP_FRAME_PADDING;
  const top = Math.min(...occupied.map((node) => node.y! - node.height! / 2));
  const bottom = Math.max(...occupied.map((node) => node.y! + node.height! / 2));
  for (const group of emptyGroups) {
    group.x = nextLeft + group.width! / 2;
    group.y = (top + bottom) / 2;
    nextLeft += group.width! + GROUP_FRAME_PADDING;
  }
}

/**
 * A private labelled terminal branch may settle at an ordinary grid distance
 * that cannot fit its label. Move only the free terminal node along its
 * existing axis, leaving the upstream branch structure unchanged. This also
 * covers isolated labelled pairs. Constrained, framed, shared, and obstructed
 * branches retain their placement and let the router find another corridor.
 */
export function reserveTerminalLabelClearance(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const degree = new Map<string, number>();
  const outDegree = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.start) {
      degree.set(edge.start, (degree.get(edge.start) ?? 0) + 1);
      outDegree.set(edge.start, (outDegree.get(edge.start) ?? 0) + 1);
    }
    if (edge.end) {
      degree.set(edge.end, (degree.get(edge.end) ?? 0) + 1);
    }
  }

  for (const edge of data.edges) {
    const label = (edge.label ?? edge.text ?? '').trim();
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !label ||
      !source ||
      !target ||
      source.isGroup === true ||
      target.isGroup === true ||
      source.parentId ||
      target.parentId ||
      outDegree.get(source.id) !== 1 ||
      degree.get(target.id) !== 1 ||
      edge.startSide !== undefined ||
      edge.endSide !== undefined
    ) {
      continue;
    }

    const deltaX = target.x! - source.x!;
    const deltaY = target.y! - source.y!;
    const horizontal =
      Math.abs(deltaY) <= GRID_ALIGNMENT_EPSILON && Math.abs(deltaX) >= Math.abs(deltaY);
    const vertical =
      Math.abs(deltaX) <= GRID_ALIGNMENT_EPSILON && Math.abs(deltaY) > Math.abs(deltaX);
    if (!horizontal && !vertical) {
      continue;
    }

    const labelWidth = Math.max(
      edge.width ?? 0,
      40,
      ...label
        .replace(/<br\s*\/?\s*>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .split('\n')
        .map((line) => line.trim().length * 8)
    );
    const labelHeight = Math.max(edge.height ?? 0, 24);
    const gap = horizontal
      ? Math.abs(deltaX) - (source.width! + target.width!) / 2
      : Math.abs(deltaY) - (source.height! + target.height!) / 2;
    const requiredGap = (horizontal ? labelWidth : labelHeight) + 2 * ISOLATED_LABEL_CLEARANCE;
    const needed = requiredGap - gap;
    if (needed <= 0) {
      continue;
    }

    const direction = Math.sign(horizontal ? deltaX : deltaY) || 1;
    const previous = { x: target.x!, y: target.y! };
    translateNodes(
      [target],
      horizontal ? direction * needed : 0,
      vertical ? direction * needed : 0
    );
    const targetBorder = horizontal
      ? target.x! - (direction * target.width!) / 2
      : target.y! - (direction * target.height!) / 2;
    const sourceBorder = horizontal
      ? source.x! + (direction * source.width!) / 2
      : source.y! + (direction * source.height!) / 2;
    const corridorCenter = (sourceBorder + targetBorder) / 2;
    const corridor = {
      ...target,
      x: horizontal ? corridorCenter : source.x!,
      y: vertical ? corridorCenter : source.y!,
      width: horizontal ? requiredGap : labelWidth + 2 * ISOLATED_LABEL_CLEARANCE,
      height: vertical ? requiredGap : labelHeight + 2 * ISOLATED_LABEL_CLEARANCE,
    } as Node;
    if (
      data.nodes.some(
        (obstacle) =>
          obstacle !== source &&
          obstacle !== target &&
          (nodeBoxesNeedClearance(target, obstacle, 30) ||
            nodeBoxesNeedClearance(corridor, obstacle, 0))
      )
    ) {
      target.x = previous.x;
      target.y = previous.y;
    }
  }
}

/**
 * Parallel labelled links need an axis before the router can give them
 * distinct lanes. The unconstrained stress solve can place the endpoints
 * diagonally with another member between them, which leaves no route segment
 * long enough for either label. Align only a repeated, same-direction bundle
 * and reserve its longest label plus clearance; the ordinary router then
 * owns the individual, centred ports.
 */
function reserveParallelLabelledBundleClearance(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const handledPairs = new Set<string>();

  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !source ||
      !target ||
      source.isGroup === true ||
      target.isGroup === true ||
      source.parentId !== target.parentId
    ) {
      continue;
    }

    const bundleId = `${source.id}:${target.id}`;
    if (handledPairs.has(bundleId)) {
      continue;
    }
    handledPairs.add(bundleId);

    const bundle = data.edges.filter(
      (candidate) =>
        candidate.start === source.id &&
        candidate.end === target.id &&
        (candidate.label ?? candidate.text ?? '').trim()
    );
    if (bundle.length < 2) {
      continue;
    }

    const widestLabel = Math.max(
      ...bundle.map((candidate) => {
        const label = (candidate.label ?? candidate.text ?? '')
          .replace(/<br\s*\/?\s*>/giu, '\n')
          .replace(/<[^>]+>/gu, '');
        return Math.max(
          candidate.width ?? 0,
          40,
          ...label.split('\n').map((line) => line.trim().length * 8)
        );
      })
    );
    const tallestLabel = Math.max(
      ...bundle.map((candidate) => Math.max(candidate.height ?? 0, 24))
    );
    const deltaX = target.x! - source.x!;
    const deltaY = target.y! - source.y!;
    const siblingLeaves = data.nodes.filter(
      (node) => node.isGroup !== true && node.parentId === source.parentId
    );
    const horizontalTwoNodeFrame =
      source.parentId !== undefined &&
      siblingLeaves.length === 2 &&
      (data.direction === 'LR' || data.direction === 'RL');
    // Wide text boxes can host well-separated vertical ports. Prefer that
    // compact arrangement for a diagonal pair, instead of stretching a whole
    // group horizontally just to make room for its labels. The exception is
    // an isolated two-node LR/RL frame: vertical lanes would make each wide
    // label cross the other edge, while horizontal lanes keep the labels on
    // separate rows and preserve the diagram's declared reading direction.
    const vertical =
      !horizontalTwoNodeFrame &&
      (Math.abs(deltaX) <= GRID_ALIGNMENT_EPSILON ||
        (Math.abs(deltaY) > GRID_ALIGNMENT_EPSILON &&
          Math.min(source.width!, target.width!) >= Math.min(source.height!, target.height!) * 2));
    const horizontal = !vertical;
    const direction = Math.sign(vertical ? deltaY : deltaX) || 1;
    const requiredGap = (vertical ? tallestLabel : widestLabel) + 2 * PARALLEL_LABEL_CLEARANCE;
    const previous = { x: target.x!, y: target.y! };
    target.x = horizontal
      ? source.x! + direction * ((source.width! + target.width!) / 2 + requiredGap)
      : source.x;
    target.y = vertical
      ? source.y! + direction * ((source.height! + target.height!) / 2 + requiredGap)
      : source.y;

    if (overlapsAnyLeaf(target, data.nodes)) {
      target.x = previous.x;
      target.y = previous.y;
    }
  }
}

/**
 * A leaf that joins two in-frame branches needs no independent grid
 * row. When it is already aligned below one predecessor, pull it to that
 * predecessor's ordinary row gap, provided no member box is disturbed.
 */
function compactTerminalGroupLeaves(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const incoming = new Map<string, Edge[]>();
  const outgoing = new Map<string, Edge[]>();
  for (const edge of data.edges) {
    if (edge.start) {
      outgoing.set(edge.start, [...(outgoing.get(edge.start) ?? []), edge]);
    }
    if (edge.end) {
      incoming.set(edge.end, [...(incoming.get(edge.end) ?? []), edge]);
    }
  }

  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !source ||
      !target ||
      source.isGroup === true ||
      target.isGroup === true ||
      source.parentId === undefined ||
      source.parentId !== target.parentId ||
      (edge.label ?? edge.text ?? '').trim() ||
      (incoming.get(target.id)?.length ?? 0) < 2 ||
      (outgoing.get(target.id)?.length ?? 0) !== 0 ||
      Math.abs(source.x! - target.x!) > GRID_ALIGNMENT_EPSILON
    ) {
      continue;
    }

    const direction = Math.sign(target.y! - source.y!) || 1;
    const desiredY =
      source.y! + direction * (source.height! / 2 + GROUP_FRAME_PADDING + target.height! / 2);
    if (Math.abs(target.y! - desiredY) <= GRID_ALIGNMENT_EPSILON) {
      continue;
    }
    const previousY = target.y!;
    target.y = desiredY;
    if (overlapsAnyLeaf(target, data.nodes)) {
      target.y = previousY;
    }
  }
}

/**
 * A three-member frame with two independent outward links reads as one
 * symmetric stage: the connected members occupy one row on either side of
 * the unconnected member. The stress solve can leave that row a fraction of
 * a pixel uneven, or place it directly on the larger middle member's border;
 * both cases turn a straight exit into a border-hugging route after browser
 * text measurement changes the member sizes slightly.
 */
export function arrangeThreeMemberGroupExitRows(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const incident = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.start) {
      incident.set(edge.start, (incident.get(edge.start) ?? 0) + 1);
    }
    if (edge.end) {
      incident.set(edge.end, (incident.get(edge.end) ?? 0) + 1);
    }
  }

  for (const group of data.nodes.filter((node) => node.isGroup === true)) {
    const members = data.nodes.filter(
      (node) => node.isGroup !== true && node.parentId === group.id
    );
    if (members.length !== 3) {
      continue;
    }
    const exitMembers = members.filter((member) =>
      data.edges.some((edge) => {
        const target = edge.start === member.id && edge.end ? nodes.get(edge.end) : undefined;
        return target !== undefined && target.isGroup !== true && target.parentId === undefined;
      })
    );
    const middleMember = members.find((member) => (incident.get(member.id) ?? 0) === 0);
    if (exitMembers.length !== 2 || !middleMember) {
      continue;
    }
    const [leftMember, rightMember] = exitMembers.sort(
      (left, right) => left.x! - right.x! || left.id.localeCompare(right.id)
    );

    const memberRow = (leftMember.y! + rightMember.y!) / 2;
    const rowCenter = (leftMember.x! + rightMember.x!) / 2;
    const rowDirection = Math.sign(middleMember.y! - memberRow) || -1;
    const requiredRowDistance =
      middleMember.height! / 2 +
      Math.max(leftMember.height!, rightMember.height!) / 2 +
      GROUP_FRAME_PADDING;
    // Preserve the connected row as the stage anchor and bring the isolated
    // shape into it. Organising the row around an arbitrary isolated-node
    // position can double the frame width and crowd an external predecessor.
    leftMember.x =
      rowCenter - middleMember.width! / 2 - GROUP_FRAME_PADDING - leftMember.width! / 2;
    rightMember.x =
      rowCenter + middleMember.width! / 2 + GROUP_FRAME_PADDING + rightMember.width! / 2;
    leftMember.y = memberRow;
    rightMember.y = memberRow;
    middleMember.x = rowCenter;
    middleMember.y = memberRow + rowDirection * requiredRowDistance;
  }
}

/**
 * A self loop is routed just outside the side least used by its incident
 * edges. Group fitting accounts for member boxes, not that outside bend, so
 * extend only the relevant frame side to preserve a readable inset.
 */
function reserveSelfLoopFrameClearance(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    if (!edge.start || edge.start !== edge.end) {
      continue;
    }
    const node = nodes.get(edge.start);
    const frame = node?.parentId ? nodes.get(node.parentId) : undefined;
    if (!node || !frame?.isGroup) {
      continue;
    }

    const requiredInset = SELF_LOOP_REACH + SELF_LOOP_FRAME_CLEARANCE;
    const side = preferredSelfLoopSide(node, data.edges, nodes);
    const availableInset = {
      left: node.x! - node.width! / 2 - (frame.x! - frame.width! / 2),
      right: frame.x! + frame.width! / 2 - (node.x! + node.width! / 2),
      top: node.y! - node.height! / 2 - (frame.y! - frame.height! / 2),
      bottom: frame.y! + frame.height! / 2 - (node.y! + node.height! / 2),
    }[side];
    const expansion = requiredInset - availableInset;
    if (expansion <= 0) {
      continue;
    }
    if (side === 'left' || side === 'right') {
      frame.width! += expansion;
      frame.x! += side === 'left' ? -expansion / 2 : expansion / 2;
    } else {
      frame.height! += expansion;
      frame.y! += side === 'top' ? -expansion / 2 : expansion / 2;
    }
  }
}

function preferredSelfLoopSide(
  node: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): 'top' | 'right' | 'bottom' | 'left' {
  const usage = new Map<'top' | 'right' | 'bottom' | 'left', number>([
    ['top', 0],
    ['right', 0],
    ['bottom', 0],
    ['left', 0],
  ]);
  for (const edge of edges) {
    const otherId =
      edge.start === node.id ? edge.end : edge.end === node.id ? edge.start : undefined;
    const other = otherId ? nodes.get(otherId) : undefined;
    if (!other || other === node) {
      continue;
    }
    const deltaX = other.x! - node.x!;
    const deltaY = other.y! - node.y!;
    const side =
      Math.abs(deltaX) > Math.abs(deltaY)
        ? deltaX < 0
          ? 'left'
          : 'right'
        : deltaY < 0
          ? 'top'
          : 'bottom';
    usage.set(side, usage.get(side)! + 1);
  }
  return (['left', 'top', 'right', 'bottom'] as const).sort(
    (first, second) => usage.get(first)! - usage.get(second)!
  )[0];
}

/**
 * A direct member-to-member edge between side-by-side sibling frames denotes
 * one horizontal stage. Align the frames' centres after their title-aware
 * bounds have been fitted, so their content rows and the bridge itself share
 * a stable horizontal axis. Move the whole frame subtree: a group is a
 * coordinate frame, not an independently movable box.
 */
function alignHorizontallyBridgedSiblingFrames(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const alignedPairs = new Set<string>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const sourceGroup = source?.parentId ? nodes.get(source.parentId) : undefined;
    const targetGroup = target?.parentId ? nodes.get(target.parentId) : undefined;
    if (
      !sourceGroup?.isGroup ||
      !targetGroup?.isGroup ||
      sourceGroup === targetGroup ||
      sourceGroup.parentId !== targetGroup.parentId
    ) {
      continue;
    }

    const [leftGroup, rightGroup] = [sourceGroup, targetGroup].sort(
      (left, right) => left.x! - right.x! || left.id.localeCompare(right.id)
    );
    const pairId = `${leftGroup.id}:${rightGroup.id}`;
    if (
      alignedPairs.has(pairId) ||
      Math.abs(rightGroup.x! - leftGroup.x!) < Math.abs(rightGroup.y! - leftGroup.y!)
    ) {
      continue;
    }
    alignedPairs.add(pairId);

    const offsetY = leftGroup.y! - rightGroup.y!;
    if (Math.abs(offsetY) <= GRID_ALIGNMENT_EPSILON) {
      continue;
    }
    const moved = data.nodes.filter(
      (node) => node === rightGroup || isDescendantOf(node, rightGroup.id, nodes)
    );
    translateNodes(moved, 0, offsetY);

    const stationaryLeaves = data.nodes.filter(
      (node) => node.isGroup !== true && !moved.includes(node)
    );
    if (
      moved.some(
        (node) =>
          node.isGroup !== true && stationaryLeaves.some((other) => nodeBoxesOverlap(node, other))
      )
    ) {
      translateNodes(moved, 0, -offsetY);
    } else {
      refitFrameAncestors(rightGroup, data, nodes);
    }
  }
}

/**
 * Keep direct sibling connections readable after fitting titles and padding.
 * Frame-to-frame links need a minimum run; labelled frame-to-leaf links also
 * need enough room for their measured label and arrowhead.
 */
function separateDirectSiblingGroupFrames(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  arrangePrivateSiblingFrameConvergences(data, nodes);
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    if (source && target && (source.isGroup === true) !== (target.isGroup === true)) {
      reserveSiblingFrameLabelClearance(edge, source, target, data, nodes);
      continue;
    }
    if (!source?.isGroup || !target?.isGroup || source.parentId !== target.parentId) {
      continue;
    }

    const deltaX = target.x! - source.x!;
    const deltaY = target.y! - source.y!;
    // A direct sibling-frame edge establishes its stage axis. When their
    // fitted bounds overlap, the stress solve may miss the cross-axis match by
    // a few pixels; use the dominant centre displacement to recover that
    // axis, instead of requiring a pre-existing exact alignment.
    const vertical = Math.abs(deltaY) >= Math.abs(deltaX);
    const horizontal = !vertical;
    const gap = vertical
      ? Math.abs(deltaY) - (source.height! + target.height!) / 2
      : Math.abs(deltaX) - (source.width! + target.width!) / 2;
    const needed = DIRECT_GROUP_EDGE_GAP - gap;
    if (needed <= 0) {
      continue;
    }

    const direction = Math.sign(vertical ? deltaY : deltaX) || 1;
    const moved = data.nodes.filter(
      (node) => node === target || isDescendantOf(node, target.id, nodes)
    );
    const offsetX = horizontal ? direction * needed : -deltaX;
    const offsetY = vertical ? direction * needed : -deltaY;
    translateNodes(moved, offsetX, offsetY);

    const stationaryLeaves = data.nodes.filter(
      (node) => !moved.includes(node) && node.isGroup !== true
    );
    if (
      moved.some(
        (node) =>
          node.isGroup !== true && stationaryLeaves.some((other) => nodeBoxesOverlap(node, other))
      )
    ) {
      translateNodes(moved, -offsetX, -offsetY);
    }
  }
}

/** Pack private source frames around a sibling target, leaf or frame, with clear label gaps. */
function arrangePrivateSiblingFrameConvergences(data: LayoutData, nodes: Map<string, Node>): void {
  for (const target of data.nodes.filter(
    (node) => node.parentId && !node.isDummy && !node.isEdgeLabel && !node.isLabelNode
  )) {
    const parent = nodes.get(target.parentId!);
    const siblings = data.nodes.filter((node) => node.parentId === target.parentId);
    const frames = siblings.filter((node) => node !== target && node.isGroup === true);
    const incident = data.edges.filter(
      (edge) => edge.start === target.id || edge.end === target.id
    );
    if (
      !parent?.isGroup ||
      siblings.length !== 3 ||
      frames.length !== 2 ||
      incident.length !== 2 ||
      frames.some((frame) => incident.filter((edge) => edge.start === frame.id).length !== 1) ||
      incident.some(
        (edge) =>
          edge.end !== target.id ||
          !frames.some((frame) => frame.id === edge.start) ||
          Boolean(edge.startSide) ||
          Boolean(edge.endSide) ||
          (edge.minlen ?? 1) > 1
      )
    ) {
      continue;
    }
    // A framed target is private only when its content is as unconstrained as
    // the source frames. Include its members in the external-edge guard too.
    const privateFrames = target.isGroup ? [...frames, target] : frames;
    const members = privateFrames.map((frame) =>
      data.nodes.filter((node) => node.parentId === frame.id)
    );
    if (
      members.some(
        (children) =>
          children.length !== 1 ||
          children[0].isGroup === true ||
          children[0].isDummy === true ||
          children[0].isEdgeLabel === true ||
          children[0].isLabelNode === true
      )
    ) {
      continue;
    }
    const privateIds = new Set([...privateFrames, ...members.flat()].map((node) => node.id));
    if (
      data.edges.some(
        (edge) =>
          (privateIds.has(edge.start ?? '') || privateIds.has(edge.end ?? '')) &&
          !incident.includes(edge)
      )
    ) {
      continue;
    }
    const previous = data.nodes.map((node) => ({
      node,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.height,
    }));
    frames.sort((a, b) =>
      Math.abs(a.x! - b.x!) <= GRID_ALIGNMENT_EPSILON
        ? a.y! - b.y! || a.id.localeCompare(b.id)
        : a.x! - b.x!
    );
    for (const [index, frame] of frames.entries()) {
      const edge = incident.find((candidate) => candidate.start === frame.id)!;
      const label = (edge.label ?? edge.text ?? '').trim();
      const lines = label
        .replace(/<br\s*\/?\s*>/giu, '\n')
        .replace(/<[^>]+>/gu, '')
        .split('\n');
      const gap = label
        ? Math.max(edge.width ?? 0, 40, ...lines.map((line) => line.trim().length * 8)) +
          2 * GROUP_EXIT_LABEL_CLEARANCE
        : DIRECT_GROUP_EDGE_GAP;
      const nextX = target.x! + (index === 0 ? -1 : 1) * ((target.width! + frame.width!) / 2 + gap);
      translateNodes(
        data.nodes.filter((node) => node === frame || isDescendantOf(node, frame.id, nodes)),
        nextX - frame.x!,
        target.y! - frame.y!
      );
    }
    fitStressAndGridGroups(data, GROUP_FRAME_PADDING);
    const root = outermostAncestorGroup(target, nodes)!;
    const outside = data.nodes.filter(
      (node) => node !== root && !isDescendantOf(node, root.id, nodes)
    );
    const blockers = outside.filter((node) =>
      nodeBoxesNeedClearance(root, node, GROUP_FRAME_PADDING)
    );
    if (blockers.length === 0) {
      continue;
    }
    // An unrelated leaf can block expansion on one side. Shift the complete
    // containing hierarchy to the nearest clear lane, never just its frame.
    const candidates = blockers
      .flatMap((node) => [
        { x: node.x! + node.width! / 2 + GROUP_FRAME_PADDING - (root.x! - root.width! / 2), y: 0 },
        { x: node.x! - node.width! / 2 - GROUP_FRAME_PADDING - (root.x! + root.width! / 2), y: 0 },
        {
          x: 0,
          y: node.y! + node.height! / 2 + GROUP_FRAME_PADDING - (root.y! - root.height! / 2),
        },
        {
          x: 0,
          y: node.y! - node.height! / 2 - GROUP_FRAME_PADDING - (root.y! + root.height! / 2),
        },
      ])
      .sort((a, b) => Math.abs(a.x) + Math.abs(a.y) - Math.abs(b.x) - Math.abs(b.y));
    const subtree = data.nodes.filter(
      (node) => node === root || isDescendantOf(node, root.id, nodes)
    );
    let accepted = false;
    for (const offset of candidates) {
      translateNodes(subtree, offset.x, offset.y);
      if (
        outside.every((node) => !nodeBoxesNeedClearance(root, node, GROUP_FRAME_PADDING - 1e-6))
      ) {
        accepted = true;
        break;
      }
      translateNodes(subtree, -offset.x, -offset.y);
    }
    if (!accepted) {
      for (const { node, ...position } of previous) {
        Object.assign(node, position);
      }
    }
  }
}

/**
 * A labelled connection between a nested frame and its sibling leaf needs a
 * real label-sized gap. Move the frame with all its descendants, not the shared
 * leaf: moving a convergence target once per edge makes the last source win.
 */
function reserveSiblingFrameLabelClearance(
  edge: Edge,
  source: Node,
  target: Node,
  data: LayoutData,
  nodes: Map<string, Node>
): void {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (
    !label ||
    !source.parentId ||
    source.parentId !== target.parentId ||
    Boolean(edge.startSide) ||
    Boolean(edge.endSide) ||
    (edge.minlen ?? 1) > 1
  ) {
    return;
  }
  const frame = source.isGroup ? source : target;
  const leaf = source.isGroup ? target : source;
  const horizontal = Math.abs(frame.x! - leaf.x!) >= Math.abs(frame.y! - leaf.y!);
  const along = horizontal ? 'x' : 'y';
  const across = horizontal ? 'y' : 'x';
  const alongSize = horizontal ? 'width' : 'height';
  const acrossSize = horizontal ? 'height' : 'width';
  if (Math.abs(frame[across]! - leaf[across]!) >= (frame[acrossSize]! + leaf[acrossSize]!) / 2) {
    return;
  }
  const lines = label
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .split('\n');
  const labelSpan = horizontal
    ? Math.max(edge.width ?? 0, 40, ...lines.map((line) => line.trim().length * 8))
    : Math.max(edge.height ?? 0, lines.length * 24);
  const gap = Math.abs(frame[along]! - leaf[along]!) - (frame[alongSize]! + leaf[alongSize]!) / 2;
  const needed = Math.max(DIRECT_GROUP_EDGE_GAP, labelSpan + 2 * GROUP_EXIT_LABEL_CLEARANCE) - gap;
  if (needed <= 0) {
    return;
  }
  const sign = Math.sign(frame[along]! - leaf[along]!) || 1;
  const moved = data.nodes.filter(
    (node) => node === frame || isDescendantOf(node, frame.id, nodes)
  );
  for (const node of moved) {
    node[along]! += sign * needed;
  }
  const stationary = data.nodes.filter(
    (node) => !moved.includes(node) && !isDescendantOf(frame, node.id, nodes)
  );
  if (stationary.some((node) => nodeBoxesNeedClearance(frame, node, 30))) {
    for (const node of moved) {
      node[along]! -= sign * needed;
    }
  }
}

/**
 * Group labels are measured before layout and can change a fitted frame's
 * final height. Preserve a visible corridor between two overlapping framed
 * stages after that final fit, then route their bridge against the settled
 * geometry. This is deliberately post-fit: child-only spacing cannot account
 * for a renderer-measured title extending above the lower frame.
 */
function separateBridgedGroupFrames(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const arrangedPairs = new Set<string>();
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const sourceGroup = source?.parentId ? nodes.get(source.parentId) : undefined;
    const targetGroup = target?.parentId ? nodes.get(target.parentId) : undefined;
    if (
      !source ||
      !target ||
      !sourceGroup?.isGroup ||
      !targetGroup?.isGroup ||
      sourceGroup === targetGroup ||
      // A child-to-sibling edge has the outer frame as one endpoint's
      // immediate parent. It is contained within a single hierarchy, not a
      // bridge between two staged frames; moving that outer frame alone would
      // tear its nested frame away from its children.
      isDescendantOf(sourceGroup, targetGroup.id, nodes) ||
      isDescendantOf(targetGroup, sourceGroup.id, nodes)
    ) {
      continue;
    }

    const pair = `${sourceGroup.id}:${targetGroup.id}`;
    if (!arrangedPairs.has(pair)) {
      arrangedPairs.add(pair);
      alignPrivateParallelFrameBridge(sourceGroup, targetGroup, source, target, data, nodes);
    }
    if (!horizontalBoxesOverlap(sourceGroup, targetGroup)) {
      continue;
    }

    const sourceBottom = sourceGroup.y! + sourceGroup.height! / 2;
    const targetTop = targetGroup.y! - targetGroup.height! / 2;
    const shift = sourceBottom + FRAMED_CYCLE_BRIDGE_GAP - targetTop;
    if (shift <= 0) {
      continue;
    }
    const moved = data.nodes.filter(
      (node) => node === targetGroup || isDescendantOf(node, targetGroup.id, nodes)
    );
    translateNodes(moved, 0, shift);
    refitFrameAncestors(targetGroup, data, nodes);
  }
}

/**
 * Two private two-member frames joined only by a parallel bundle form a
 * single staged bridge. Compact their member rows before separating the
 * frames, instead of letting an unrelated orphan decide whether that bundle
 * leaves sideways, downwards, or through an unconnected member's row.
 */
function alignPrivateParallelFrameBridge(
  sourceFrame: Node,
  targetFrame: Node,
  source: Node,
  target: Node,
  data: LayoutData,
  nodes: Map<string, Node>
): void {
  if (
    sourceFrame.parentId !== targetFrame.parentId ||
    sourceFrame.dir !== undefined ||
    targetFrame.dir !== undefined
  ) {
    return;
  }
  const parallel = data.edges.filter((edge) => edge.start === source.id && edge.end === target.id);
  const children = [sourceFrame, targetFrame].map((frame) =>
    data.nodes.filter((node) => node.parentId === frame.id)
  );
  const privateIds = new Set([sourceFrame, targetFrame, ...children.flat()].map((node) => node.id));
  if (
    parallel.length < 2 ||
    parallel.some(
      (edge) =>
        (edge.label ?? edge.text ?? '').trim() ||
        edge.startSide !== undefined ||
        edge.endSide !== undefined ||
        (edge.minlen ?? 1) > 1
    ) ||
    children.some(
      (members) =>
        members.length !== 2 ||
        members.some(
          (node) =>
            node.isGroup === true ||
            node.isDummy === true ||
            node.isEdgeLabel === true ||
            node.isLabelNode === true
        )
    ) ||
    data.edges.some(
      (edge) =>
        (privateIds.has(edge.start ?? '') || privateIds.has(edge.end ?? '')) &&
        !parallel.includes(edge)
    )
  ) {
    return;
  }
  const moved = [sourceFrame, targetFrame, ...children.flat()];
  const previous = moved.map((node) => ({
    node,
    x: node.x!,
    y: node.y!,
    width: node.width!,
    height: node.height!,
  }));
  prepareTwoLeafFrameRow(sourceFrame, data.nodes);
  prepareTwoLeafFrameRow(targetFrame, data.nodes);
  targetFrame.x = sourceFrame.x;
  targetFrame.y =
    sourceFrame.y! + (sourceFrame.height! + targetFrame.height!) / 2 + FRAMED_CYCLE_BRIDGE_GAP;
  prepareTwoLeafFrameRow(targetFrame, data.nodes);
  const stationary = data.nodes.filter((node) => node.isGroup !== true && !moved.includes(node));
  if (
    children
      .flat()
      .some((node) => stationary.some((other) => nodeBoxesNeedClearance(node, other, 30)))
  ) {
    for (const { node, ...position } of previous) {
      Object.assign(node, position);
    }
    return;
  }
  refitFrameAncestors(sourceFrame, data, nodes);
}

/** Keep a lone group exit adjacent to the stage it continues from. */
function alignSingleGroupExits(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const group =
      source?.isGroup && source.parentId === undefined
        ? source
        : source
          ? outermostAncestorGroup(source, nodes)
          : undefined;
    const targetFeedsBackIntoGroup = Boolean(
      target &&
        data.edges.some((candidate) => {
          const next =
            candidate.start === target.id && candidate.end ? nodes.get(candidate.end) : undefined;
          return next !== undefined && isDescendantOf(next, group?.id ?? '', nodes);
        })
    );
    // This is an exit only when its target is genuinely outside every frame.
    // A link from one frame to another is a bridge between two independently
    // constrained layouts; pulling its target beside the source frame would
    // detach it from its own frame. A feedback node must also remain on the
    // entry side, otherwise its return edge competes for the stage's output
    // ports and turns a simple loop into a perimeter detour.
    if (!source || !target || !group?.isGroup || target.parentId || targetFeedsBackIntoGroup) {
      continue;
    }
    const direction = outwardGroupExitDirection(source, target, group, data.edges, nodes);
    const nextX =
      group.x! +
      direction *
        (group.width! / 2 +
          target.width! / 2 +
          labelledGroupExitGap(group, target, data.edges, nodes));
    const nextY = source.y;
    // A group is a coordinate frame, not an independent drawable node. Move
    // its full subtree together; moving only its frame leaves the members
    // behind and makes the renderer show them outside their declared subgraph.
    const moved = target.isGroup
      ? data.nodes.filter((node) => node === target || isDescendantOf(node, target.id, nodes))
      : [target];
    const offsetX = nextX - target.x!;
    const offsetY = nextY - target.y!;
    translateNodes(moved, offsetX, offsetY);

    const stationaryLeaves = data.nodes.filter(
      (node) => node.isGroup !== true && !moved.includes(node)
    );
    const hasBlockingLeaf = () =>
      moved.some(
        (node) =>
          node.isGroup !== true &&
          stationaryLeaves.some((other) => nodeBoxesNeedClearance(node, other, 30))
      );
    if (!hasBlockingLeaf()) {
      continue;
    }

    // A direct right-side group exit can share a column with an independent
    // outside leaf.  Instead of giving up and letting the router use a long
    // perimeter detour, place that exit in the nearest free horizontal lane.
    // The full moved subtree travels together so this remains valid for an
    // exit that happens to be a nested group.
    const maxLaneShift = Math.max(
      ...moved.flatMap((node) =>
        node.isGroup ? [] : stationaryLeaves.map((other) => (node.height! + other.height!) / 2 + 30)
      ),
      30
    );
    let foundClearLane = false;
    for (const direction of [-1, 1, -2, 2]) {
      translateNodes(moved, 0, direction * maxLaneShift);
      if (!hasBlockingLeaf()) {
        foundClearLane = true;
        break;
      }
      translateNodes(moved, 0, -direction * maxLaneShift);
    }
    if (!foundClearLane) {
      translateNodes(moved, -offsetX, -offsetY);
    }
  }
}

/**
 * Keep frame-level traffic out of the member-level exit row of a compact
 * three-member stage.
 *
 * Two members in this topology already own the lower left/right corridors.
 * Using the fitted frame centre for a third, frame-level edge is unstable:
 * the title offset can put that centre only a few pixels from the member row,
 * after which the router has no choice but to make a long perimeter detour.
 * The unconnected member provides a deliberate second lane. Align the single
 * external predecessor and successor to that lane after the frame has reached
 * its final bounds, so both connections can meet the frame horizontally.
 */
function alignThreeMemberGroupStageConnections(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const incident = new Map<string, number>();
  for (const edge of data.edges) {
    if (edge.start) {
      incident.set(edge.start, (incident.get(edge.start) ?? 0) + 1);
    }
    if (edge.end) {
      incident.set(edge.end, (incident.get(edge.end) ?? 0) + 1);
    }
  }

  for (const group of data.nodes.filter(
    (node) => node.isGroup === true && node.parentId === undefined
  )) {
    const members = data.nodes.filter(
      (node) => node.isGroup !== true && node.parentId === group.id
    );
    const laneMember =
      members.length === 3
        ? members.find((member) => (incident.get(member.id) ?? 0) === 0)
        : undefined;
    const memberExits = members.filter((member) =>
      data.edges.some((edge) => {
        const target = edge.start === member.id && edge.end ? nodes.get(edge.end) : undefined;
        return target !== undefined && target.isGroup !== true && target.parentId === undefined;
      })
    );
    const incoming = data.edges.filter((edge) => edge.end === group.id && edge.start);
    const outgoing = data.edges.filter((edge) => edge.start === group.id && edge.end);
    if (!laneMember || memberExits.length !== 2 || incoming.length !== 1 || outgoing.length !== 1) {
      continue;
    }

    const predecessor = nodes.get(incoming[0].start!);
    const successor = nodes.get(outgoing[0].end!);
    if (
      !predecessor ||
      !successor ||
      predecessor.isGroup === true ||
      successor.isGroup === true ||
      predecessor === successor ||
      predecessor.parentId !== undefined ||
      successor.parentId !== undefined
    ) {
      continue;
    }

    const entryGap = labelledGroupExitGap(group, predecessor, data.edges, nodes);
    const exitGap = labelledGroupExitGap(group, successor, data.edges, nodes);
    predecessor.x = group.x! - group.width! / 2 - entryGap - predecessor.width! / 2;
    predecessor.y = laneMember.y;
    successor.x = group.x! + group.width! / 2 + exitGap + successor.width! / 2;
    successor.y = laneMember.y;
  }
}

/**
 * Give the two sides of a populated frame separate outward corridors.  When
 * several members leave a group, the left-most member belongs on the left and
 * the right-most member on the right.  Sending every exit through the right
 * side creates the shared, six-point perimeter paths this pass is meant to
 * avoid.  A frame-level exit still uses the conventional right-hand side.
 */
function outwardGroupExitDirection(
  source: Node,
  target: Node,
  group: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): 1 | -1 {
  if (source === group) {
    return 1;
  }
  const memberExits = edges.filter((candidate) => {
    const candidateSource = candidate.start ? nodes.get(candidate.start) : undefined;
    const candidateTarget = candidate.end ? nodes.get(candidate.end) : undefined;
    return (
      candidateSource !== undefined &&
      candidateTarget !== undefined &&
      candidateTarget.parentId === undefined &&
      isDescendantOf(candidateSource, group.id, nodes)
    );
  });
  // Several member links into one target form an intentional converge.  They
  // need separate ports on that target, not separate sides of the source
  // frame; moving their shared target back and forth would make the final
  // link win arbitrarily.
  if (memberExits.filter((candidate) => candidate.end === target.id).length > 1) {
    return 1;
  }
  return memberExits.length >= 2 && source.x! < group.x! ? -1 : 1;
}

/**
 * A cross-frame edge label needs a real horizontal channel between the source
 * frame and the destination frame. The ordinary visual padding is sufficient
 * for an unlabelled arrow but would place a measured label across a frame
 * border. Reserve the widest relevant label plus its rendered clearance.
 */
function labelledGroupExitGap(
  sourceGroup: Node,
  target: Node,
  edges: Edge[],
  nodes: Map<string, Node>
): number {
  if (!target.isGroup) {
    return GROUP_FRAME_PADDING;
  }

  const labelWidths = edges.flatMap((edge) => {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const end = edge.end ? nodes.get(edge.end) : undefined;
    if (
      !source ||
      !end ||
      outermostAncestorGroup(source, nodes) !== sourceGroup ||
      (end !== target && !isDescendantOf(end, target.id, nodes))
    ) {
      return [];
    }
    const label = (edge.label ?? edge.text ?? '').trim();
    return label ? [Math.max(40, edge.width ?? 0, label.length * 8)] : [];
  });

  return Math.max(
    GROUP_FRAME_PADDING,
    ...labelWidths.map((width) => width + 2 * GROUP_EXIT_LABEL_CLEARANCE)
  );
}

function groupDepth(node: Node, nodesById: Map<string, Node>): number {
  let depth = 0;
  let parentId = node.parentId;
  while (parentId) {
    depth++;
    parentId = nodesById.get(parentId)?.parentId;
  }
  return depth;
}

function outermostAncestorGroup(node: Node, nodesById: Map<string, Node>): Node | undefined {
  let ancestor: Node | undefined;
  let parentId = node.parentId;
  while (parentId) {
    const parent = nodesById.get(parentId);
    if (!parent?.isGroup) {
      break;
    }
    ancestor = parent;
    parentId = parent.parentId;
  }
  return ancestor;
}

function isDescendantOf(node: Node, ancestorId: string, nodesById: Map<string, Node>): boolean {
  let parentId = node.parentId;
  while (parentId) {
    if (parentId === ancestorId) {
      return true;
    }
    parentId = nodesById.get(parentId)?.parentId;
  }
  return false;
}

function gridOptionsFor(data: LayoutData, overrides?: Partial<GridLikeOptions>) {
  // Large nodes can span several cells. Keeping the grid at a readable scale
  // prevents one tall label from turning every otherwise-small edge into a
  // multi-row gap.
  return {
    respectDirection: false,
    modelGroups: true,
    // Keep the solver's compact frame constraints. The final frame gets the
    // larger visual inset once its children have been locally aligned.
    groupPadding: 24,
    ...(needsCompactGrid(data) ? { gridSpacing: COMPACT_GRID_SPACING } : {}),
    ...overrides,
  };
}

function findConnectedComponents(data: LayoutData): ConnectedComponent[] {
  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  if (
    data.nodes.some(
      (node) => node.parentId !== undefined && nodeById.get(node.parentId)?.isGroup !== true
    ) ||
    data.edges.some(
      (edge) =>
        edge.start === undefined ||
        edge.end === undefined ||
        !nodeById.has(edge.start) ||
        !nodeById.has(edge.end)
    )
  ) {
    return [{ nodes: data.nodes, edges: data.edges }];
  }

  const neighbors = new Map<string, Set<string>>(
    data.nodes.map((node) => [node.id, new Set<string>()])
  );
  // A group's children may have no semantic edges, or edges may name the
  // frame rather than a child. Structural adjacency preserves both cases.
  for (const node of data.nodes) {
    if (node.parentId !== undefined) {
      neighbors.get(node.id)!.add(node.parentId);
      neighbors.get(node.parentId)!.add(node.id);
    }
  }
  for (const edge of data.edges) {
    neighbors.get(edge.start!)!.add(edge.end!);
    neighbors.get(edge.end!)!.add(edge.start!);
  }

  const remaining = new Set(data.nodes.map((node) => node.id));
  const components: ConnectedComponent[] = [];
  while (remaining.size > 0) {
    const first = remaining.values().next().value!;
    const ids = new Set([first]);
    const pending = [first];
    remaining.delete(first);

    for (const id of pending) {
      for (const neighbor of neighbors.get(id)!) {
        if (remaining.delete(neighbor)) {
          ids.add(neighbor);
          pending.push(neighbor);
        }
      }
    }

    components.push({
      nodes: data.nodes.filter((node) => ids.has(node.id)),
      edges: data.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!)),
    });
  }

  // Put the primary drawing first; otherwise a leading orphan can take the
  // top-left position and make the actual graph look secondary.
  return components.sort((left, right) => right.nodes.length - left.nodes.length);
}

function needsCompactGrid(data: LayoutData): boolean {
  return data.nodes.some(
    (node) => node.isGroup !== true && (node.height ?? 0) >= TALL_NODE_GRID_THRESHOLD
  );
}

function compactVacantGridRows(data: LayoutData, options: GridLikeOptions): void {
  // Moving leaves inside a frame would require fitting that frame again, so
  // retain the solver's frame layout for grouped diagrams.
  if (data.nodes.some((node) => node.isGroup === true)) {
    return;
  }

  const leaves = data.nodes.filter((node) => node.isGroup !== true);
  const rowTolerance = options.gridSpacing / 3;

  // Grid snapping can retain a whole unused grid lane after the force solve.
  // Remove it only when the node boxes on either side still keep the diagram's
  // requested rank clearance. Routes are generated after this pass.
  while (true) {
    const rows = gridRows(leaves, rowTolerance);
    let compacted = false;

    for (let index = 1; index < rows.length; index++) {
      const above = rows[index - 1];
      const below = rows[index];
      const centerDistance = below.center - above.center;
      const boxGap = below.top - above.bottom;
      if (centerDistance < options.gridSpacing * 1.5 || boxGap <= options.rankSpacing) {
        continue;
      }

      const shift = Math.min(options.gridSpacing, boxGap - options.rankSpacing);
      for (const node of leaves) {
        if (node.y! >= below.firstCenter - rowTolerance) {
          node.y! -= shift;
        }
      }
      compacted = true;
      break;
    }

    if (!compacted) {
      return;
    }
  }
}

function gridRows(nodes: Node[], tolerance: number) {
  const sorted = [...nodes].sort((left, right) => left.y! - right.y!);
  const rows: {
    center: number;
    firstCenter: number;
    top: number;
    bottom: number;
    nodes: Node[];
  }[] = [];

  for (const node of sorted) {
    const row = rows.at(-1);
    if (!row || node.y! - row.center > tolerance) {
      rows.push({
        center: node.y!,
        firstCenter: node.y!,
        top: node.y! - node.height! / 2,
        bottom: node.y! + node.height! / 2,
        nodes: [node],
      });
      continue;
    }

    row.nodes.push(node);
    row.center = row.nodes.reduce((sum, current) => sum + current.y!, 0) / row.nodes.length;
    row.top = Math.min(row.top, node.y! - node.height! / 2);
    row.bottom = Math.max(row.bottom, node.y! + node.height! / 2);
  }

  return rows;
}

function packComponents(components: ConnectedComponent[]): void {
  let nextLeft = 0;
  for (const component of components) {
    const bounds = componentBounds(component.nodes);
    const offsetX = nextLeft - bounds.left;
    const offsetY = -bounds.top;

    for (const node of component.nodes) {
      node.x! += offsetX;
      node.y! += offsetY;
    }

    nextLeft += bounds.right - bounds.left + COMPONENT_GUTTER;
  }
}

function componentBounds(nodes: Node[]): { left: number; right: number; top: number } {
  return nodes.reduce(
    (bounds, node) => ({
      left: Math.min(bounds.left, node.x! - node.width! / 2),
      right: Math.max(bounds.right, node.x! + node.width! / 2),
      top: Math.min(bounds.top, node.y! - node.height! / 2),
    }),
    { left: Infinity, right: -Infinity, top: Infinity }
  );
}

function combineResults(results: GridLikeLayoutResult[]): GridLikeLayoutResult {
  const first = results[0];
  return results.slice(1).reduce(
    (combined, result) => ({
      variableCount: combined.variableCount + result.variableCount,
      iterations: combined.iterations + result.iterations,
      stress: combined.stress + result.stress,
      alignments: combined.alignments + result.alignments,
      rejectedAlignments: combined.rejectedAlignments + result.rejectedAlignments,
      snapIterations: combined.snapIterations + result.snapIterations,
      objective: combined.objective + result.objective,
      options: combined.options,
    }),
    { ...first }
  );
}

export const render = createCommonLayoutRenderer<GridLikeLayoutResult>({
  runLayoutCore: runStressAndGridLayoutCore,
});
