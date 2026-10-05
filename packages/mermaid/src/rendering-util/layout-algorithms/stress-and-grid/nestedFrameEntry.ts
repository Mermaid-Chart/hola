import type { Edge, LayoutData, Node } from '../../types.js';

const FRAME_PADDING = 36;
const CHAIN_GAP = 36;
// The painter can expand a hand-drawn frame's bounds after routing. Leave a
// little extra room so its sketched stroke still has 12px of caption clearance.
const LABEL_CLEARANCE = 14;
const EPSILON = 1e-6;

interface Point {
  x: number;
  y: number;
}

interface EntryRoute {
  points: Point[];
  labelPoint?: Point;
}

/**
 * Recognize a complete private nested bridge: two outer chain members feed
 * an inner two-member chain, one at its entry and one at its frame. Matching
 * all nodes and links prevents a local straightening from displacing another
 * branch, ignoring explicit ports, or changing a constrained subgraph.
 */
function nestedFrameEntry(data: LayoutData) {
  if (
    data.nodes.length !== 6 ||
    data.edges.length !== 4 ||
    !['LR', 'RL', 'TB', 'BT'].includes(data.direction) ||
    data.nodes.some(
      (node) =>
        node.dir !== undefined ||
        node.isDummy === true ||
        node.isEdgeLabel === true ||
        node.isLabelNode === true ||
        (!node.isGroup && !['rect', 'squareRect'].includes(node.shape ?? '')) ||
        !Number.isFinite(node.x) ||
        !Number.isFinite(node.y) ||
        !Number.isFinite(node.width) ||
        !Number.isFinite(node.height) ||
        node.width! <= 0 ||
        node.height! <= 0
    ) ||
    data.edges.some(
      (edge) =>
        edge.startSide !== undefined ||
        edge.endSide !== undefined ||
        (edge.minlen ?? 1) > 1 ||
        edge.isLayoutOnly === true ||
        !Number.isFinite(edge.width ?? 0) ||
        !Number.isFinite(edge.height ?? 0)
    )
  ) {
    return undefined;
  }
  const frames = data.nodes.filter((node) => node.isGroup);
  const outer = frames.find((node) => !node.parentId);
  const inner = frames.find((node) => node.parentId === outer?.id);
  if (frames.length !== 2 || !outer || !inner) {
    return undefined;
  }
  const outerMembers = data.nodes.filter((node) => node.parentId === outer.id && !node.isGroup);
  const innerMembers = data.nodes.filter((node) => node.parentId === inner.id && !node.isGroup);
  if (outerMembers.length !== 2 || innerMembers.length !== 2) {
    return undefined;
  }
  const link = (start: Node, end: Node) =>
    data.edges.find((edge) => edge.start === start.id && edge.end === end.id);
  const outerLink =
    link(outerMembers[0], outerMembers[1]) ?? link(outerMembers[1], outerMembers[0]);
  const innerLink =
    link(innerMembers[0], innerMembers[1]) ?? link(innerMembers[1], innerMembers[0]);
  if (
    !outerLink ||
    !innerLink ||
    (outerLink.label ?? outerLink.text ?? '').trim() ||
    (innerLink.label ?? innerLink.text ?? '').trim()
  ) {
    return undefined;
  }
  const a = outerMembers.find((node) => node.id === outerLink.start)!;
  const b = outerMembers.find((node) => node.id === outerLink.end)!;
  const c = innerMembers.find((node) => node.id === innerLink.start)!;
  const d = innerMembers.find((node) => node.id === innerLink.end)!;
  const memberLink = link(a, c);
  const frameLink = link(b, inner);
  if (!memberLink || !frameLink) {
    return undefined;
  }
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  return {
    outer,
    inner,
    a,
    b,
    c,
    d,
    outerLink,
    innerLink,
    memberLink,
    frameLink,
    chain: horizontal ? ('x' as const) : ('y' as const),
    entry: horizontal ? ('y' as const) : ('x' as const),
    chainSize: horizontal ? ('width' as const) : ('height' as const),
    entrySize: horizontal ? ('height' as const) : ('width' as const),
    sign: data.direction === 'RL' || data.direction === 'BT' ? -1 : 1,
  };
}

