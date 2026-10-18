import type { Edge, LayoutData, Node } from '../../types.js';

export const DIAMOND_CIRCLE_PORT_MARGIN = 0.1;
export const DIAMOND_CIRCLE_PORT_SPAN = 1 - 2 * DIAMOND_CIRCLE_PORT_MARGIN;

export interface DiamondCircleBundle {
  diamond: Node;
  circle: Node;
  edges: Edge[];
}

/** An isolated unlabelled fan can share one slope without disturbing other branches. */
export function isolatedDiamondCircleBundle(
  data: Pick<LayoutData, 'nodes' | 'edges'>
): DiamondCircleBundle | undefined {
  if (data.nodes.length !== 2 || data.nodes.some((node) => node.isGroup)) {
    return undefined;
  }
  const diamond = data.nodes.find((node) =>
    /^(diamond|rhombus|diam|question|decision)$/.test(String(node.shape))
  );
  const circle = data.nodes.find((node) => /^(circle|circ|ellipse)$/.test(String(node.shape)));
  if (
    !diamond ||
    !circle ||
    data.edges.length < 2 ||
    data.edges.some(
      (edge) =>
        edge.start !== diamond.id ||
        edge.end !== circle.id ||
        (edge.label ?? edge.text ?? '').trim()
    )
  ) {
    return undefined;
  }
  // Spread symmetrically about the slope midpoint, clear of both vertices.
  // Keep at least eight pixels between lanes; over-capacity fans use normal routing.
  if (
    (Math.min(diamond.width!, diamond.height!) * DIAMOND_CIRCLE_PORT_SPAN) /
      2 /
      (data.edges.length - 1) <
      8 ||
    (Math.max(diamond.width!, diamond.height!) * DIAMOND_CIRCLE_PORT_SPAN) / 4 >=
      Math.min(circle.width!, circle.height!) / 2
  ) {
    return undefined;
  }
  return { diamond, circle, edges: [...data.edges].sort((a, b) => a.id.localeCompare(b.id)) };
}

export function alignIsolatedDiamondCircleBundle(data: LayoutData, gap: number): void {
  const bundle = isolatedDiamondCircleBundle(data);
  if (!bundle) {
    return;
  }
  const { diamond, circle } = bundle;
  const vertical = data.direction !== 'LR' && data.direction !== 'RL';
  const sign = data.direction === 'BT' || data.direction === 'RL' ? -1 : 1;
  if (vertical) {
    circle.x = diamond.x! + diamond.width! / 4;
    circle.y = diamond.y! + sign * ((diamond.height! + circle.height!) / 2 + gap);
  } else {
    circle.x = diamond.x! + sign * ((diamond.width! + circle.width!) / 2 + gap);
    circle.y = diamond.y! + diamond.height! / 4;
  }
}
