import type { Edge, LayoutData, Node } from '../../types.js';
import type { Point } from '../layout-utils/types.js';

export const SHORTCUT_FRAME_PADDING = 20;
const APPROACH = 20;
const PORT_OFFSET = 12;

interface NestedShortcutFan {
  source: Node;
  target: Node;
  via: Node;
  direct: Edge[];
  branch: Edge;
  join: Edge;
  sign: number;
  step: number;
}

/** Two direct shortcuts and one indirect branch, with the source in a nested frame. */
export function nestedShortcutFan(data: LayoutData): NestedShortcutFan | undefined {
  if (!['LR', 'RL'].includes(data.direction ?? '') || data.edges.length !== 4) {
    return undefined;
  }
  const content = data.nodes.filter((node) => !node.isGroup);
  const groups = data.nodes.filter((node) => node.isGroup);
  if (content.length !== 3 || groups.length !== 2) {
    return undefined;
  }
  const source = content.find((node) =>
    /^(diamond|rhombus|diam|question|decision)$/.test(String(node.shape))
  );
  if (!source) {
    return undefined;
  }
  const inner = groups.find((group) => group.id === source.parentId);
  const outer = groups.find((group) => group.id === inner?.parentId);
  if (!inner || !outer || groups.some((group) => group.parentId && group !== inner)) {
    return undefined;
  }
  const others = content.filter((node) => node !== source);
  if (others.some((node) => node.parentId !== outer.id)) {
    return undefined;
  }
  const outgoing = data.edges.filter((edge) => edge.start === source.id);
  const target = others.find(
    (node) => outgoing.filter((edge) => edge.end === node.id).length === 2
  );
  const via = others.find((node) => node !== target);
  if (!target || !via || target.width! < PORT_OFFSET * 2 + APPROACH) {
    return undefined;
  }
  // This arrangement uses flat top/bottom arrival sides. Rounded or decision
  // destinations need their own shape-aware fan policy rather than box ports.
  if (
    !/^(rect|squareRect|odd|rect_left_inv_arrow)$/.test(String(target.shape)) ||
    !/^(rect|squareRect)$/.test(String(via.shape)) ||
    via.width! > target.width!
  ) {
    return undefined;
  }
  const direct = outgoing
    .filter((edge) => edge.end === target.id)
    .sort(
      (a, b) =>
        Number(Boolean((b.label ?? b.text ?? '').trim())) -
          Number(Boolean((a.label ?? a.text ?? '').trim())) || a.id.localeCompare(b.id)
    );
  const branch = outgoing.find((edge) => edge.end === via.id);
  const join = data.edges.find((edge) => edge.start === via.id && edge.end === target.id);
  const labelled = (edge: Edge) => Boolean((edge.label ?? edge.text ?? '').trim());
  if (
    !branch ||
    !join ||
    direct.filter(labelled).length !== 1 ||
    labelled(branch) ||
    labelled(join)
  ) {
    return undefined;
  }
  const step = Math.min(24 / Math.max(source.width! / 2, source.height! / 2), 0.3);
  if ((step * source.height!) / 2 < Math.max(18, (direct[0].height ?? 24) / 2 + 4)) {
    return undefined;
  }
  return {
    source,
    target,
    via,
    direct,
    branch,
    join,
    sign: data.direction === 'RL' ? -1 : 1,
    step,
  };
}

function fanPort(fan: NestedShortcutFan, index: number): Point {
  const fraction = 0.5 + (index - 1) * fan.step;
  return {
    x: fan.source.x! + ((fan.sign * fan.source.width!) / 2) * (1 - fraction),
    y: fan.source.y! + (fan.source.height! / 2) * fraction,
  };
}

export function arrangeNestedShortcutFan(data: LayoutData): boolean {
  const fan = nestedShortcutFan(data);
  if (!fan) {
    return false;
  }
  const { source, target, via, sign } = fan;
  const label = fan.direct[0];
  const labelWidth = Math.max(40, label.width ?? 0, (label.label ?? label.text ?? '').length * 8);
  target.x =
    source.x! +
    sign * (source.width! / 2 + SHORTCUT_FRAME_PADDING + labelWidth + 24 + target.width! / 2);
  target.y = fanPort(fan, 1).y + APPROACH + target.height! / 2;
  via.x = target.x;
  via.y = target.y + target.height! / 2 + 36 + via.height! / 2;
  return true;
}

/** Order the upper shortcuts outside the lower branch, and join from below. */
export function nestedShortcutRoutes(fan: NestedShortcutFan | undefined): Map<string, Point[]> {
  const routes = new Map<string, Point[]>();
  if (!fan) {
    return routes;
  }
  const { target, via, sign } = fan;
  for (const [index, edge] of fan.direct.entries()) {
    const start = fanPort(fan, index);
    const end = {
      x: target.x! + sign * (index === 0 ? PORT_OFFSET : -PORT_OFFSET),
      y: target.y! - target.height! / 2,
    };
    routes.set(edge.id, [start, { x: end.x, y: start.y }, end]);
  }
  const start = fanPort(fan, 2);
  const laneX = target.x! - sign * (target.width! / 2 + APPROACH);
  routes.set(fan.branch.id, [
    start,
    { x: laneX, y: start.y },
    { x: laneX, y: via.y! },
    { x: via.x! - (sign * via.width!) / 2, y: via.y! },
  ]);
  routes.set(fan.join.id, [
    { x: via.x!, y: via.y! - via.height! / 2 },
    { x: target.x!, y: target.y! + target.height! / 2 },
  ]);
  return routes;
}
