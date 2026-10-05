import type { Edge, LayoutData, Node } from '../../types.js';

// Two 20px terminal approaches plus a separate 24px routing lane.
const FRAME_GRID_GAP = 64;
const NODE_CLEARANCE = 30;
const MEMBER_BRIDGE_GAP = 96;
const EXTERNAL_CYCLE_GAP = 36;
const ROUTE_CLEARANCE = 20;
const EPSILON = 1e-6;

interface Point {
  x: number;
  y: number;
}

interface ExternalFrameCycle {
  outer: Node;
  source: Node;
  target: Node;
  outside: Node;
  incoming: Edge;
  outgoing: Edge;
}

/**
 * Remove empty vertical bands after frames have been fitted. A root frame is
 * an atomic box here: every nested frame and leaf moves with it, so this never
 * closes internal label corridors or cuts through a containment tree. Routes
 * are generated afterwards.
 */
export function compactRootFrameBands(data: LayoutData, rankSpacing: number): void {
  if (!data.nodes.some((node) => node.isGroup)) {
    return;
  }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const owners = new Map<Node, Node>();
  for (const node of data.nodes) {
    let root = node;
    const seen = new Set<string>();
    while (root.parentId) {
      if (seen.has(root.id)) {
        return;
      }
      seen.add(root.id);
      const parent = nodes.get(root.parentId);
      if (!parent?.isGroup) {
        return;
      }
      root = parent;
    }
    owners.set(node, root);
  }
  const roots = [...new Set(owners.values())];
  if (roots.some((node) => !Number.isFinite(node.y) || !Number.isFinite(node.height))) {
    return;
  }
  roots.sort((a, b) => a.y! - a.height! / 2 - (b.y! - b.height! / 2));
  const bands: { top: number; bottom: number; roots: Node[] }[] = [];
  for (const root of roots) {
    const top = root.y! - root.height! / 2;
    const bottom = root.y! + root.height! / 2;
    const band = bands.at(-1);
    if (band && top <= band.bottom) {
      band.bottom = Math.max(band.bottom, bottom);
      band.roots.push(root);
    } else {
      bands.push({ top, bottom, roots: [root] });
    }
  }

  for (let index = 1; index < bands.length; index++) {
    const lowerBands = bands.slice(index);
    const movedRoots = new Set(lowerBands.flatMap((band) => band.roots));
    const crossingEdges = data.edges.filter((edge) => {
      const source = nodes.get(edge.start ?? '');
      const target = nodes.get(edge.end ?? '');
      return (
        source &&
        target &&
        movedRoots.has(owners.get(source)!) !== movedRoots.has(owners.get(target)!)
      );
    });
    // Keep deliberately extended or side-constrained routes at their solved
    // spacing. Malformed edges also make it unsafe to infer an empty corridor.
    if (
      data.edges.some((edge) => !nodes.has(edge.start ?? '') || !nodes.has(edge.end ?? '')) ||
      crossingEdges.some(
        (edge) =>
          (edge.minlen ?? 1) > 1 || edge.startSide !== undefined || edge.endSide !== undefined
      )
    ) {
      continue;
    }
    const labelSpace = crossingEdges.reduce((sum, edge) => {
      const label = (edge.label ?? edge.text ?? '').trim();
      if (!label) {
        return sum;
      }
      const lines = label.replace(/<br\s*\/?\s*>/giu, '\n').split('\n').length;
      return sum + Math.max(edge.height ?? 0, lines * 24) + 12;
    }, 0);
    // Member-to-member bridges need the wider corridor already reserved by
    // the framed-cycle pass; frame-level links need only ordinary grid space.
    const hasMemberBridge = crossingEdges.some((edge) => {
      const source = nodes.get(edge.start!)!;
      const target = nodes.get(edge.end!)!;
      return !source.isGroup && !target.isGroup && source.parentId && target.parentId;
    });
    const requiredGap = Math.max(
      hasMemberBridge ? MEMBER_BRIDGE_GAP : FRAME_GRID_GAP,
      rankSpacing,
      labelSpace + 40
    );
    const shift = bands[index].top - bands[index - 1].bottom - requiredGap;
    if (shift <= 0) {
      continue;
    }
    for (const node of data.nodes) {
      if (movedRoots.has(owners.get(node)!)) {
        node.y! -= shift;
      }
    }
    for (const band of lowerBands) {
      band.top -= shift;
      band.bottom -= shift;
    }
  }
}

