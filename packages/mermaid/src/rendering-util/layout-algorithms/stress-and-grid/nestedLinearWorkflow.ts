import type { Edge, LayoutData, Node } from '../../types.js';
import type { Point } from '../layout-utils/types.js';
import { captionDimensions } from './captionGeometry.js';
import {
  acceptLocalGeometryProposal,
  constrainedLocalEdge as constrained,
  measuredLocalNode as measured,
} from './localProposal.js';

// Private rows need routing lanes, not another vacant grid cell at each level.
const PADDING = 24;
const SIBLING_GAP = 36;
const ROW_GAP = 48;
const BRANCH_GAP = 40;
const LABEL_CLEARANCE = 14;
const LABEL_HEIGHT = 24;
const APPROACH = 20;
const PORT_SPACING = 24;
const CORNER_FRACTION = 0.16;
// Leave a little room for the hand-drawn painter's frame outline.
const EXTERNAL_CLEARANCE = 32;
const EPSILON = 1e-6;

interface Workflow {
  handler: Node;
  source: Node;
  branches: Node[];
  merge: Node;
  entry: Node;
  outer: Node;
  nested: Node;
  item: Node;
  inner: Node;
  key: Node;
  state: Node;
  update: Node;
  updateFrame: Node;
  store: Node;
  terminal: Node;
  chains: Node[][];
  columns: Node[][];
  members: Node[];
  links: Edge[];
  ancestors: Node[];
  nodes: Map<string, Node>;
}

interface Route {
  points: Point[];
  labelPoint?: Point;
}

interface Box extends Point {
  width: number;
  height: number;
}

interface PortPreference {
  startSide: NonNullable<Edge['startSide']>;
  endSide: NonNullable<Edge['endSide']>;
}

function descendant(node: Node, frame: Node, nodes: Map<string, Node>): boolean {
  const seen = new Set<string>();
  let parent = nodes.get(node.parentId ?? '');
  while (parent && !seen.has(parent.id)) {
    if (parent === frame) {
      return true;
    }
    seen.add(parent.id);
    parent = nodes.get(parent.parentId ?? '');
  }
  return false;
}

/**
 * Extract private chains and containment paths around a local fork/merge.
 * Frame endpoints remain semantic endpoints; containment never invents a link
 * to a frame's contents. Unknown active siblings keep the general layout.
 */