/** Couple frame placement and entry lanes instead of repairing tiny port stubs. */
export function arrangeNestedFrameEntry(data: LayoutData): boolean {
  const pattern = nestedFrameEntry(data);
  if (!pattern) {
    return false;
  }
  const { outer, inner, a, b, c, d, chain, entry, chainSize, entrySize, sign } = pattern;
  const separation = Math.max(
    (a[chainSize]! + b[chainSize]!) / 2 +
      Math.max(CHAIN_GAP, labelSpan(pattern.outerLink, chainSize) + 2 * LABEL_CLEARANCE),
    (c[chainSize]! + d[chainSize]!) / 2 +
      Math.max(CHAIN_GAP, labelSpan(pattern.innerLink, chainSize) + 2 * LABEL_CLEARANCE),
    (labelSpan(pattern.memberLink, chainSize) + labelSpan(pattern.frameLink, chainSize)) / 2 +
      2 * LABEL_CLEARANCE
  );
  b[chain] = a[chain]! + sign * separation;
  b[entry] = a[entry];
  c[chain] = a[chain];
  d[chain] = b[chain];
  c[entry] = 0;
  d[entry] = 0;
  fitFrame(inner, [c, d]);

  const sourceBorder = Math.max(a[entry]! + a[entrySize]! / 2, b[entry]! + b[entrySize]! / 2);
  const gap = Math.max(
    CHAIN_GAP,
    labelSpan(pattern.memberLink, entrySize) + 2 * LABEL_CLEARANCE,
    labelSpan(pattern.frameLink, entrySize) + 2 * LABEL_CLEARANCE
  );
  const shift = sourceBorder + gap - (inner[entry]! - inner[entrySize]! / 2);
  for (const node of [inner, c, d]) {
    node[entry] = node[entry]! + shift;
  }
  // Include the captions when refitting the ancestor. A long measured label
  // must not escape its parent just because it is not itself a graph node.
  const routes = nestedFrameEntryRoutes(data);
  const captions = data.edges.flatMap((edge) => {
    const point = routes.get(edge.id)?.labelPoint;
    return point
      ? [{ ...point, width: labelSpan(edge, 'width'), height: labelSpan(edge, 'height') }]
      : [];
  });
  fitFrame(outer, [a, b, inner, ...captions]);
  return true;
}

/**
 * Return routes only when placement has actually reserved this corridor.
 * Label coordinates are derived after component packing, never cached in
 * absolute space. Both entry captions stay outside the nested frame, even
 * when the member edge's geometric midpoint lies inside it.
 */
export function nestedFrameEntryRoutes(data: LayoutData): Map<string, EntryRoute> {
  const routes = new Map<string, EntryRoute>();
  const pattern = nestedFrameEntry(data);
  if (!pattern) {
    return routes;
  }
  const { inner, a, b, c, d, chain, entry, chainSize, entrySize, sign } = pattern;
  const sourceBorder = Math.max(a[entry]! + a[entrySize]! / 2, b[entry]! + b[entrySize]! / 2);
  const frameBorder = inner[entry]! - inner[entrySize]! / 2;
  const requiredGap = Math.max(
    CHAIN_GAP,
    labelSpan(pattern.memberLink, entrySize) + 2 * LABEL_CLEARANCE,
    labelSpan(pattern.frameLink, entrySize) + 2 * LABEL_CLEARANCE
  );
  if (
    Math.abs(a[entry]! - b[entry]!) > EPSILON ||
    Math.abs(c[entry]! - d[entry]!) > EPSILON ||
    Math.abs(a[chain]! - c[chain]!) > EPSILON ||
    Math.abs(b[chain]! - d[chain]!) > EPSILON ||
    sign * (b[chain]! - a[chain]!) <= (a[chainSize]! + b[chainSize]!) / 2 ||
    frameBorder - sourceBorder < requiredGap - EPSILON
  ) {
    return routes;
  }
  for (const [source, target, edge] of [
    [a, b, pattern.outerLink],
    [c, d, pattern.innerLink],
  ] as const) {
    const start = { x: source.x!, y: source.y! };
    const end = { x: target.x!, y: target.y! };
    start[chain] += (sign * source[chainSize]!) / 2;
    end[chain] -= (sign * target[chainSize]!) / 2;
    routes.set(edge.id, { points: [start, end] });
  }
  for (const [source, target, edge] of [
    [a, c, pattern.memberLink],
    [b, inner, pattern.frameLink],
  ] as const) {
    const start = { x: source.x!, y: source.y! };
    const end = { x: source.x!, y: source.y! };
    start[entry] += source[entrySize]! / 2;
    end[entry] = target[entry]! - target[entrySize]! / 2;
    const labelPoint = { ...start, [entry]: (sourceBorder + frameBorder) / 2 };
    routes.set(edge.id, { points: [start, end], labelPoint });
  }
  return routes;
}

function labelSpan(edge: Edge, size: 'width' | 'height'): number {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return 0;
  }
  const lines = label
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .split('\n');
  return Math.max(
    edge[size] ?? 0,
    size === 'width'
      ? Math.max(40, ...lines.map((line) => line.trim().length * 8))
      : lines.length * 24
  );
}

function fitFrame(
  frame: Node,
  members: { x?: number; y?: number; width?: number; height?: number }[]
): void {
  const left = Math.min(...members.map((node) => node.x! - node.width! / 2));
  const right = Math.max(...members.map((node) => node.x! + node.width! / 2));
  const top = Math.min(...members.map((node) => node.y! - node.height! / 2));
  const bottom = Math.max(...members.map((node) => node.y! + node.height! / 2));
  const titleHeight = frame.labelBBox?.height ?? 0;
  frame.x = (left + right) / 2;
  frame.y = (top + bottom - titleHeight) / 2;
  frame.width = Math.max(right - left, frame.labelBBox?.width ?? 0) + 2 * FRAME_PADDING;
  frame.height = bottom - top + titleHeight + 2 * FRAME_PADDING;
}