/** Regularize existing rows of sibling frames without changing their contents. */
export function alignSiblingFrameRows(data: LayoutData): void {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const rootFrame = (node: Node): Node | undefined => {
    let root = node;
    while (root.parentId && nodes.has(root.parentId)) {
      root = nodes.get(root.parentId)!;
    }
    return root.isGroup ? root : undefined;
  };
  const owners = new Map(data.nodes.map((node) => [node, rootFrame(node)]));
  const frames = data.nodes
    .filter((node) => node.isGroup && !node.parentId)
    .sort((a, b) => a.y! - b.y! || a.x! - b.x! || a.id.localeCompare(b.id));
  const rows: Node[][] = [];
  for (const frame of frames) {
    const row = rows.find((members) => {
      const band = [...members, frame];
      const top = Math.max(...band.map((node) => node.y! - node.height! / 2));
      const bottom = Math.min(...band.map((node) => node.y! + node.height! / 2));
      return bottom - top >= Math.min(...band.map((node) => node.height!)) / 2;
    });
    if (row) {
      row.push(frame);
    } else {
      rows.push([frame]);
    }
  }

  for (const row of rows) {
    // A row needs at least two gaps to establish a shared spacing rhythm.
    if (row.length < 3) {
      continue;
    }
    row.sort((a, b) => a.x! - b.x! || a.id.localeCompare(b.id));
    const rowSet = new Set(row);
    const moved = data.nodes.filter((node) => rowSet.has(owners.get(node)!));
    const stationary = data.nodes.filter((node) => !moved.includes(node));
    const previous = moved.map((node) => ({ node, x: node.x!, y: node.y! }));
    const top = Math.min(...row.map((node) => node.y! - node.height! / 2));
    // Reserve the widest inter-frame label for every gap in this row.
    const gap = Math.max(
      FRAME_GRID_GAP,
      ...data.edges.flatMap((edge) => {
        const source = nodes.get(edge.start ?? '');
        const target = nodes.get(edge.end ?? '');
        const label = (edge.label ?? edge.text ?? '').trim();
        if (
          !source ||
          !target ||
          !label ||
          !rowSet.has(owners.get(source)!) ||
          !rowSet.has(owners.get(target)!) ||
          owners.get(source) === owners.get(target)
        ) {
          return [];
        }
        return [Math.max(edge.width ?? 0, label.length * 8, 40) + 24];
      })
    );
    let left = row[0].x! - row[0].width! / 2;
    for (const frame of row) {
      const dx = left + frame.width! / 2 - frame.x!;
      const dy = top + frame.height! / 2 - frame.y!;
      for (const node of moved.filter((node) => owners.get(node) === frame)) {
        node.x! += dx;
        node.y! += dy;
      }
      left += frame.width! + gap;
    }
    // Roll back the whole row if packing it would displace an unrelated node
    // or another row. Partial acceptance would reintroduce uneven spacing.
    if (row.some((frame) => stationary.some((node) => boxesNeedClearance(frame, node)))) {
      for (const { node, x, y } of previous) {
        Object.assign(node, { x, y });
      }
    }
  }
}

function boxesNeedClearance(a: Node, b: Node): boolean {
  const dx = Math.abs(a.x! - b.x!) - (a.width! + b.width!) / 2;
  const dy = Math.abs(a.y! - b.y!) - (a.height! + b.height!) / 2;
  return (dx < 0 && dy < NODE_CLEARANCE) || (dy < 0 && dx < NODE_CLEARANCE);
}

/**
 * Put a private outside cycle node in an outer band, perpendicular to its
 * two sibling frames. Only the outside node moves: their existing contents,
 * relative placement and ancestor bounds remain intact. Merely separating
 * the leaf from the nearest child frame can leave it too close to the ancestor
 * and make the router take a horizontal shortcut through the ancestor header.
 */