function workflows(data: LayoutData): Workflow[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  if (data.edges.some((edge) => !nodes.has(edge.start ?? '') || !nodes.has(edge.end ?? ''))) {
    return [];
  }
  const children = (frame: Node) => data.nodes.filter((node) => node.parentId === frame.id);
  const incoming = (node: Node) => data.edges.filter((edge) => edge.end === node.id);
  const outgoing = (node: Node) => data.edges.filter((edge) => edge.start === node.id);
  const link = (source: Node, target: Node) =>
    data.edges.find((edge) => edge.start === source.id && edge.end === target.id);
  const chainEndingAt = (last: Node): Node[] | undefined => {
    const chain: Node[] = [];
    let current: Node | undefined = last;
    while (current && !current.isGroup && !chain.includes(current)) {
      if (outgoing(current).length !== 1) {
        return;
      }
      chain.unshift(current);
      const inputs = incoming(current);
      if (!inputs.length) {
        return chain;
      }
      const previous = inputs.length === 1 ? nodes.get(inputs[0].start!) : undefined;
      if (!previous || previous.parentId !== last.parentId) {
        return;
      }
      current = previous;
    }
  };
  const chainStartingAt = (first: Node): Node[] | undefined => {
    const chain: Node[] = [];
    let current: Node | undefined = first;
    while (current && !current.isGroup && !chain.includes(current)) {
      if (incoming(current).length !== 1 || outgoing(current).length !== 1) {
        return;
      }
      chain.push(current);
      const next: Node = nodes.get(outgoing(current)[0].end!)!;
      if (next.parentId !== first.parentId) {
        return chain;
      }
      current = next;
    }
  };
  const subtree = (frame: Node) =>
    data.nodes.filter((node) => node === frame || descendant(node, frame, nodes));
  const spine = (root: Node, anchors: Node[]): Set<Node> => {
    const frames = new Set<Node>([root]);
    for (const anchor of anchors) {
      let current = anchor.isGroup ? anchor : nodes.get(anchor.parentId ?? '');
      while (current?.isGroup && !frames.has(current)) {
        frames.add(current);
        current = nodes.get(current.parentId ?? '');
      }
    }
    return frames;
  };
  const result: Workflow[] = [];

  for (const handler of data.nodes.filter((node) => node.isGroup)) {
    const members = children(handler);
    if (members.length < 3 || members.some((node) => node.isGroup)) {
      continue;
    }
    const source = members.find(
      (node) =>
        outgoing(node).length >= 2 &&
        outgoing(node).every((edge) => members.some((member) => member.id === edge.end))
    );
    if (!source || incoming(source).length !== 1) {
      continue;
    }
    const branches = outgoing(source)
      .map((edge) => nodes.get(edge.end!)!)
      .sort((a, b) => a.x! - b.x!);
    if (
      new Set(branches).size !== branches.length ||
      branches.length + 1 !== members.length ||
      branches.includes(source) ||
      branches.some((node) => outgoing(node).length !== 1 || incoming(node).length !== 1)
    ) {
      continue;
    }
    const context = handler.parentId;
    const merge = nodes.get(outgoing(branches[0])[0].end!);
    if (
      !merge ||
      merge.isGroup ||
      merge.parentId !== context ||
      incoming(merge).length !== branches.length ||
      outgoing(merge).length !== 1 ||
      branches.some((node) => outgoing(node)[0].end !== merge.id)
    ) {
      continue;
    }
    const entry = nodes.get(incoming(source)[0].start!);
    const nested = nodes.get(outgoing(merge)[0].end!);
    const outer = nodes.get(entry?.parentId ?? '');
    if (
      !entry ||
      entry.isGroup ||
      !nested?.isGroup ||
      !outer?.isGroup ||
      outer.parentId !== context ||
      !descendant(nested, outer, nodes)
    ) {
      continue;
    }
    const entryChain = chainEndingAt(entry);
    // The exporting frame is found by its real incident edges, not its depth
    // or a fixed number of children in the importing frame.
    const inner = subtree(nested).find(
      (node) => node.isGroup && incoming(node).length === 1 && outgoing(node).length === 1
    );
    const item = inner && nodes.get(incoming(inner)[0].start!);
    const itemChain = item && chainEndingAt(item);
    if (!entryChain || !inner || !item || !itemChain || item.parentId !== nested.id) {
      continue;
    }
    const key = children(inner).find((node) => {
      const outputs = outgoing(node);
      return (
        !node.isGroup && outputs.length === 1 && nodes.get(outputs[0].end!)!.parentId !== inner.id
      );
    });
    const keyChain = key && chainEndingAt(key);
    const state = outgoing(inner).length === 1 ? nodes.get(outgoing(inner)[0].end!) : undefined;
    const firstUpdate = key && nodes.get(outgoing(key)[0].end!);
    const updateChain = firstUpdate && chainStartingAt(firstUpdate);
    const update = updateChain?.at(-1);
    const updateFrame = nodes.get(firstUpdate?.parentId ?? '');
    const store = nodes.get(state?.parentId ?? '');
    const terminal =
      update && outgoing(update).length === 1 ? nodes.get(outgoing(update)[0].end!) : undefined;
    if (
      !key ||
      !keyChain ||
      !updateChain ||
      !state ||
      state.isGroup ||
      !update ||
      update.isGroup ||
      !updateFrame?.isGroup ||
      !store?.isGroup ||
      store.parentId !== context ||
      !descendant(updateFrame, store, nodes) ||
      !terminal ||
      terminal.isGroup ||
      terminal.parentId !== context ||
      !link(item, inner)
    ) {
      continue;
    }

    const chains = [entryChain, itemChain, keyChain, updateChain];
    const columns = [subtree(outer), subtree(store)];
    const coreLeaves = new Set([state, ...chains.flat()]);
    const coreFrames = new Set([
      ...spine(outer, [nested, inner, ...entryChain, ...itemChain, ...keyChain]),
      ...spine(store, [updateFrame, ...updateChain]),
    ]);
    if (
      columns
        .flat()
        .some((node) =>
          node.isGroup
            ? !coreFrames.has(node)
            : !coreLeaves.has(node) && (incoming(node).length > 0 || outgoing(node).length > 0)
        )
    ) {
      continue;
    }
    const selected = [handler, source, ...branches, merge, ...columns.flat(), terminal];
    const memberSet = new Set(selected);
    const links = [
      link(entry, source),
      ...branches.map((node) => link(source, node)),
      ...branches.map((node) => link(node, merge)),
      link(merge, nested),
      link(item, inner),
      link(inner, state),
      link(key, firstUpdate),
      link(update, terminal),
      ...chains.flatMap((chain) => chain.slice(1).map((node, index) => link(chain[index], node))),
    ];
    const ancestors: Node[] = [];
    let parentId = context;
    let parent = nodes.get(parentId ?? '');
    while (parent?.isGroup && !ancestors.includes(parent)) {
      ancestors.push(parent);
      parentId = parent.parentId;
      parent = nodes.get(parentId ?? '');
    }
    const known = new Set(links);
    if (
      parentId !== undefined ||
      (context !== undefined && !ancestors.length) ||
      memberSet.size !== selected.length ||
      links.some((edge) => !edge || constrained(edge)) ||
      [...selected, ...ancestors].some(
        (node) =>
          !measured(node) ||
          node.dir !== undefined ||
          node.isDummy === true ||
          node.isEdgeLabel === true ||
          node.isLabelNode === true ||
          (!node.isGroup && !['rect', 'squareRect'].includes(node.shape ?? ''))
      ) ||
      // Do not compress a many-way fan beyond the router's distinct port spacing.
      Math.min(source.width!, merge.width!) * (1 - 2 * CORNER_FRACTION) <
        PORT_SPACING * (branches.length - 1) ||
      data.edges.some(
        (edge) =>
          ((memberSet.has(nodes.get(edge.start!)!) || memberSet.has(nodes.get(edge.end!)!)) &&
            !known.has(edge)) ||
          ((ancestors.includes(nodes.get(edge.start!)!) ||
            ancestors.includes(nodes.get(edge.end!)!)) &&
            constrained(edge))
      )
    ) {
      continue;
    }
    result.push({
      handler,
      source,
      branches,
      merge,
      entry,
      outer,
      nested,
      item,
      inner,
      key,
      state,
      update,
      updateFrame,
      store,
      terminal,
      chains,
      columns,
      members: selected,
      links: links as Edge[],
      ancestors,
      nodes,
    });
  }
  return result;
}

function edgeBetween(workflow: Workflow, source: Node, target: Node): Edge {
  return workflow.links.find((edge) => edge.start === source.id && edge.end === target.id)!;
}

function labelSpan(edge: Edge, size: 'width' | 'height'): number {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return 0;
  }
  return captionDimensions(label, edge, 'renderer')[size];
}

