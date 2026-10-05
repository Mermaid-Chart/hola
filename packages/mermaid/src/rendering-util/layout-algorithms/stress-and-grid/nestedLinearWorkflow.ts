import type { Edge, LayoutData, Node } from '../../types.js';

// This private workflow needs one routing lane, not a vacant grid cell, at
// each nesting level. Keep titles and a visible inset without compounding
// the ordinary frame padding through the whole hierarchy.
const PADDING = 24;
const SIBLING_GAP = 36;
const ROW_GAP = 48;
const BRANCH_GAP = 40;

/**
 * A private framed fork/merge can feed a nested linear workflow without
 * needing an independent stress-grid cell for every enclosing frame. Match
 * the complete topology first, then compact its columns bottom-up and reserve
 * labelled corridors between the three root frames. User port/length/direction
 * constraints and additional connections retain the ordinary stress solve.
 */
export function arrangeNestedLinearWorkflow(data: LayoutData): boolean {
  if (
    data.edges.some(
      (edge) =>
        edge.startSide !== undefined ||
        edge.endSide !== undefined ||
        (edge.minlen ?? 1) > 1 ||
        edge.isLayoutOnly === true
    ) ||
    data.nodes.some(
      (node) =>
        node.isDummy === true ||
        node.isEdgeLabel === true ||
        node.isLabelNode === true ||
        node.dir !== undefined ||
        (!node.isGroup && !['rect', 'squareRect'].includes(node.shape ?? ''))
    )
  ) {
    return false;
  }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const children = (frame: Node) => data.nodes.filter((node) => node.parentId === frame.id);
  const incoming = (node: Node) => data.edges.filter((edge) => edge.end === node.id);
  const outgoing = (node: Node) => data.edges.filter((edge) => edge.start === node.id);
  const leafAndFrame = (frame: Node): [Node, Node] | undefined => {
    const members = children(frame);
    const leaf = members.find((node) => !node.isGroup);
    const nested = members.find((node) => node.isGroup);
    return members.length === 2 && leaf && nested ? [leaf, nested] : undefined;
  };
  const singleLeaf = (frame: Node): Node | undefined => {
    const members = children(frame);
    return members.length === 1 && !members[0].isGroup ? members[0] : undefined;
  };
  const link = (source: Node, target: Node) =>
    data.edges.find((edge) => edge.start === source.id && edge.end === target.id);

  for (const handler of data.nodes.filter((node) => node.isGroup && !node.parentId)) {
    const members = children(handler);
    if (members.length !== 3 || members.some((node) => node.isGroup)) {
      continue;
    }
    const source = members.find(
      (node) =>
        outgoing(node).length === 2 &&
        outgoing(node).every((edge) => members.some((member) => member.id === edge.end))
    );
    if (!source || incoming(source).length !== 1) {
      continue;
    }
    const branches = outgoing(source).map((edge) => nodes.get(edge.end!)!);
    if (
      new Set(branches).size !== 2 ||
      branches.includes(source) ||
      branches.some((node) => outgoing(node).length !== 1 || incoming(node).length !== 1)
    ) {
      continue;
    }
    const merge = nodes.get(outgoing(branches[0])[0].end!);
    if (
      !merge ||
      merge.isGroup ||
      merge.parentId ||
      incoming(merge).length !== 2 ||
      outgoing(merge).length !== 1 ||
      outgoing(branches[1])[0].end !== merge.id
    ) {
      continue;
    }
    const entry = nodes.get(incoming(source)[0].start!);
    const nested = nodes.get(outgoing(merge)[0].end!);
    const outer = entry?.parentId ? nodes.get(entry.parentId) : undefined;
    if (
      !entry ||
      entry.isGroup ||
      !nested?.isGroup ||
      !outer?.isGroup ||
      outer.parentId ||
      nested.parentId !== outer.id ||
      children(outer).length !== 2
    ) {
      continue;
    }
    const nestedContents = leafAndFrame(nested);
    if (!nestedContents) {
      continue;
    }
    const [item, inner] = nestedContents;
    const key = singleLeaf(inner);
    const state = outgoing(inner).length === 1 ? nodes.get(outgoing(inner)[0].end!) : undefined;
    const update = key && outgoing(key).length === 1 ? nodes.get(outgoing(key)[0].end!) : undefined;
    const updateFrame = update?.parentId ? nodes.get(update.parentId) : undefined;
    const store = state?.parentId ? nodes.get(state.parentId) : undefined;
    const terminal =
      update && outgoing(update).length === 1 ? nodes.get(outgoing(update)[0].end!) : undefined;
    if (
      !key ||
      !state ||
      state.isGroup ||
      !update ||
      update.isGroup ||
      !updateFrame?.isGroup ||
      !store?.isGroup ||
      store.parentId ||
      updateFrame.parentId !== store.id ||
      !terminal ||
      terminal.isGroup ||
      terminal.parentId ||
      singleLeaf(updateFrame) !== update ||
      children(store).length !== 2 ||
      !link(item, inner)
    ) {
      continue;
    }

    const workflow = [
      handler,
      source,
      ...branches,
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
    ];
    const workflowNodes = new Set(workflow);
    const links = [
      link(entry, source),
      ...branches.map((node) => link(source, node)),
      ...branches.map((node) => link(node, merge)),
      link(merge, nested),
      link(item, inner),
      link(inner, state),
      link(key, update),
      link(update, terminal),
    ];
    // Matching all nodes and edges makes the pattern private: no unaccounted
    // neighbour can be displaced or have a formerly clear route obstructed.
    if (
      workflowNodes.size !== workflow.length ||
      workflowNodes.size !== data.nodes.length ||
      links.some((edge) => !edge) ||
      new Set(links).size !== data.edges.length ||
      [...outgoing(source), ...branches.flatMap(outgoing), ...outgoing(update)].some((edge) =>
        (edge.label ?? edge.text ?? '').trim()
      )
    ) {
      continue;
    }

    source.x = 0;
    source.y = 0;
    const [left, right] = branches;
    left.x = -(BRANCH_GAP + right.width!) / 2;
    right.x = (BRANCH_GAP + left.width!) / 2;
    left.y = right.y = source.height! / 2 + ROW_GAP + Math.max(left.height!, right.height!) / 2;
    fitFrame(handler, members);
    merge.x = 0;
    merge.y = handler.y! + handler.height! / 2 + ROW_GAP + merge.height! / 2;

    key.x = 0;
    key.y = 0;
    fitFrame(inner, [key]);
    item.x = 0;
    item.y =
      inner.y! -
      inner.height! / 2 -
      Math.max(ROW_GAP, (link(item, inner)!.height ?? 24) + 48) -
      item.height! / 2;
    fitFrame(nested, [item, inner]);
    entry.x = 0;
    entry.y = nested.y! - nested.height! / 2 - SIBLING_GAP - entry.height! / 2;
    fitFrame(outer, [entry, nested]);
    const outerNodes = [outer, entry, nested, item, inner, key];
    const entryGap = corridorGap([link(entry, source)!, link(merge, nested)!]);
    translate(
      outerNodes,
      handler.x! + handler.width! / 2 + entryGap + outer.width! / 2 - outer.x!,
      -entry.y
    );

    state.x = 0;
    state.y = inner.y;
    update.x = 0;
    update.y =
      state.y! +
      state.height! / 2 +
      SIBLING_GAP +
      (updateFrame.labelBBox?.height ?? 0) +
      PADDING +
      update.height! / 2;
    // The final horizontal bridge must clear the outer frame, not coincide
    // with its bottom border when a theme changes either node's height.
    update.y = Math.max(update.y, outer.y! + outer.height! / 2 + PADDING);
    fitFrame(updateFrame, [update]);
    fitFrame(store, [state, updateFrame]);
    const storeGap = corridorGap([link(inner, state)!, link(key, update)!]);
    translate(
      [store, state, updateFrame, update],
      outer.x! + outer.width! / 2 + storeGap + store.width! / 2 - store.x!,
      0
    );
    terminal.x = update.x;
    terminal.y = store.y! + store.height! / 2 + ROW_GAP + terminal.height! / 2;

    const ports = (edge: Edge, startSide: Edge['startSide'], endSide: Edge['endSide']) => {
      edge.startSide = startSide;
      edge.endSide = endSide;
    };
    ports(link(entry, source)!, 'left', 'right');
    for (const branch of branches) {
      ports(link(source, branch)!, 'bottom', 'top');
      ports(link(branch, merge)!, 'bottom', 'top');
    }
    ports(link(merge, nested)!, 'right', 'left');
    ports(link(item, inner)!, 'bottom', 'top');
    ports(link(inner, state)!, 'right', 'left');
    ports(link(key, update)!, 'right', 'left');
    ports(link(update, terminal)!, 'bottom', 'top');
    return true;
  }
  return false;
}

function corridorGap(edges: Edge[]): number {
  return Math.max(
    96,
    ...edges.map(
      (edge) => Math.max(edge.width ?? 0, (edge.label ?? edge.text ?? '').length * 8) + 2 * PADDING
    )
  );
}

function fitFrame(frame: Node, children: Node[]): void {
  const left = Math.min(...children.map((node) => node.x! - node.width! / 2));
  const right = Math.max(...children.map((node) => node.x! + node.width! / 2));
  const top = Math.min(...children.map((node) => node.y! - node.height! / 2));
  const bottom = Math.max(...children.map((node) => node.y! + node.height! / 2));
  const titleHeight = frame.labelBBox?.height ?? 0;
  frame.x = (left + right) / 2;
  frame.y = (top + bottom - titleHeight) / 2;
  frame.width = right - left + 2 * PADDING;
  frame.height = bottom - top + 2 * PADDING + titleHeight;
}

function translate(nodes: Node[], dx: number, dy: number): void {
  for (const node of nodes) {
    node.x! += dx;
    node.y! += dy;
  }
}