export function arrangeExternalSiblingFrameCycles(data: LayoutData): void {
  for (const cycle of externalFrameCycles(data)) {
    const { outer, source, target, outside } = cycle;
    const { along, across, acrossSize } = cycleAxes(cycle);
    const sign = outside[across]! < outer[across]! ? -1 : 1;
    const before = { x: outside.x, y: outside.y };
    outside[along] = (source[along]! + target[along]!) / 2;
    outside[across] =
      outer[across]! +
      sign * ((outer[acrossSize]! + outside[acrossSize]!) / 2 + EXTERNAL_CYCLE_GAP);
    if (
      data.nodes.some((node) => node !== outside && boxesNeedClearance(outside, node)) ||
      !externalCycleRoutes(cycle, data.nodes)
    ) {
      Object.assign(outside, before);
    }
  }
}

/** Derive the paired routes after packing; never retain absolute port coordinates. */
export function externalSiblingFrameCycleRoutes(data: LayoutData): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  for (const cycle of externalFrameCycles(data)) {
    const pair = externalCycleRoutes(cycle, data.nodes);
    if (pair) {
      routes.set(cycle.incoming.id, pair.incoming);
      routes.set(cycle.outgoing.id, pair.outgoing);
    }
  }
  return routes;
}

function externalFrameCycles(data: LayoutData): ExternalFrameCycle[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const cycles: ExternalFrameCycle[] = [];
  for (const outside of data.nodes) {
    if (
      outside.isGroup ||
      outside.parentId ||
      outside.isDummy ||
      outside.isEdgeLabel ||
      outside.isLabelNode ||
      !['rect', 'squareRect'].includes(outside.shape ?? '')
    ) {
      continue;
    }
    const incoming = data.edges.filter((edge) => edge.end === outside.id);
    const outgoing = data.edges.filter((edge) => edge.start === outside.id);
    if (incoming.length !== 1 || outgoing.length !== 1) {
      continue;
    }
    const source = nodes.get(incoming[0].start ?? '');
    const target = nodes.get(outgoing[0].end ?? '');
    const outer = nodes.get(source?.parentId ?? '');
    if (
      !source?.isGroup ||
      !target?.isGroup ||
      source === target ||
      source.parentId !== target.parentId ||
      !outer?.isGroup ||
      outer.parentId ||
      data.nodes.filter((node) => node.parentId === outer.id).length !== 2 ||
      [source, target, outer, outside].some(
        (node) =>
          node.dir !== undefined ||
          !Number.isFinite(node.x) ||
          !Number.isFinite(node.y) ||
          !Number.isFinite(node.width) ||
          !Number.isFinite(node.height) ||
          node.width! <= 0 ||
          node.height! <= 0
      )
    ) {
      continue;
    }
    const selected = new Set([source.id, target.id, outside.id]);
    const links = data.edges.filter(
      (edge) => selected.has(edge.start ?? '') || selected.has(edge.end ?? '')
    );
    if (
      links.length !== 3 ||
      !links.some((edge) => edge.start === target.id && edge.end === source.id) ||
      links.some(
        (edge) =>
          edge.startSide !== undefined ||
          edge.endSide !== undefined ||
          (edge.minlen ?? 1) > 1 ||
          edge.isLayoutOnly === true ||
          (edge.label ?? edge.text ?? '').trim()
      )
    ) {
      continue;
    }
    const ownerOf = (id: string): Node | undefined => {
      let node = nodes.get(id);
      const seen = new Set<string>();
      while (node && node !== source && node !== target && !seen.has(node.id)) {
        seen.add(node.id);
        node = nodes.get(node.parentId ?? '');
      }
      return node === source || node === target ? node : undefined;
    };
    // The two child trees must be private as well. Another member bridge or
    // exit can need the same outer lane and must retain the general router.
    if (
      data.edges.some(
        (edge) =>
          edge.start === outer.id ||
          edge.end === outer.id ||
          (!links.includes(edge) && ownerOf(edge.start ?? '') !== ownerOf(edge.end ?? ''))
      )
    ) {
      continue;
    }
    cycles.push({ outer, source, target, outside, incoming: incoming[0], outgoing: outgoing[0] });
  }
  return cycles;
}