// Outside lanes turn first; inside lanes turn farther from the fan's node.
// This retains port order without common trunks or crossings on either side.
function laneDepth(workflow: Workflow, branch: Node): number {
  const left = branch.x! < workflow.source.x! - EPSILON;
  const outside = workflow.branches.filter((other) =>
    left ? other.x! < branch.x! - EPSILON : other.x! > branch.x! + EPSILON
  ).length;
  return APPROACH + PORT_SPACING * outside;
}

function chainLinks(workflow: Workflow): Edge[] {
  return workflow.chains.flatMap((chain) =>
    chain.slice(1).map((node, index) => edgeBetween(workflow, chain[index], node))
  );
}

/** Measured frame entries stay in an open band, outside any wrapper headings. */
function frameEntryPlan(workflow: Workflow, ports?: Map<string, Point>): Route | undefined {
  const { item, inner, nested } = workflow;
  const edge = edgeBetween(workflow, item, inner);
  if (inner.parentId === nested.id) {
    const start = ports
      ? ports.get(edge.id + ':start')
      : { x: item.x!, y: item.y! + item.height! / 2 };
    const end = ports
      ? ports.get(edge.id + ':end')
      : { x: inner.x!, y: inner.y! - inner.height! / 2 };
    if (!start || !end) {
      return;
    }
    const lane = start.y + APPROACH;
    return {
      points: compact([start, { x: start.x, y: lane }, { x: end.x, y: lane }, end]),
      labelPoint: { x: end.x, y: (lane + end.y) / 2 },
    };
  }
  let wrapper = inner;
  while (wrapper.parentId !== nested.id) {
    wrapper = workflow.nodes.get(wrapper.parentId!)!;
  }
  const start = ports
    ? ports.get(edge.id + ':start')
    : { x: item.x! - item.width! / 2, y: item.y! };
  const end = ports ? ports.get(edge.id + ':end') : { x: inner.x! - inner.width! / 2, y: inner.y! };
  if (!start || !end) {
    return;
  }
  const lane =
    Math.min(start.x, wrapper.x! - wrapper.width! / 2) -
    Math.max(APPROACH, labelSpan(edge, 'width') / 2 + LABEL_CLEARANCE);
  return {
    points: [start, { x: lane, y: start.y }, { x: lane, y: end.y }, end],
    labelPoint: { x: lane, y: (item.y! + item.height! / 2 + wrapper.y! - wrapper.height! / 2) / 2 },
  };
}

function routeCount(workflow: Workflow): number {
  return workflow.links.length;
}

/** Pack measured private stages bottom-up, fitting every actual child. */
function placeColumn(workflow: Workflow, root: Node, order: Node[]): void {
  const members = workflow.columns.find((column) => column.includes(root))!;
  const rank = (node: Node) =>
    Math.min(
      ...order.flatMap((leaf, index) =>
        leaf === node || descendant(leaf, node, workflow.nodes) ? [index] : []
      )
    );
  const move = (node: Node, dy: number) =>
    translate(
      members.filter((member) => member === node || descendant(member, node, workflow.nodes)),
      0,
      dy
    );
  const pack = (frame: Node) => {
    const children = members.filter((node) => node.parentId === frame.id);
    const stages = children
      .filter((node) => Number.isFinite(rank(node)))
      .sort((a, b) => rank(a) - rank(b));
    for (const stage of stages) {
      if (stage.isGroup) {
        pack(stage);
      } else {
        stage.x = 0;
        stage.y = 0;
      }
    }
    for (let index = 1; index < stages.length; index++) {
      const previous = stages[index - 1];
      const stage = stages[index];
      const bridge = workflow.links.find(
        (edge) =>
          edge.start === previous.id &&
          (edge.end === stage.id ||
            descendant(workflow.nodes.get(edge.end!)!, stage, workflow.nodes))
      );
      const gap = bridge
        ? Math.max(
            ROW_GAP,
            labelSpan(bridge, 'height') + (stage.isGroup ? 48 : 2 * LABEL_CLEARANCE)
          )
        : SIBLING_GAP;
      move(stage, previous.y! + previous.height! / 2 + gap - (stage.y! - stage.height! / 2));
    }
    const chainCaptions = chainLinks(workflow).flatMap((edge) => {
      const from = workflow.nodes.get(edge.start!)!;
      const to = workflow.nodes.get(edge.end!)!;
      return from.parentId === frame.id && labelSpan(edge, 'width')
        ? [
            {
              x: from.x!,
              y: (from.y! + from.height! / 2 + to.y! - to.height! / 2) / 2,
              width: labelSpan(edge, 'width'),
              height: labelSpan(edge, 'height'),
            },
          ]
        : [];
    });
    // Unconnected private leaves get a side rail, never a vacant stage in the
    // chain. Active/off-spine siblings are rejected by extraction instead.
    const occupied = [...stages, ...chainCaptions];
    const fromLeft = [
      workflow.entry.parentId,
      workflow.item.parentId,
      workflow.state.parentId,
      workflow.chains[3][0].parentId,
    ].includes(frame.id);
    const border = fromLeft
      ? Math.max(...occupied.map((node) => node.x! + node.width! / 2))
      : Math.min(...occupied.map((node) => node.x! - node.width! / 2));
    let orphanY = stages[0].y!;
    for (const orphan of children.filter((node) => !stages.includes(node))) {
      orphan.x = border + (fromLeft ? 1 : -1) * (SIBLING_GAP + orphan.width! / 2);
      orphan.y = orphanY;
      orphanY += orphan.height! + SIBLING_GAP;
    }
    const entry = frame === workflow.nested ? frameEntryPlan(workflow) : undefined;
    const entryEdge = entry && edgeBetween(workflow, workflow.item, workflow.inner);
    const entryBand =
      entry && entryEdge
        ? [
            {
              ...entry.labelPoint!,
              width: labelSpan(entryEdge, 'width') + 2 * LABEL_CLEARANCE + 2 * PORT_SPACING,
              height: labelSpan(entryEdge, 'height') + 2 * LABEL_CLEARANCE,
            },
          ]
        : [];
    fitFrame(frame, [...children, ...chainCaptions, ...entryBand]);
  };
  pack(root);
}

