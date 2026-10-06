import type { Edge, LayoutData, Node } from '../../types.js';
import { captionDimensions } from './captionGeometry.js';
import {
  acceptLocalGeometryProposal,
  constrainedLocalEdge as constrained,
  measuredLocalNode as measured,
} from './localProposal.js';

const FRAME_PADDING = 36;
const CHAIN_GAP = 36;
// Allow for the painter's hand-drawn stroke as well as caption padding.
const LABEL_CLEARANCE = 14;
const EPSILON = 1e-6;

interface Point {
  x: number;
  y: number;
}

interface Box extends Point {
  width: number;
  height: number;
}

interface EntryRoute {
  points: Point[];
  labelPoint?: Point;
}

interface Row {
  nodes: Node[];
  edges: Edge[];
}

interface EntryPattern {
  outer: Node;
  inner: Node;
  sources: Row;
  targets: Row;
  entries: Edge[];
  innerTree: Node[];
  ancestors: Node[];
  nodes: Map<string, Node>;
}

function axes(data: LayoutData) {
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  return {
    chain: horizontal ? ('x' as const) : ('y' as const),
    entry: horizontal ? ('y' as const) : ('x' as const),
    chainSize: horizontal ? ('width' as const) : ('height' as const),
    entrySize: horizontal ? ('height' as const) : ('width' as const),
    sign: data.direction === 'RL' || data.direction === 'BT' ? -1 : 1,
  };
}

function compatible(node: Node): boolean {
  return (
    !node.isGroup &&
    !node.isDummy &&
    !node.isEdgeLabel &&
    !node.isLabelNode &&
    node.dir === undefined &&
    ['rect', 'squareRect', 'roundedRect', 'rounded', 'stadium'].includes(node.shape ?? '') &&
    measured(node)
  );
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

/** Extract private linear chains locally; component size is irrelevant. */
function privateRow(seeds: Node[], data: LayoutData, nodes: Map<string, Node>): Row | undefined {
  const chains = new Map<string, Node[]>();
  const links = data.edges.filter((edge) => {
    const source = nodes.get(edge.start ?? '');
    const target = nodes.get(edge.end ?? '');
    return (
      source &&
      target &&
      !source.isGroup &&
      !target.isGroup &&
      source.parentId === seeds[0]?.parentId &&
      target.parentId === source.parentId
    );
  });
  const incoming = (node: Node) => links.filter((edge) => edge.end === node.id);
  const outgoing = (node: Node) => links.filter((edge) => edge.start === node.id);
  for (const seed of seeds) {
    let first = seed;
    const seen = new Set<Node>();
    while (incoming(first).length === 1 && !seen.has(first)) {
      seen.add(first);
      first = nodes.get(incoming(first)[0].start!)!;
    }
    if (incoming(first).length !== 0) {
      return undefined;
    }
    const chain: Node[] = [];
    let current: Node | undefined = first;
    while (current && !chain.includes(current)) {
      if (!compatible(current) || incoming(current).length > 1 || outgoing(current).length > 1) {
        return undefined;
      }
      chain.push(current);
      current = nodes.get(outgoing(current)[0]?.end ?? '');
    }
    if (current) {
      return undefined;
    }
    chains.set(first.id, chain);
  }
  const { chain, sign } = axes(data);
  const ordered = [...chains.values()]
    .sort(
      (left, right) =>
        sign * (left[0][chain]! - right[0][chain]!) || left[0].id.localeCompare(right[0].id)
    )
    .flat();
  const ids = new Set(ordered.map((node) => node.id));
  return {
    nodes: ordered,
    edges: links.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!)),
  };
}

/**
 * Find nested entries and their incident private rows, not a whole-diagram
 * template. Unrelated children, other frames, chain lengths, and captions do
 * not determine eligibility. Explicit constraints and shared branches do.
 */
