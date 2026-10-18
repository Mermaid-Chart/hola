import type { Edge, LayoutData, Node } from '../../types.js';
import { captionDimensions } from './captionGeometry.js';
import {
  acceptLocalGeometryProposal,
  constrainedLocalEdge,
  measuredLocalNode,
} from './localProposal.js';

const FRAME_PADDING = 36;
const CHAIN_GAP = 36;
const LABEL_CLEARANCE = 12;
const PORT_HALF_SPAN = 12;

/**
 * Place a private terminal fork as a single unit, not as two independent
 * near-axis edges. Its flat root frame contains a linear entry chain and two
 * terminal children; a single outside decision feeds that chain. The entry
 * chain runs across the flow direction, leaving the fork a symmetric forward
 * row. An arbitrary-length private predecessor chain follows the decision.
 *
 * Match the complete frame and all incident connections before moving it.
 * Constrained, reconverging, nested, or obstructed workflows keep the solve.
 */
export function arrangeTerminalFrameFan(data: LayoutData): boolean {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  if (data.edges.some((edge) => !nodes.has(edge.start ?? '') || !nodes.has(edge.end ?? ''))) {
    return false;
  }
  const incoming = (node: Node) => data.edges.filter((edge) => edge.end === node.id);
  const outgoing = (node: Node) => data.edges.filter((edge) => edge.start === node.id);
  const rectangular = (node: Node) => ['rect', 'squareRect'].includes(node.shape ?? '');
  const horizontal = data.direction === 'LR' || data.direction === 'RL';
  const along = horizontal ? 'x' : 'y';
  const across = horizontal ? 'y' : 'x';
  const alongSize = horizontal ? 'width' : 'height';
  const acrossSize = horizontal ? 'height' : 'width';
  const sign = data.direction === 'BT' || data.direction === 'RL' ? -1 : 1;
  let changed = false;

  for (const frame of data.nodes.filter((node) => node.isGroup && !node.parentId)) {
    const members = data.nodes.filter((node) => node.parentId === frame.id);
    if (
      members.length < 4 ||
      members.some((node) => node.isGroup || !rectangular(node)) ||
      incoming(frame).length ||
      outgoing(frame).length
    ) {
      continue;
    }
    const fork = members.find((node) => outgoing(node).length === 2);
    if (!fork) {
      continue;
    }
    const branchEdges = outgoing(fork);
    const branches = branchEdges.map((edge) => nodes.get(edge.end!)!);
    if (
      new Set(branches).size !== 2 ||
      branches.includes(fork) ||
      branches.some(
        (node) =>
          !members.includes(node) || incoming(node).length !== 1 || outgoing(node).length !== 0
      )
    ) {
      continue;
    }

    const chain = [fork];
    const links: Edge[] = [...branchEdges];
    let cursor = fork;
    while (incoming(cursor).length === 1) {
      const edge = incoming(cursor)[0];
      const previous = nodes.get(edge.start!)!;
      links.push(edge);
      if (!members.includes(previous)) {
        break;
      }
      if (
        chain.includes(previous) ||
        branches.includes(previous) ||
        outgoing(previous).length !== 1
      ) {
        break;
      }
      chain.unshift(previous);
      cursor = previous;
    }
    if (new Set([...chain, ...branches]).size !== members.length || incoming(cursor).length !== 1) {
      continue;
    }
    const entryEdge = incoming(cursor)[0];
    const decision = nodes.get(entryEdge.start!)!;
    if (
      decision.parentId ||
      decision.isGroup ||
      !/^(diamond|rhombus|diam|question|decision)$/.test(decision.shape ?? '') ||
      outgoing(decision).length !== 1
    ) {
      continue;
    }
    const predecessors = [decision];
    let predecessor = decision;
    while (incoming(predecessor).length === 1) {
      const edge = incoming(predecessor)[0];
      const previous = nodes.get(edge.start!)!;
      if (
        previous.isGroup ||
        predecessors.includes(previous) ||
        previous.parentId ||
        !rectangular(previous) ||
        outgoing(previous).length !== 1
      ) {
        break;
      }
      links.push(edge);
      predecessors.push(previous);
      predecessor = previous;
    }
    if (incoming(predecessor).length !== 0) {
      continue;
    }
    const selected = new Set([frame, ...members, ...predecessors]);
    const selectedLinks = new Set(links);
    if (
      links.some(constrainedLocalEdge) ||
      [...selected].some(
        (node) =>
          node.dir !== undefined ||
          node.isDummy === true ||
          node.isEdgeLabel === true ||
          node.isLabelNode === true ||
          !measuredLocalNode(node)
      ) ||
      !Number.isFinite(cursor.x) ||
      !Number.isFinite(cursor.y) ||
      data.edges.some(
        (edge) =>
          (selected.has(nodes.get(edge.start!)!) || selected.has(nodes.get(edge.end!)!)) &&
          !selectedLinks.has(edge)
      )
    ) {
      continue;
    }

    const accepted = acceptLocalGeometryProposal(selected, () => {
      const row = cursor[along]!;
      for (let index = 1; index < chain.length; index++) {
        const source = chain[index - 1];
        const target = chain[index];
        const edge = incoming(target)[0];
        target[along] = row;
        target[across] =
          source[across]! +
          (source[acrossSize]! + target[acrossSize]!) / 2 +
          Math.max(CHAIN_GAP, labelSpan(edge, acrossSize) + 2 * LABEL_CLEARANCE);
      }
      const halfSpan = Math.max(
        (branches[0][acrossSize]! + branches[1][acrossSize]!) / 4 + 20,
        fork[acrossSize]! / 2 + 40,
        ...branchEdges.map(
          (edge) => labelSpan(edge, acrossSize) + 2 * LABEL_CLEARANCE + PORT_HALF_SPAN
        )
      );
      const rowGap = Math.max(
        48,
        ...branchEdges.map((edge) => labelSpan(edge, alongSize) + 48),
        // A wider entry node can project farther into the fork's forward row
        // than the fork itself, especially when the direction is horizontal.
        Math.max(...chain.map((node) => node[alongSize]!)) / 2 - fork[alongSize]! / 2 + CHAIN_GAP,
        halfSpan +
          24 -
          fork[alongSize]! / 2 -
          Math.min(...branches.map((node) => node[alongSize]!)) / 2
      );
      const facingBorder = row + sign * (fork[alongSize]! / 2 + rowGap);
      branches.forEach((node, index) => {
        node[across] = fork[across]! + (index === 0 ? -halfSpan : halfSpan);
        node[along] = facingBorder + (sign * node[alongSize]!) / 2;
      });
      fitFrame(frame, members);

      // A lone outgoing diamond port is at the sloped side's midpoint. Align
      // that point (not the bounding-box centre) with the entry's facing side.
      // Centre the caption wholly outside the frame and beyond the decision's
      // box, allowing for the router's conservative text estimate as well as
      // actual theme-dependent measurements.
      const frameBorder = frame[across]! - frame[acrossSize]! / 2;
      const entryBorder = cursor[across]! - cursor[acrossSize]! / 2;
      const inset = entryBorder - frameBorder;
      const entryGap = Math.max(
        CHAIN_GAP,
        Math.abs(inset - decision[acrossSize]! / 4) +
          labelSpan(entryEdge, acrossSize) +
          2 * LABEL_CLEARANCE
      );
      decision[along] = row - (sign * decision[alongSize]!) / 4;
      decision[across] = frameBorder - entryGap - decision[acrossSize]! / 2;
      for (let index = 1; index < predecessors.length; index++) {
        const source = predecessors[index];
        const target = predecessors[index - 1];
        source[across] = decision[across];
        source[along] =
          target[along]! -
          sign *
            ((source[alongSize]! + target[alongSize]!) / 2 +
              Math.max(CHAIN_GAP, labelSpan(incoming(target)[0], alongSize) + 2 * LABEL_CLEARANCE));
      }
      // Reject atomically rather than displacing unrelated content. Checking
      // the enlarged frame too protects sibling frames and their entire trees.
      const obstacles = data.nodes.filter((node) => !selected.has(node));
      return ![...selected].some((node) =>
        obstacles.some((obstacle) => boxesTooClose(node, obstacle))
      );
    });
    if (!accepted) {
      continue;
    }
    changed = true;
  }
  return changed;
}

function labelSpan(edge: Edge, size: 'width' | 'height'): number {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label) {
    return 0;
  }
  return captionDimensions(label, edge, 'conservative')[size];
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

function boxesTooClose(first: Node, second: Node): boolean {
  const dx = Math.abs(first.x! - second.x!) - (first.width! + second.width!) / 2;
  const dy = Math.abs(first.y! - second.y!) - (first.height! + second.height!) / 2;
  return dx < 30 && dy < 30;
}