/** General measured fork/merge row, independent of diagram identifiers and branch count. */
function placeFork(workflow: Workflow): void {
  const { source, branches, merge, handler } = workflow;
  const forkEdges = branches.map((node) => edgeBetween(workflow, source, node));
  const mergeEdges = branches.map((node) => edgeBetween(workflow, node, merge));
  const widths = branches.map((node, index) =>
    Math.max(
      node.width!,
      labelSpan(forkEdges[index], 'width'),
      labelSpan(mergeEdges[index], 'width')
    )
  );
  let x = 0;
  for (const [index, node] of branches.entries()) {
    node.x = x + widths[index] / 2;
    x += widths[index] + BRANCH_GAP;
  }
  const center =
    (Math.min(...branches.map((node) => node.x! - node.width! / 2)) +
      Math.max(...branches.map((node) => node.x! + node.width! / 2))) /
    2;
  source.x = 0;
  source.y = 0;
  for (const node of branches) {
    node.x! -= center;
  }
  // Do not leave a nearly central odd branch a few pixels off its axis.
  // Its outside neighbours already determine the row's symmetric extents.
  if (branches.length % 2 === 1) {
    const middle = branches[Math.floor(branches.length / 2)];
    if (Math.abs(middle.x!) < LABEL_CLEARANCE) {
      middle.x = source.x;
    }
  }
  const depth = Math.max(...branches.map((branch) => laneDepth(workflow, branch)));
  const gap = Math.max(
    ROW_GAP,
    ...forkEdges.map((edge) => labelSpan(edge, 'height') + 2 * LABEL_CLEARANCE + depth)
  );
  for (const node of branches) {
    node.y = source.height! / 2 + gap + Math.max(...branches.map((branch) => branch.height!)) / 2;
  }
  const captions = forkEdges.flatMap((edge, index) =>
    labelSpan(edge, 'width')
      ? [
          {
            x: branches[index].x!,
            y: source.height! / 2 + (depth + gap) / 2,
            width: labelSpan(edge, 'width'),
            height: labelSpan(edge, 'height'),
          },
        ]
      : []
  );
  // Merge-only captions also reserve horizontal bands alongside this frame.
  const projections = branches.map((node, index) => ({
    x: node.x!,
    y: node.y!,
    width: widths[index],
    height: 0,
  }));
  fitFrame(handler, [source, ...branches, ...captions, ...projections]);
  merge.x = source.x;
  merge.y =
    handler.y! +
    handler.height! / 2 +
    Math.max(
      ROW_GAP,
      ...mergeEdges.map((edge) => labelSpan(edge, 'height') + 2 * LABEL_CLEARANCE + depth)
    ) +
    merge.height! / 2;
}

/**
 * Compact each private region atomically, retaining unrelated solved content.
 * Explicit constraints apply locally, not as a whole-diagram veto.
 */