function nestedFrameEntries(data: LayoutData): EntryPattern[] {
  if (!['LR', 'RL', 'TB', 'BT'].includes(data.direction)) {
    return [];
  }
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const patterns: EntryPattern[] = [];
  for (const inner of data.nodes.filter((node) => node.isGroup && node.parentId)) {
    const outer = nodes.get(inner.parentId!);
    if (!outer?.isGroup) {
      continue;
    }
    const entries = data.edges.filter((edge) => {
      const source = nodes.get(edge.start ?? '');
      const target = nodes.get(edge.end ?? '');
      return (
        source &&
        target &&
        !source.isGroup &&
        source.parentId === outer.id &&
        (target === inner || (!target.isGroup && target.parentId === inner.id))
      );
    });
    if (!entries.length || new Set(entries.map((edge) => edge.start)).size !== entries.length) {
      continue;
    }
    const memberEntries = entries.filter((edge) => edge.end !== inner.id);
    if (new Set(memberEntries.map((edge) => edge.end)).size !== memberEntries.length) {
      continue;
    }
    const sources = privateRow(
      entries.map((edge) => nodes.get(edge.start!)!),
      data,
      nodes
    );
    const targets = privateRow(
      memberEntries.map((edge) => nodes.get(edge.end!)!),
      data,
      nodes
    );
    if (!sources || !targets) {
      continue;
    }
    const known = new Set([...entries, ...sources.edges, ...targets.edges]);
    const participants = new Set([...sources.nodes, ...targets.nodes, inner]);
    const innerTree = data.nodes.filter((node) => node === inner || descendant(node, inner, nodes));
    const tree = new Set(innerTree.map((node) => node.id));
    const ancestors: Node[] = [];
    let ancestor: Node | undefined = outer;
    while (ancestor?.isGroup && !ancestors.includes(ancestor)) {
      ancestors.push(ancestor);
      ancestor = nodes.get(ancestor.parentId ?? '');
    }
    if (
      ancestor ||
      [...participants, ...innerTree, ...ancestors].some(
        (node) => node.dir !== undefined || !measured(node)
      ) ||
      [...known].some(constrained) ||
      data.edges.some((edge) => {
        const source = nodes.get(edge.start ?? '');
        const target = nodes.get(edge.end ?? '');
        return (
          !source ||
          !target ||
          ((participants.has(source) || participants.has(target)) && !known.has(edge)) ||
          (tree.has(source.id) !== tree.has(target.id) && !entries.includes(edge)) ||
          ((ancestors.includes(source) || ancestors.includes(target)) && constrained(edge))
        );
      })
    ) {
      continue;
    }
    patterns.push({ outer, inner, sources, targets, entries, innerTree, ancestors, nodes });
  }
  return patterns;
}

/** Longest-path column constraints permit alignment without assuming two members. */
function columns(pattern: EntryPattern): Node[][] | undefined {
  const members = [...pattern.sources.nodes, ...pattern.targets.nodes];
  const parent = new Map(members.map((node) => [node.id, node.id]));
  const root = (id: string): string => {
    while (parent.get(id) !== id) {
      id = parent.get(id)!;
    }
    return id;
  };
  for (const edge of pattern.entries.filter((edge) => edge.end !== pattern.inner.id)) {
    parent.set(root(edge.end!), root(edge.start!));
  }
  const neighbours = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  for (const node of members) {
    neighbours.set(root(node.id), new Set());
    incomingCount.set(root(node.id), 0);
  }
  for (const row of [pattern.sources.nodes, pattern.targets.nodes]) {
    for (let index = 1; index < row.length; index++) {
      const before = root(row[index - 1].id);
      const after = root(row[index].id);
      if (before === after) {
        return undefined;
      }
      if (!neighbours.get(before)!.has(after)) {
        neighbours.get(before)!.add(after);
        incomingCount.set(after, incomingCount.get(after)! + 1);
      }
    }
  }
  const rank = new Map([...incomingCount.keys()].map((id) => [id, 0]));
  const ready = [...incomingCount.keys()].filter((id) => incomingCount.get(id) === 0);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    visited++;
    for (const next of neighbours.get(id)!) {
      rank.set(next, Math.max(rank.get(next)!, rank.get(id)! + 1));
      incomingCount.set(next, incomingCount.get(next)! - 1);
      if (!incomingCount.get(next)) {
        ready.push(next);
      }
    }
  }
  if (visited !== neighbours.size) {
    return undefined;
  }
  const result = Array.from({ length: Math.max(...rank.values()) + 1 }, () => [] as Node[]);
  for (const node of members) {
    result[rank.get(root(node.id))!].push(node);
  }
  return result;
}

