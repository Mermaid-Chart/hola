import type { Edge, LayoutData, Node } from '../../types.js';
import { createCommonLayoutRenderer } from '../common/index.js';
import { runGridLikeLayoutCore, type GridLikeLayoutResult } from '../hola/grid/layoutCore.js';
import type { GridLikeOptions } from '../hola/grid/options.js';
import { routeStressAndGridEdges } from './routing.js';

const COMPONENT_GUTTER = 120;
const COMPACT_GRID_SPACING = 180;
const TALL_NODE_GRID_THRESHOLD = COMPACT_GRID_SPACING * 2;
const GROUP_FRAME_PADDING = 36;
const GROUP_ROW_GAP = 96;
const CYCLE_NODE_GAP = 32;
const FRAMED_CYCLE_BRIDGE_GAP = 96;

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
  // Components containing frames retain the shared solve because a frame can
  // represent containment not visible in the edge list.
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
    fitStressAndGridGroups(data4Layout, GROUP_FRAME_PADDING);
    alignSingleGroupExits(data4Layout);
    routeStressAndGridEdges(data4Layout, result.options.gridSpacing);
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
    fitStressAndGridGroups(componentData, GROUP_FRAME_PADDING);
    alignSingleGroupExits(componentData);
    return { componentData, result };
  });

  packComponents(results.map(({ componentData }) => componentData));
  for (const { componentData, result } of results) {
    routeStressAndGridEdges(componentData, result.options.gridSpacing);
  }

  return combineResults(results.map(({ result }) => result));
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
 * one block; the decision-to-frame clearance is therefore preserved.
 */
function compactOuterVerticalLanes(data: LayoutData): void {
  if (!data.nodes.some((node) => node.isGroup === true)) {
    return;
  }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const lanes = data.edges
    .map((edge) => ({
      source: edge.start ? nodes.get(edge.start) : undefined,
      target: edge.end ? nodes.get(edge.end) : undefined,
    }))
    .filter(
      (lane): lane is { source: Node; target: Node } =>
        !!lane.source &&
        !!lane.target &&
        !lane.source.parentId &&
        !lane.target.parentId &&
        Math.abs(lane.source.x! - lane.target.x!) <= 8 &&
        lane.target.y! > lane.source.y!
    )
    .sort((left, right) => left.source.y! - right.source.y!);

  for (const { source, target } of lanes) {
    const gap = target.y! - target.height! / 2 - (source.y! + source.height! / 2);
    const shift = GROUP_ROW_GAP - gap;
    if (shift >= 0) {
      continue;
    }
    const moved = data.nodes.filter((node) => node.isGroup !== true && node.y! >= target.y! - 1e-6);
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

    for (let index = 1; index < rows.length; index++) {
      const previous = rows[index - 1];
      const current = rows[index];
      const shift = compactRowShift(previous.nodes, current.nodes);
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

function compactRowShift(previous: Node[], current: Node[]): number {
  const requiredShifts = current.flatMap((node) =>
    previous
      .filter((candidate) => horizontalBoxesOverlap(candidate, node))
      .map(
        (candidate) =>
          candidate.y! + candidate.height! / 2 + GROUP_ROW_GAP - (node.y! - node.height! / 2)
      )
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

/** Refit group frames after the local grid-alignment pass moves their children. */
function fitStressAndGridGroups(data: LayoutData, padding: number): void {
  const nodesById = new Map(data.nodes.map((node) => [node.id, node]));
  const groups = data.nodes.filter((node) => node.isGroup === true);

  for (const group of groups) {
    const children = data.nodes.filter(
      (node) => node.isGroup !== true && isDescendantOf(node, group.id, nodesById)
    );
    if (children.length === 0) {
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

/** Keep a lone group exit adjacent to the stage it continues from. */
function alignSingleGroupExits(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  for (const edge of data.edges) {
    const source = edge.start ? nodes.get(edge.start) : undefined;
    const target = edge.end ? nodes.get(edge.end) : undefined;
    const group = source?.parentId ? nodes.get(source.parentId) : undefined;
    // This is an exit only when its target is genuinely outside every frame.
    // A link from one frame to another is a bridge between two independently
    // constrained layouts; pulling its target beside the source frame would
    // detach it from its own frame.
    if (!source || !target || !group?.isGroup || target.parentId) {
      continue;
    }
    const previous = { x: target.x!, y: target.y! };
    target.x = group.x! + group.width! / 2 + target.width! / 2 + GROUP_FRAME_PADDING;
    target.y = source.y;
    if (overlapsAnyLeaf(target, data.nodes)) {
      target.x = previous.x;
      target.y = previous.y;
    }
  }
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
  // Group membership is structural rather than an edge, so splitting it based
  // only on graph adjacency could detach a child from its containing frame.
  if (data.nodes.some((node) => node.isGroup === true)) {
    return [{ nodes: data.nodes, edges: data.edges }];
  }

  const nodeById = new Map(data.nodes.map((node) => [node.id, node]));
  if (
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