export function arrangeNestedLinearWorkflow(data: LayoutData): boolean {
  let changed = false;
  const acceptedWorkflows: Workflow[] = [];
  for (const workflow of workflows(data)) {
    const {
      handler,
      source,
      merge,
      entry,
      outer,
      nested,
      inner,
      state,
      update,
      updateFrame,
      store,
      terminal,
    } = workflow;
    const affected = [...workflow.members, ...workflow.ancestors];
    const accepted = acceptLocalGeometryProposal(affected, () => {
      const anchor = { x: source.x!, y: source.y! };
      placeFork(workflow);

      placeColumn(workflow, outer, workflow.chains.slice(0, 3).flat());
      const entryGap = corridorGap([
        edgeBetween(workflow, entry, source),
        edgeBetween(workflow, merge, nested),
      ]);
      translate(
        workflow.columns[0],
        handler.x! + handler.width! / 2 + entryGap + outer.width! / 2 - outer.x!,
        -entry.y!
      );

      placeColumn(workflow, store, [state, ...workflow.chains[3]]);
      translate(workflow.columns[1], 0, inner.y! - state.y!);
      const firstUpdate = workflow.chains[3][0];
      const updateRoot = workflow.columns[1].find(
        (node) =>
          node.isGroup &&
          node.parentId === store.id &&
          (node === updateFrame || descendant(updateFrame, node, workflow.nodes))
      )!;
      translate(
        workflow.columns[1].filter(
          (node) => node === updateRoot || descendant(node, updateRoot, workflow.nodes)
        ),
        0,
        Math.max(0, outer.y! + outer.height! / 2 + PADDING - firstUpdate.y!)
      );
      fitFrame(
        store,
        workflow.columns[1].filter((node) => node.parentId === store.id)
      );
      const storeGap = corridorGap([
        edgeBetween(workflow, inner, state),
        edgeBetween(workflow, workflow.key, firstUpdate),
      ]);
      translate(
        workflow.columns[1],
        outer.x! + outer.width! / 2 + storeGap + store.width! / 2 - store.x!,
        0
      );
      terminal.x = update.x;
      terminal.y =
        store.y! +
        store.height! / 2 +
        Math.max(
          ROW_GAP,
          labelSpan(edgeBetween(workflow, update, terminal), 'height') + 2 * LABEL_CLEARANCE
        ) +
        terminal.height! / 2;
      translate(workflow.members, anchor.x, anchor.y);

      // Only enclosing-context siblings can require a nearby free placement.
      // Standalone obstructed motifs keep their original stress solution.
      const members = new Set(workflow.members);
      const obstacles = data.nodes.filter(
        (node) => !members.has(node) && !workflow.ancestors.includes(node)
      );
      const candidates = [{ x: 0, y: 0 }];
      if (workflow.ancestors.length) {
        const left = Math.min(...workflow.members.map((node) => node.x! - node.width! / 2));
        const right = Math.max(...workflow.members.map((node) => node.x! + node.width! / 2));
        const top = Math.min(...workflow.members.map((node) => node.y! - node.height! / 2));
        const bottom = Math.max(...workflow.members.map((node) => node.y! + node.height! / 2));
        for (const obstacle of obstacles.filter(measured)) {
          candidates.push(
            { x: obstacle.x! + obstacle.width! / 2 + EXTERNAL_CLEARANCE - left, y: 0 },
            { x: obstacle.x! - obstacle.width! / 2 - EXTERNAL_CLEARANCE - right, y: 0 },
            { x: 0, y: obstacle.y! + obstacle.height! / 2 + EXTERNAL_CLEARANCE - top },
            { x: 0, y: obstacle.y! - obstacle.height! / 2 - EXTERNAL_CLEARANCE - bottom }
          );
        }
      }
      const positions = workflow.members.map((node) => ({ x: node.x!, y: node.y! }));
      return candidates
        .sort((a, b) => Math.hypot(a.x, a.y) - Math.hypot(b.x, b.y))
        .some((offset) => {
          workflow.members.forEach((node, index) => {
            node.x = positions[index].x + offset.x;
            node.y = positions[index].y + offset.y;
          });
          const reservations = [...acceptedWorkflows, workflow].map((candidate) => ({
            workflow: candidate,
            routes: plannedRoutes(candidate),
          }));
          for (const frame of workflow.ancestors) {
            fitFrame(frame, [
              ...data.nodes.filter((node) => node.parentId === frame.id),
              ...reservations
                .filter((reservation) => reservation.workflow.ancestors[0] === frame)
                .flatMap(({ workflow: candidate, routes }) => captions(candidate, routes)),
            ]);
          }
          return (
            affected.every(measured) &&
            !affected.some((node) =>
              data.nodes.some(
                (other) =>
                  node !== other &&
                  !descendant(node, other, workflow.nodes) &&
                  !descendant(other, node, workflow.nodes) &&
                  boxesTooClose(node, other)
              )
            ) &&
            reservations.every(({ workflow: candidate, routes }) =>
              safeRoutes(candidate, routes, data)
            ) &&
            reservationsSafe(reservations)
          );
        });
    });
    if (!accepted) {
      continue;
    }
    acceptedWorkflows.push(workflow);
    changed = true;
  }
  return changed;
}

function aligned(workflow: Workflow): boolean {
  const { source, branches, merge, entry, item, inner, key, update, terminal } = workflow;
  return (
    Math.abs(source.x! - merge.x!) <= EPSILON &&
    Math.abs(entry.y! - source.y!) <= EPSILON &&
    branches.every(
      (node) => Math.abs(node.y! - branches[0].y!) <= EPSILON && node.y! > source.y!
    ) &&
    merge.y! > Math.max(...branches.map((node) => node.y! + node.height! / 2)) &&
    Math.abs(item.x! - key.x!) <= EPSILON &&
    item.y! + item.height! / 2 < inner.y! - inner.height! / 2 &&
    Math.abs(update.x! - terminal.x!) <= EPSILON &&
    terminal.y! > update.y! &&
    update.x! > key.x!
  );
}

/** Inferred sides are routing preferences, never public/user constraint fields. */
export function nestedLinearWorkflowPorts(data: LayoutData): Map<string, PortPreference> {
  const preferences = new Map<string, PortPreference>();
  const reservations: { workflow: Workflow; routes: Map<string, Route> }[] = [];
  for (const workflow of workflows(data).filter(aligned)) {
    const routes = plannedRoutes(workflow);
    const reservation = { workflow, routes };
    if (!safeRoutes(workflow, routes, data) || !reservationsSafe([...reservations, reservation])) {
      continue;
    }
    reservations.push(reservation);
    const { source, branches, merge, entry, nested, item, inner, key, state, update, terminal } =
      workflow;
    const add = (
      from: Node,
      to: Node,
      startSide: PortPreference['startSide'],
      endSide: PortPreference['endSide']
    ) => preferences.set(edgeBetween(workflow, from, to).id, { startSide, endSide });
    add(entry, source, 'left', 'right');
    for (const branch of branches) {
      add(source, branch, 'bottom', 'top');
      add(branch, merge, 'bottom', 'top');
    }
    add(merge, nested, 'right', 'left');
    add(
      item,
      inner,
      inner.parentId === workflow.nested.id ? 'bottom' : 'left',
      inner.parentId === workflow.nested.id ? 'top' : 'left'
    );
    add(inner, state, 'right', 'left');
    add(key, workflow.chains[3][0], 'right', 'left');
    add(update, terminal, 'bottom', 'top');
    for (const edge of chainLinks(workflow)) {
      preferences.set(edge.id, { startSide: 'bottom', endSide: 'top' });
    }
  }
  return preferences;
}

/** Couple branch/tail routes to the measured caption bands after packing. */
export function nestedLinearWorkflowRoutes(
  data: LayoutData,
  ports: Map<string, Point>
): Map<string, Route> {
  const routes = new Map<string, Route>();
  const reservations: { workflow: Workflow; routes: Map<string, Route> }[] = [];
  for (const workflow of workflows(data).filter(aligned)) {
    const candidate = plannedRoutes(workflow, ports);
    const reservation = { workflow, routes: candidate };
    if (
      candidate.size !== routeCount(workflow) ||
      !safeRoutes(workflow, candidate, data) ||
      !reservationsSafe([...reservations, reservation])
    ) {
      continue;
    }
    reservations.push(reservation);
    for (const [id, route] of candidate) {
      routes.set(id, route);
    }
  }
  return routes;
}