/** Apply each local candidate atomically; never displace a foreign obstacle. */
export function arrangeNestedFrameEntry(data: LayoutData): boolean {
  let changed = false;
  const acceptedPatterns: EntryPattern[] = [];
  const { chain, entry, chainSize, entrySize, sign } = axes(data);
  for (const pattern of nestedFrameEntries(data)) {
    const bands = columns(pattern);
    if (!bands) {
      continue;
    }
    const affected = new Set([
      ...pattern.sources.nodes,
      ...pattern.innerTree,
      ...pattern.ancestors,
    ]);
    const accepted = acceptLocalGeometryProposal(affected, () => {
      const bandOf = new Map(
        bands.flatMap((band, index) => band.map((node) => [node.id, index] as const))
      );
      const chainEdges = [...pattern.sources.edges, ...pattern.targets.edges];
      const widths = bands.map((band) => Math.max(...band.map((node) => node[chainSize]!)));
      const captions = bands.map((band) =>
        Math.max(
          0,
          ...pattern.entries
            .filter((edge) => band.some((node) => node.id === edge.start))
            .map((edge) => labelSpan(edge, chainSize))
        )
      );
      const positions: number[] = [0];
      for (let index = 1; index < bands.length; index++) {
        let position =
          positions[index - 1] +
          Math.max(
            (widths[index - 1] + widths[index]) / 2 + CHAIN_GAP,
            (captions[index - 1] + captions[index]) / 2 + 2 * LABEL_CLEARANCE
          );
        for (const edge of chainEdges.filter((edge) => bandOf.get(edge.end!) === index)) {
          const source = pattern.nodes.get(edge.start!)!;
          const target = pattern.nodes.get(edge.end!)!;
          position = Math.max(
            position,
            positions[bandOf.get(source.id)!] +
              (source[chainSize]! + target[chainSize]!) / 2 +
              Math.max(CHAIN_GAP, labelSpan(edge, chainSize) + 2 * LABEL_CLEARANCE)
          );
        }
        positions.push(position);
      }
      const anchor = pattern.sources.nodes[0];
      const origin = anchor[chain]! - sign * positions[bandOf.get(anchor.id)!];
      const sourceRow = Math.min(...pattern.sources.nodes.map((node) => node[entry]!));
      const otherChildren = data.nodes.filter(
        (node) => node.parentId === pattern.inner.id && !pattern.targets.nodes.includes(node)
      );
      const targetRow = Math.min(
        pattern.targets.nodes[0]?.[entry] ?? pattern.inner[entry]!,
        ...otherChildren.map(
          (node) =>
            node[entry]! -
            node[entrySize]! / 2 -
            CHAIN_GAP -
            Math.max(0, ...pattern.targets.nodes.map((member) => member[entrySize]! / 2))
        )
      );
      for (const [index, band] of bands.entries()) {
        for (const node of band) {
          node[chain] = origin + sign * positions[index];
          node[entry] = pattern.sources.nodes.includes(node) ? sourceRow : targetRow;
        }
      }
      const chainRoutes = rowRoutes(pattern, data);
      const innerCaptions = captionBoxes(pattern.targets.edges, chainRoutes);
      const projections = pattern.entries
        .filter((edge) => edge.end === pattern.inner.id)
        .map((edge) => {
          const source = pattern.nodes.get(edge.start!)!;
          return { x: source.x!, y: source.y!, [entry]: targetRow, width: 0, height: 0 };
        });
      fitFrame(pattern.inner, [
        ...data.nodes.filter((node) => node.parentId === pattern.inner.id),
        ...innerCaptions,
        ...projections,
      ]);
      reserveEntryTitle(pattern, data);
      const sourceBorder = Math.max(
        ...pattern.sources.nodes.map((node) => node[entry]! + node[entrySize]! / 2),
        ...captionBoxes(pattern.sources.edges, chainRoutes).map(
          (box) => box[entry] + box[entrySize] / 2
        )
      );
      const gap = Math.max(
        CHAIN_GAP,
        ...pattern.entries.map((edge) => labelSpan(edge, entrySize) + 2 * LABEL_CLEARANCE)
      );
      const shift = sourceBorder + gap - (pattern.inner[entry]! - pattern.inner[entrySize]! / 2);
      for (const node of pattern.innerTree) {
        node[entry] = node[entry]! + shift;
      }
      // The initial solver can leave unrelated children inside the proposed
      // corridor. Try nearby rows around their boundaries, without moving them.
      // Every candidate includes ancestor refitting and is accepted atomically.
      const moving = [...pattern.sources.nodes, ...pattern.innerTree];
      const movingSet = new Set(moving);
      const initial = moving.map((node) => node[entry]!);
      const first = Math.min(...moving.map((node) => node[entry]! - node[entrySize]! / 2));
      const last = Math.max(...moving.map((node) => node[entry]! + node[entrySize]! / 2));
      const offsets = new Set([0]);
      for (const obstacle of data.nodes.filter(
        (node) => !movingSet.has(node) && !pattern.ancestors.includes(node) && measured(node)
      )) {
        const enclosing = pattern.ancestors.filter(
          (frame) => !descendant(obstacle, frame, pattern.nodes)
        );
        const inset = enclosing.reduce(
          (total, frame) =>
            total + FRAME_PADDING + (entry === 'y' ? (frame.labelBBox?.height ?? 0) : 0),
          30
        );
        offsets.add(obstacle[entry]! + obstacle[entrySize]! / 2 + inset - first);
        offsets.add(obstacle[entry]! - obstacle[entrySize]! / 2 - inset - last);
      }
      return [...offsets]
        .sort((left, right) => Math.abs(left) - Math.abs(right) || left - right)
        .some((offset) => {
          for (const [index, node] of moving.entries()) {
            node[entry] = initial[index] + offset;
          }
          const routes = patternRoutes(pattern, data);
          const reservations = [...acceptedPatterns, pattern].map((candidate) => {
            const candidateRoutes = candidate === pattern ? routes : patternRoutes(candidate, data);
            return {
              pattern: candidate,
              routes: candidateRoutes,
              boxes: captionBoxes(
                [...candidate.sources.edges, ...candidate.targets.edges, ...candidate.entries],
                candidateRoutes
              ),
            };
          });
          for (const ancestor of pattern.ancestors) {
            fitFrame(ancestor, [
              ...data.nodes.filter((node) => node.parentId === ancestor.id),
              ...reservations
                .filter((reservation) => reservation.pattern.outer === ancestor)
                .flatMap((reservation) => reservation.boxes),
            ]);
          }
          return (
            routes.size > 0 &&
            safeCandidate(pattern, routes, data, affected) &&
            reservationsSafe(reservations) &&
            reservations.every(
              (reservation) =>
                reservation.routes.size > 0 &&
                safeCandidate(reservation.pattern, reservation.routes, data)
            )
          );
        });
    });
    if (!accepted) {
      continue;
    }
    acceptedPatterns.push(pattern);
    changed = true;
  }
  return changed;
}

