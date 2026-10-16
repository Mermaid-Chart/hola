import type { Edge, LayoutData, Node } from '../../types.js';
import { captionDimensions } from './captionGeometry.js';
import {
  acceptLocalGeometryProposal,
  constrainedLocalEdge,
  measuredLocalNode,
} from './localProposal.js';

interface Fan {
  source: Node;
  branches: Node[];
  edges: Edge[];
  stem: Node[];
  stemEdges: Edge[];
  frame?: Node;
}

const GAP = 64;
const FRAME_PADDING = 36;
const LABEL_CLEARANCE = 12;
const EPSILON = 1e-6;

/**
 * A private three-way terminal decision has three independent corridors:
 * across-negative, forward, across-positive. Match topology, not node IDs or
 * label text, and keep explicit side/length/direction constraints untouched.
 * The optional linear stem and flat frame must belong entirely to this fan.
 */
function terminalFans(data: LayoutData): Fan[] {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  if (data.edges.some((edge) => !nodes.has(edge.start ?? '') || !nodes.has(edge.end ?? ''))) {
    return [];
  }
  const incoming = (node: Node) => data.edges.filter((edge) => edge.end === node.id);
  const outgoing = (node: Node) => data.edges.filter((edge) => edge.start === node.id);
  const fans: Fan[] = [];
  for (const source of data.nodes) {
    const edges = outgoing(source);
    if (
      source.isGroup ||
      !/^(diamond|rhombus|diam|question|decision)$/.test(source.shape ?? '') ||
      edges.length !== 3
    ) {
      continue;
    }
    const branches = edges.map((edge) => nodes.get(edge.end!)!);
    if (
      new Set(branches).size !== 3 ||
      branches.includes(source) ||
      branches.some(
        (node) =>
          node.isGroup ||
          node.parentId !== source.parentId ||
          !['rect', 'squareRect'].includes(node.shape ?? '') ||
          incoming(node).length !== 1 ||
          outgoing(node).length !== 0
      )
    ) {
      continue;
    }
    const stem: Node[] = [source];
    const stemEdges: Edge[] = [];
    let cursor = source;
    while (incoming(cursor).length === 1) {
      const edge = incoming(cursor)[0];
      const previous = nodes.get(edge.start!)!;
      if (
        previous.isGroup ||
        stem.includes(previous) ||
        previous.parentId !== source.parentId ||
        !['rect', 'squareRect', 'roundedRect', 'rounded'].includes(previous.shape ?? '') ||
        outgoing(previous).length !== 1
      ) {
        break;
      }
      stem.push(previous);
      stemEdges.push(edge);
      cursor = previous;
    }
    if (incoming(cursor).length !== 0) {
      continue;
    }
    const frame = source.parentId ? nodes.get(source.parentId) : undefined;
    const selected = new Set([...stem, ...branches]);
    if (
      source.parentId &&
      (!frame?.isGroup ||
        frame.parentId ||
        incoming(frame).length !== 0 ||
        outgoing(frame).length !== 0 ||
        data.nodes.filter((node) => node.parentId === frame.id).some((node) => !selected.has(node)))
    ) {
      continue;
    }
    if (
      [...selected, ...(frame ? [frame] : [])].some(
        (node) =>
          node.dir !== undefined ||
          node.isDummy === true ||
          node.isEdgeLabel === true ||
          node.isLabelNode === true ||
          !measuredLocalNode(node)
      ) ||
      [...edges, ...stemEdges].some(constrainedLocalEdge)
    ) {
      continue;
    }
    fans.push({ source, branches, edges, stem, stemEdges, frame });
  }
  return fans;
}

function axes(data: LayoutData): {
  along: 'x' | 'y';
  across: 'x' | 'y';
  alongSize: 'width' | 'height';
  acrossSize: 'width' | 'height';
  sign: number;
} {
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  return {
    along: horizontal ? 'x' : 'y',
    across: horizontal ? 'y' : 'x',
    alongSize: horizontal ? 'width' : 'height',
    acrossSize: horizontal ? 'height' : 'width',
    sign: data.direction === 'RL' || data.direction === 'BT' ? -1 : 1,
  };
}