/** One geometric plan for placement reservations and final allocated ports. */
function plannedRoutes(workflow: Workflow, ports?: Map<string, Point>): Map<string, Route> {
  const routes = new Map<string, Route>();
  const { source, merge, handler, update, terminal, store } = workflow;
  // Routing occurs after packing; neither edge insertion order nor the
  // original stress order determines a branch's current physical lane.
  const branches = [...workflow.branches].sort((a, b) => a.x! - b.x!);
  const depth = Math.max(...branches.map((branch) => laneDepth(workflow, branch)));
  const forkCaptionY =
    (source.y! +
      source.height! / 2 +
      depth +
      Math.min(...branches.map((branch) => branch.y! - branch.height! / 2))) /
    2;
  const joinCaptionY =
    (handler.y! + handler.height! / 2 + merge.y! - merge.height! / 2 - depth) / 2;
  for (const [index, branch] of branches.entries()) {
    const fork = edgeBetween(workflow, source, branch);
    const start = ports
      ? ports.get(fork.id + ':start')
      : {
          x: source.x! + (index - (branches.length - 1) / 2) * PORT_SPACING,
          y: source.y! + source.height! / 2,
        };
    const end = ports
      ? ports.get(fork.id + ':end')
      : { x: branch.x!, y: branch.y! - branch.height! / 2 };
    const join = edgeBetween(workflow, branch, merge);
    const joinStart = ports
      ? ports.get(join.id + ':start')
      : { x: branch.x!, y: branch.y! + branch.height! / 2 };
    const joinEnd = ports
      ? ports.get(join.id + ':end')
      : {
          x: merge.x! + (index - (branches.length - 1) / 2) * PORT_SPACING,
          y: merge.y! - merge.height! / 2,
        };
    if (!start || !end || !joinStart || !joinEnd) {
      continue;
    }
    const upperLane = source.y! + source.height! / 2 + laneDepth(workflow, branch);
    const lowerLane = joinEnd.y - laneDepth(workflow, branch);
    routes.set(fork.id, {
      points: compact([start, { x: start.x, y: upperLane }, { x: end.x, y: upperLane }, end]),
      labelPoint: { x: end.x, y: forkCaptionY },
    });
    routes.set(join.id, {
      points: compact([
        joinStart,
        { x: joinStart.x, y: lowerLane },
        { x: joinEnd.x, y: lowerLane },
        joinEnd,
      ]),
      labelPoint: { x: joinStart.x, y: joinCaptionY },
    });
  }
  const tail = edgeBetween(workflow, update, terminal);
  const start = ports
    ? ports.get(tail.id + ':start')
    : { x: update.x!, y: update.y! + update.height! / 2 };
  const end = ports
    ? ports.get(tail.id + ':end')
    : { x: terminal.x!, y: terminal.y! - terminal.height! / 2 };
  if (start && end) {
    routes.set(tail.id, {
      points: [start, end],
      labelPoint: { x: start.x, y: (store.y! + store.height! / 2 + end.y) / 2 },
    });
  }
  for (const edge of chainLinks(workflow)) {
    const from = workflow.nodes.get(edge.start!)!;
    const to = workflow.nodes.get(edge.end!)!;
    const start = ports
      ? ports.get(edge.id + ':start')
      : { x: from.x!, y: from.y! + from.height! / 2 };
    const end = ports ? ports.get(edge.id + ':end') : { x: to.x!, y: to.y! - to.height! / 2 };
    if (start && end) {
      routes.set(edge.id, {
        points: [start, end],
        labelPoint: { x: start.x, y: (start.y + end.y) / 2 },
      });
    }
  }
  const entry = frameEntryPlan(workflow, ports);
  if (entry) {
    routes.set(edgeBetween(workflow, workflow.item, workflow.inner).id, entry);
  }
  const ingressX =
    (handler.x! + handler.width! / 2 + workflow.outer.x! - workflow.outer.width! / 2) / 2;
  const input = edgeBetween(workflow, workflow.entry, source);
  const inputStart = ports
    ? ports.get(input.id + ':start')
    : { x: workflow.entry.x! - workflow.entry.width! / 2, y: workflow.entry.y! };
  const inputEnd = ports
    ? ports.get(input.id + ':end')
    : { x: source.x! + source.width! / 2, y: source.y! };
  if (inputStart && inputEnd) {
    routes.set(input.id, {
      points: [inputStart, inputEnd],
      labelPoint: { x: ingressX, y: inputEnd.y },
    });
  }
  const ingress = edgeBetween(workflow, merge, workflow.nested);
  const ingressStart = ports
    ? ports.get(ingress.id + ':start')
    : { x: merge.x! + merge.width! / 2, y: merge.y! };
  if (ingressStart) {
    // The semantic frame has a single unconstrained west attachment. Match
    // the incoming row when it lies on that side; otherwise use a full
    // approach to its nearest safe ordinate, never a near-corner stub.
    const end = {
      x: workflow.nested.x! - workflow.nested.width! / 2,
      y: Math.max(
        workflow.nested.y! - workflow.nested.height! / 2 + APPROACH,
        Math.min(workflow.nested.y! + workflow.nested.height! / 2 - APPROACH, ingressStart.y)
      ),
    };
    routes.set(ingress.id, {
      points: compact([
        ingressStart,
        { x: ingressX, y: ingressStart.y },
        { x: ingressX, y: end.y },
        end,
      ]),
      labelPoint: { x: ingressX, y: (ingressStart.y + end.y) / 2 },
    });
  }
  // Semantic bridges use the open gap between whole columns, not a caption
  // midpoint that can fall inside a widened ancestor or an isolated note.
  const bridgeX =
    (workflow.outer.x! +
      workflow.outer.width! / 2 +
      workflow.store.x! -
      workflow.store.width! / 2) /
    2;
  const stateEdge = edgeBetween(workflow, workflow.inner, workflow.state);
  const stateStart = ports
    ? ports.get(stateEdge.id + ':start')
    : { x: workflow.inner.x! + workflow.inner.width! / 2, y: workflow.inner.y! };
  const stateEnd = ports
    ? ports.get(stateEdge.id + ':end')
    : { x: workflow.state.x! - workflow.state.width! / 2, y: workflow.state.y! };
  if (stateStart && stateEnd) {
    routes.set(stateEdge.id, {
      points: [stateStart, stateEnd],
      labelPoint: { x: bridgeX, y: stateEnd.y },
    });
  }
  const firstUpdate = workflow.chains[3][0];
  const selection = edgeBetween(workflow, workflow.key, firstUpdate);
  const selectionStart = ports
    ? ports.get(selection.id + ':start')
    : { x: workflow.key.x! + workflow.key.width! / 2, y: workflow.key.y! };
  const selectionEnd = ports
    ? ports.get(selection.id + ':end')
    : { x: firstUpdate.x! - firstUpdate.width! / 2, y: firstUpdate.y! };
  if (selectionStart && selectionEnd) {
    const lane = workflow.outer.x! + workflow.outer.width! / 2 + APPROACH;
    routes.set(selection.id, {
      points: compact([
        selectionStart,
        { x: lane, y: selectionStart.y },
        { x: lane, y: selectionEnd.y },
        selectionEnd,
      ]),
      labelPoint: { x: bridgeX, y: selectionEnd.y },
    });
  }
  return routes;
}