function cycleAxes({ source, target }: ExternalFrameCycle) {
  const horizontal = Math.abs(source.x! - target.x!) >= Math.abs(source.y! - target.y!);
  return {
    along: horizontal ? ('x' as const) : ('y' as const),
    across: horizontal ? ('y' as const) : ('x' as const),
    alongSize: horizontal ? ('width' as const) : ('height' as const),
    acrossSize: horizontal ? ('height' as const) : ('width' as const),
  };
}

function externalCycleRoutes(cycle: ExternalFrameCycle, nodes: Node[]) {
  const { outer, source, target, outside } = cycle;
  const { along, across, alongSize, acrossSize } = cycleAxes(cycle);
  const span = target[along]! - source[along]!;
  const sign = outside[across]! < outer[across]! ? -1 : 1;
  if (
    Math.abs(outside[along]! - (source[along]! + target[along]!) / 2) > EPSILON ||
    Math.abs(outside[across]! - outer[across]!) - (outside[acrossSize]! + outer[acrossSize]!) / 2 <
      EXTERNAL_CYCLE_GAP - EPSILON ||
    Math.abs(span) / 2 - outside[alongSize]! / 2 < ROUTE_CLEARANCE ||
    Math.abs(span) - (source[alongSize]! + target[alongSize]!) / 2 < ROUTE_CLEARANCE
  ) {
    return undefined;
  }
  const sourcePort = { x: source.x!, y: source.y! };
  const targetPort = { x: target.x!, y: target.y! };
  sourcePort[across] += (sign * source[acrossSize]!) / 2;
  targetPort[across] += (sign * target[acrossSize]!) / 2;
  const incomingPort = { x: outside.x!, y: outside.y! };
  const outgoingPort = { ...incomingPort };
  incomingPort[along] -= (Math.sign(span) * outside[alongSize]!) / 2;
  outgoingPort[along] += (Math.sign(span) * outside[alongSize]!) / 2;
  const incoming = [sourcePort, { ...sourcePort, [across]: outside[across]! }, incomingPort];
  const outgoing = [outgoingPort, { ...targetPort, [across]: outside[across]! }, targetPort];
  // A necessary normal crossing of the ancestor must also avoid its title.
  if (
    across === 'y' &&
    sign < 0 &&
    [sourcePort, targetPort].some(
      (port) => Math.abs(port.x - outer.x!) < (outer.labelBBox?.width ?? 0) / 2 + 8
    )
  ) {
    return undefined;
  }
  for (const [points, endpoint] of [
    [incoming, source],
    [outgoing, target],
  ] as const) {
    const obstacles = nodes.filter(
      (node) => node !== outer && node !== outside && node !== endpoint
    );
    if (
      points
        .slice(1)
        .some((end, index) => obstacles.some((node) => segmentHitsBox(points[index], end, node)))
    ) {
      return undefined;
    }
  }
  return { incoming, outgoing };
}

function segmentHitsBox(start: Point, end: Point, node: Node): boolean {
  if (![node.x, node.y, node.width, node.height].every(Number.isFinite)) {
    return true;
  }
  const left = node.x! - node.width! / 2 - ROUTE_CLEARANCE;
  const right = node.x! + node.width! / 2 + ROUTE_CLEARANCE;
  const top = node.y! - node.height! / 2 - ROUTE_CLEARANCE;
  const bottom = node.y! + node.height! / 2 + ROUTE_CLEARANCE;
  return Math.abs(start.x - end.x) <= EPSILON
    ? start.x > left + EPSILON &&
        start.x < right - EPSILON &&
        Math.max(start.y, end.y) > top + EPSILON &&
        Math.min(start.y, end.y) < bottom - EPSILON
    : start.y > top + EPSILON &&
        start.y < bottom - EPSILON &&
        Math.max(start.x, end.x) > left + EPSILON &&
        Math.min(start.x, end.x) < right - EPSILON;
}