/** Keep centered frame titles away from every top-entry column. */
function reserveEntryTitle(pattern: EntryPattern, data: LayoutData): void {
  const { entry } = axes(data);
  const title = pattern.inner.labelBBox;
  if (entry !== 'y' || !title?.width || !title.height) {
    return;
  }
  const margin = title.width / 2 + LABEL_CLEARANCE;
  const ports = pattern.entries.map((edge) => pattern.nodes.get(edge.start!)!.x!);
  const center = pattern.inner.x!;
  const candidates = [center, ...ports.flatMap((x) => [x - margin, x + margin])];
  const clear = candidates
    .filter((x) => ports.every((port) => Math.abs(x - port) >= margin - EPSILON))
    .sort((left, right) => Math.abs(left - center) - Math.abs(right - center) || left - right)[0];
  // Grow only the side needed to shift the title; all prior contents and
  // projected ports keep their padding and coordinates.
  pattern.inner.width! += 2 * Math.abs(clear - center);
  pattern.inner.x = clear;
}

/** Re-derive routes from final coordinates after packing and later frame passes. */
export function nestedFrameEntryRoutes(data: LayoutData): Map<string, EntryRoute> {
  const routes = new Map<string, EntryRoute>();
  const reservations: { pattern: EntryPattern; routes: Map<string, EntryRoute> }[] = [];
  for (const pattern of nestedFrameEntries(data)) {
    const candidate = patternRoutes(pattern, data);
    const reservation = { pattern, routes: candidate };
    if (
      candidate.size &&
      safeCandidate(pattern, candidate, data) &&
      reservationsSafe([...reservations, reservation])
    ) {
      reservations.push(reservation);
      for (const [id, route] of candidate) {
        routes.set(id, route);
      }
    }
  }
  return routes;
}