function captions(workflow: Workflow, routes: Map<string, Route>): Box[] {
  return workflow.links.flatMap((edge) => {
    const point = routes.get(edge.id)?.labelPoint;
    return point && labelSpan(edge, 'width')
      ? [{ ...point, width: labelSpan(edge, 'width'), height: labelSpan(edge, 'height') }]
      : [];
  });
}

function box(node: Node): Box {
  return { x: node.x!, y: node.y!, width: node.width!, height: node.height! };
}

function tooClose(first: Box, second: Box, gap: number): boolean {
  return (
    Math.abs(first.x - second.x) < (first.width + second.width) / 2 + gap - EPSILON &&
    Math.abs(first.y - second.y) < (first.height + second.height) / 2 + gap - EPSILON
  );
}

function segmentHits(start: Point, end: Point, obstacle: Box, gap = 0): boolean {
  return (
    Math.max(start.x, end.x) > obstacle.x - obstacle.width / 2 - gap + EPSILON &&
    Math.min(start.x, end.x) < obstacle.x + obstacle.width / 2 + gap - EPSILON &&
    Math.max(start.y, end.y) > obstacle.y - obstacle.height / 2 - gap + EPSILON &&
    Math.min(start.y, end.y) < obstacle.y + obstacle.height / 2 + gap - EPSILON
  );
}

function safeRoutes(workflow: Workflow, routes: Map<string, Route>, data: LayoutData): boolean {
  if (routes.size !== routeCount(workflow) || !fanFits(workflow)) {
    return false;
  }
  const titles = data.nodes
    .filter((node) => node.isGroup && node.labelBBox?.width && node.labelBBox.height)
    .map((frame) => ({
      frame,
      x: frame.x!,
      y: frame.y! - frame.height! / 2 + frame.labelBBox!.height / 2,
      width: frame.labelBBox!.width,
      height: frame.labelBBox!.height,
    }));
  for (const edge of workflow.links.filter((edge) => routes.has(edge.id))) {
    const route = routes.get(edge.id)!;
    if (
      [...route.points, route.labelPoint!].some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      )
    ) {
      return false;
    }
    const source = workflow.nodes.get(edge.start!)!;
    const target = workflow.nodes.get(edge.end!)!;
    const obstacles = data.nodes.filter(
      (node) =>
        node !== source &&
        node !== target &&
        !descendant(source, node, workflow.nodes) &&
        !descendant(target, node, workflow.nodes)
    );
    for (let index = 1; index < route.points.length; index++) {
      const start = route.points[index - 1];
      const end = route.points[index];
      if (
        (Math.abs(start.x - end.x) > EPSILON && Math.abs(start.y - end.y) > EPSILON) ||
        obstacles.some((node) => !measured(node) || segmentHits(start, end, box(node), 4)) ||
        titles.some((title) => {
          // A top frame endpoint touches the heading's border, not its text.
          // Keep real title intersections forbidden, including wrapper titles.
          const terminalContact =
            title.frame === target &&
            index === route.points.length - 1 &&
            Math.abs(end.y - (target.y! - target.height! / 2)) <= EPSILON;
          return segmentHits(start, end, title, terminalContact ? 0 : 2);
        })
      ) {
        return false;
      }
    }
  }
  return captions(workflow, routes).every(
    (caption) =>
      !titles.some((title) => tooClose(caption, title, LABEL_CLEARANCE)) &&
      data.nodes.every((node) => {
        if (!measured(node)) {
          return false;
        }
        if (!node.isGroup) {
          return !tooClose(caption, box(node), LABEL_CLEARANCE);
        }
        const insetX = node.width! / 2 - Math.abs(caption.x - node.x!) - caption.width / 2;
        const insetY = node.height! / 2 - Math.abs(caption.y - node.y!) - caption.height / 2;
        return (
          !tooClose(caption, box(node), LABEL_CLEARANCE) ||
          Math.min(insetX, insetY) >= LABEL_CLEARANCE - EPSILON
        );
      })
  );
}