export function arrangeCardinalDiamondFans(data: LayoutData): boolean {
  const { along, across, alongSize, acrossSize, sign } = axes(data);
  let changed = false;
  for (const { source, branches, edges, stem, stemEdges, frame } of terminalFans(data)) {
    if (!Number.isFinite(source.x) || !Number.isFinite(source.y)) {
      continue;
    }
    const selected = new Set([...stem, ...branches, ...(frame ? [frame] : [])]);
    const accepted = acceptLocalGeometryProposal(selected, () => {
      const lateralGap = Math.max(
        GAP,
        labelGap(edges[0], acrossSize),
        labelGap(edges[2], acrossSize)
      );
      branches.forEach((node, index) => {
        if (index === 1) {
          node[across] = source[across];
          node[along] =
            source[along]! +
            sign *
              ((source[alongSize]! + node[alongSize]!) / 2 +
                Math.max(GAP, labelGap(edges[index], alongSize)));
        } else {
          node[along] = source[along];
          node[across] =
            source[across]! +
            (index === 0 ? -1 : 1) * ((source[acrossSize]! + node[acrossSize]!) / 2 + lateralGap);
        }
      });
      for (let index = 1; index < stem.length; index++) {
        const predecessor = stem[index];
        const target = stem[index - 1];
        predecessor[across] = source[across];
        predecessor[along] =
          target[along]! -
          sign *
            ((predecessor[alongSize]! + target[alongSize]!) / 2 +
              Math.max(GAP, labelGap(stemEdges[index - 1], alongSize)));
      }
      if (frame) {
        fitFrame(frame, [...stem, ...branches]);
      }
      const obstacles = data.nodes.filter((node) => !selected.has(node));
      return ![...selected].some((node) =>
        obstacles.some(
          (obstacle) =>
            Math.abs(node.x! - obstacle.x!) - (node.width! + obstacle.width!) / 2 < 30 &&
            Math.abs(node.y! - obstacle.y!) - (node.height! + obstacle.height!) / 2 < 30
        )
      );
    });
    if (!accepted) {
      continue;
    }
    changed = true;
  }
  return changed;
}

/**
 * Only the matched cardinal fan gets vertex departures. All other diamonds
 * retain sloped-side midpoint/distributed ports. Compute after placement (and
 * component packing), so the same geometric rule serves browser and DDLT.
 */
export function cardinalDiamondFanPorts(data: LayoutData): Map<string, { x: number; y: number }> {
  const { along, across, alongSize, acrossSize, sign } = axes(data);
  const ports = new Map<string, { x: number; y: number }>();
  const point = (a: number, c: number) => (along === 'x' ? { x: a, y: c } : { x: c, y: a });
  for (const { source, branches, edges } of terminalFans(data)) {
    if (
      branches.some((node, index) =>
        index === 1
          ? Math.abs(node[across]! - source[across]!) > EPSILON ||
            sign * (node[along]! - source[along]!) <= (node[alongSize]! + source[alongSize]!) / 2
          : Math.abs(node[along]! - source[along]!) > EPSILON ||
            (index === 0 ? -1 : 1) * (node[across]! - source[across]!) <=
              (node[acrossSize]! + source[acrossSize]!) / 2
      )
    ) {
      continue;
    }
    branches.forEach((node, index) => {
      const lateralSign = index === 0 ? -1 : 1;
      const start =
        index === 1
          ? point(source[along]! + (sign * source[alongSize]!) / 2, source[across]!)
          : point(source[along]!, source[across]! + (lateralSign * source[acrossSize]!) / 2);
      const end =
        index === 1
          ? point(node[along]! - (sign * node[alongSize]!) / 2, node[across]!)
          : point(node[along]!, node[across]! - (lateralSign * node[acrossSize]!) / 2);
      ports.set(`${edges[index].id}:start`, start);
      ports.set(`${edges[index].id}:end`, end);
    });
  }
  return ports;
}

function labelGap(edge: Edge, size: 'width' | 'height'): number {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return 0;
  }
  return captionDimensions(label, edge, 'conservative')[size] + 2 * LABEL_CLEARANCE;
}

function fitFrame(frame: Node, members: Node[]): void {
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