/** Captions and paths must agree across independent local patterns too. */
function reservationsSafe(
  reservations: { pattern: EntryPattern; routes: Map<string, EntryRoute> }[]
): boolean {
  const planned = reservations.flatMap(({ pattern, routes }) =>
    [...pattern.sources.edges, ...pattern.targets.edges, ...pattern.entries].flatMap((edge) => {
      const route = routes.get(edge.id);
      return route ? [{ edge, route, caption: captionBoxes([edge], routes)[0] }] : [];
    })
  );
  return planned.every(
    ({ edge, caption }) =>
      !caption ||
      planned.every(
        (other) =>
          other.edge.id === edge.id ||
          ((!other.caption || !tooClose(caption, other.caption, LABEL_CLEARANCE)) &&
            !segmentHits(other.route.points[0], other.route.points[1], caption, 2))
      )
  );
}

function rowRoutes(pattern: EntryPattern, data: LayoutData): Map<string, EntryRoute> {
  const { chain, chainSize, sign } = axes(data);
  const routes = new Map<string, EntryRoute>();
  for (const edge of [...pattern.sources.edges, ...pattern.targets.edges]) {
    const source = pattern.nodes.get(edge.start!)!;
    const target = pattern.nodes.get(edge.end!)!;
    const start = { x: source.x!, y: source.y! };
    const end = { x: target.x!, y: target.y! };
    start[chain] += (sign * source[chainSize]!) / 2;
    end[chain] -= (sign * target[chainSize]!) / 2;
    routes.set(edge.id, {
      points: [start, end],
      labelPoint: { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 },
    });
  }
  return routes;
}

function patternRoutes(pattern: EntryPattern, data: LayoutData): Map<string, EntryRoute> {
  const { chain, entry, chainSize, entrySize, sign } = axes(data);
  const routes = rowRoutes(pattern, data);
  for (const edge of [...pattern.sources.edges, ...pattern.targets.edges]) {
    const source = pattern.nodes.get(edge.start!)!;
    const target = pattern.nodes.get(edge.end!)!;
    if (
      Math.abs(source[entry]! - target[entry]!) > EPSILON ||
      sign * (target[chain]! - source[chain]!) <
        (source[chainSize]! + target[chainSize]!) / 2 +
          Math.max(CHAIN_GAP, labelSpan(edge, chainSize) + 2 * LABEL_CLEARANCE) -
          EPSILON
    ) {
      return new Map();
    }
  }
  const border = Math.max(
    ...pattern.sources.nodes.map((node) => node[entry]! + node[entrySize]! / 2),
    ...captionBoxes(pattern.sources.edges, routes).map((box) => box[entry] + box[entrySize] / 2)
  );
  const frameBorder = pattern.inner[entry]! - pattern.inner[entrySize]! / 2;
  for (const edge of pattern.entries) {
    const source = pattern.nodes.get(edge.start!)!;
    const target = pattern.nodes.get(edge.end!)!;
    if (
      (target !== pattern.inner && Math.abs(source[chain]! - target[chain]!) > EPSILON) ||
      frameBorder - border <
        Math.max(CHAIN_GAP, labelSpan(edge, entrySize) + 2 * LABEL_CLEARANCE) - EPSILON ||
      source[chain]! <
        pattern.inner[chain]! - pattern.inner[chainSize]! / 2 + FRAME_PADDING - EPSILON ||
      source[chain]! >
        pattern.inner[chain]! + pattern.inner[chainSize]! / 2 - FRAME_PADDING + EPSILON
    ) {
      return new Map();
    }
    const start = { x: source.x!, y: source.y! };
    const end = { ...start };
    start[entry] += source[entrySize]! / 2;
    end[entry] = target[entry]! - target[entrySize]! / 2;
    routes.set(edge.id, {
      points: [start, end],
      labelPoint: { ...start, [entry]: (border + frameBorder) / 2 },
    });
  }
  return routes;
}

function captionBoxes(edges: Edge[], routes: Map<string, EntryRoute>): Box[] {
  return edges.flatMap((edge) => {
    const point = routes.get(edge.id)?.labelPoint;
    return point && (edge.label ?? edge.text ?? '').trim()
      ? [{ ...point, width: labelSpan(edge, 'width'), height: labelSpan(edge, 'height') }]
      : [];
  });
}

function box(node: Node): Box {
  return { x: node.x!, y: node.y!, width: node.width!, height: node.height! };
}