/** An off-center aligned branch may reserve the central port during allocation. */
function fanFits(workflow: Workflow): boolean {
  const branches = [...workflow.branches].sort((a, b) => a.x! - b.x!);
  return [workflow.source, workflow.merge].every((node) => {
    const centered = branches.findIndex((branch) => Math.abs(branch.x! - node.x!) <= EPSILON);
    const span =
      centered < 0
        ? (branches.length - 1) * PORT_SPACING
        : 2 * PORT_SPACING * Math.max(centered, branches.length - 1 - centered);
    return node.width! * (1 - 2 * CORNER_FRACTION) >= span - EPSILON;
  });
}

function segmentsConflict(a: Point, b: Point, c: Point, d: Point): boolean {
  const vertical = Math.abs(a.x - b.x) <= EPSILON;
  const otherVertical = Math.abs(c.x - d.x) <= EPSILON;
  if (vertical === otherVertical) {
    const along = vertical ? 'y' : 'x';
    const across = vertical ? 'x' : 'y';
    return (
      Math.abs(a[across] - c[across]) <= EPSILON &&
      Math.min(Math.max(a[along], b[along]), Math.max(c[along], d[along])) -
        Math.max(Math.min(a[along], b[along]), Math.min(c[along], d[along])) >
        EPSILON
    );
  }
  const [v1, v2, h1, h2] = vertical ? [a, b, c, d] : [c, d, a, b];
  return (
    v1.x >= Math.min(h1.x, h2.x) - EPSILON &&
    v1.x <= Math.max(h1.x, h2.x) + EPSILON &&
    h1.y >= Math.min(v1.y, v2.y) - EPSILON &&
    h1.y <= Math.max(v1.y, v2.y) + EPSILON
  );
}

/** Independent local plans must not reserve each other's caption corridors. */
function reservationsSafe(
  reservations: { workflow: Workflow; routes: Map<string, Route> }[]
): boolean {
  const planned = reservations.flatMap(({ workflow, routes }) =>
    workflow.links.flatMap((edge) => {
      const route = routes.get(edge.id);
      return route
        ? [{ edge, route, caption: captions(workflow, new Map([[edge.id, route]]))[0] }]
        : [];
    })
  );
  return (
    planned.every(
      ({ route }, index) =>
        !planned
          .slice(index + 1)
          .some((other) =>
            route.points.some(
              (point, segment, points) =>
                segment > 0 &&
                other.route.points.some(
                  (otherPoint, otherSegment, otherPoints) =>
                    otherSegment > 0 &&
                    segmentsConflict(
                      points[segment - 1],
                      point,
                      otherPoints[otherSegment - 1],
                      otherPoint
                    )
                )
            )
          )
    ) &&
    planned.every(
      ({ edge, caption }) =>
        !caption ||
        planned.every(
          (other) =>
            other.edge === edge ||
            ((!other.caption || !tooClose(caption, other.caption, LABEL_CLEARANCE)) &&
              other.route.points.every(
                (point, index, points) =>
                  index === 0 || !segmentHits(points[index - 1], point, caption, 2)
              ))
        )
    )
  );
}

function compact(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    if (
      result.length &&
      Math.hypot(point.x - result.at(-1)!.x, point.y - result.at(-1)!.y) <= EPSILON
    ) {
      continue;
    }
    result.push(point);
    while (result.length >= 3) {
      const [a, b, c] = result.slice(-3);
      if (
        (Math.abs(a.x - b.x) <= EPSILON && Math.abs(b.x - c.x) <= EPSILON) ||
        (Math.abs(a.y - b.y) <= EPSILON && Math.abs(b.y - c.y) <= EPSILON)
      ) {
        result.splice(-2, 1);
      } else {
        break;
      }
    }
  }
  return result;
}

function corridorGap(edges: Edge[]): number {
  return Math.max(96, ...edges.map((edge) => labelSpan(edge, 'width') + 2 * PADDING));
}

function fitFrame(
  frame: Node,
  children: { x?: number; y?: number; width?: number; height?: number }[]
): void {
  const left = Math.min(...children.map((node) => node.x! - node.width! / 2));
  const right = Math.max(...children.map((node) => node.x! + node.width! / 2));
  const top = Math.min(...children.map((node) => node.y! - node.height! / 2));
  const bottom = Math.max(...children.map((node) => node.y! + node.height! / 2));
  // Missing heading measurements must not collapse a frame's export row
  // onto its child's row. Positive renderer measurements stay authoritative.
  const titleHeight = (frame.labelBBox?.height ?? 0) > 0 ? frame.labelBBox!.height : LABEL_HEIGHT;
  frame.x = (left + right) / 2;
  frame.y = (top + bottom - titleHeight) / 2;
  frame.width = Math.max(right - left, frame.labelBBox?.width ?? 0) + 2 * PADDING;
  frame.height = bottom - top + 2 * PADDING + titleHeight;
}

function translate(nodes: Node[], dx: number, dy: number): void {
  for (const node of nodes) {
    node.x! += dx;
    node.y! += dy;
  }
}

function boxesTooClose(first: Node, second: Node): boolean {
  const gap = first.isGroup && second.isGroup ? 22 : EXTERNAL_CLEARANCE;
  return (
    Math.abs(first.x! - second.x!) < (first.width! + second.width!) / 2 + gap - EPSILON &&
    Math.abs(first.y! - second.y!) < (first.height! + second.height!) / 2 + gap - EPSILON
  );
}