function tooClose(left: Box, right: Box, gap: number): boolean {
  return (
    Math.abs(left.x - right.x) < (left.width + right.width) / 2 + gap - EPSILON &&
    Math.abs(left.y - right.y) < (left.height + right.height) / 2 + gap - EPSILON
  );
}

function segmentHits(start: Point, end: Point, obstacle: Box, gap = 0): boolean {
  const left = obstacle.x - obstacle.width / 2 - gap;
  const right = obstacle.x + obstacle.width / 2 + gap;
  const top = obstacle.y - obstacle.height / 2 - gap;
  const bottom = obstacle.y + obstacle.height / 2 + gap;
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

function safeCandidate(
  pattern: EntryPattern,
  routes: Map<string, EntryRoute>,
  data: LayoutData,
  affected?: Set<Node>
): boolean {
  if (
    [...pattern.sources.nodes, ...pattern.innerTree, ...pattern.ancestors].some(
      (node) => !measured(node)
    ) ||
    [...routes.values()].some((route) =>
      [...route.points, ...(route.labelPoint ? [route.labelPoint] : [])].some(
        (point) => !Number.isFinite(point.x) || !Number.isFinite(point.y)
      )
    )
  ) {
    return false;
  }
  if (
    affected &&
    [...affected].some((node) =>
      data.nodes.some(
        (other) =>
          node !== other &&
          !descendant(node, other, pattern.nodes) &&
          !descendant(other, node, pattern.nodes) &&
          tooClose(box(node), box(other), node.isGroup && other.isGroup ? 20 : 30)
      )
    )
  ) {
    return false;
  }
  const edges = [...pattern.sources.edges, ...pattern.targets.edges, ...pattern.entries];
  const labels = edges.flatMap((edge) =>
    captionBoxes([edge], routes).map((caption) => ({ edge, caption }))
  );
  for (const edge of edges) {
    const route = routes.get(edge.id)!;
    const source = pattern.nodes.get(edge.start!)!;
    const target = pattern.nodes.get(edge.end!)!;
    const obstacles = data.nodes.filter(
      (node) =>
        node !== source &&
        node !== target &&
        !descendant(source, node, pattern.nodes) &&
        !descendant(target, node, pattern.nodes)
    );
    if (obstacles.some((node) => segmentHits(route.points[0], route.points[1], box(node), 4))) {
      return false;
    }
    if (
      labels.some(
        ({ edge: owner, caption }) =>
          owner !== edge && segmentHits(route.points[0], route.points[1], caption, 2)
      )
    ) {
      return false;
    }
    for (const frame of data.nodes.filter((node) => node.isGroup)) {
      const title = {
        x: frame.x!,
        y: frame.y! - frame.height! / 2 + (frame.labelBBox?.height ?? 0) / 2,
        width: frame.labelBBox?.width ?? 0,
        height: frame.labelBBox?.height ?? 0,
      };
      if (title.width && title.height && segmentHits(route.points[0], route.points[1], title, 2)) {
        return false;
      }
    }
  }
  return !labels.some(
    ({ caption }, index) =>
      labels.slice(index + 1).some((other) => tooClose(caption, other.caption, LABEL_CLEARANCE)) ||
      data.nodes.some((node) => {
        if (!node.isGroup) {
          return tooClose(caption, box(node), LABEL_CLEARANCE);
        }
        const frame = box(node);
        const insetX = frame.width / 2 - Math.abs(caption.x - frame.x) - caption.width / 2;
        const insetY = frame.height / 2 - Math.abs(caption.y - frame.y) - caption.height / 2;
        // A caption must be wholly inside or wholly outside a frame, with
        // clearance; merely not intersecting its title is insufficient.
        if (
          tooClose(caption, frame, LABEL_CLEARANCE) &&
          Math.min(insetX, insetY) < LABEL_CLEARANCE - EPSILON
        ) {
          return true;
        }
        const title = {
          x: node.x!,
          y: node.y! - node.height! / 2 + (node.labelBBox?.height ?? 0) / 2,
          width: node.labelBBox?.width ?? 0,
          height: node.labelBBox?.height ?? 0,
        };
        return title.width > 0 && title.height > 0 && tooClose(caption, title, LABEL_CLEARANCE);
      })
  );
}

function labelSpan(edge: Edge, size: 'width' | 'height'): number {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return 0;
  }
  return captionDimensions(label, edge, 'conservative')[size];
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
