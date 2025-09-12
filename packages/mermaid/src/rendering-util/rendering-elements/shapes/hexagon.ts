import { labelHelper, updateNodeBounds, getNodeClasses, createPathFromPoints } from './util.js';
import intersect from '../intersect/index.js';
import type { Node } from '../../types.js';
import { styles2String, userNodeOverrides } from './handDrawnShapeStyles.js';
import rough from 'roughjs';
import type { D3Selection } from '../../../types.js';

export const createHexagonPathD = (
  x: number,
  y: number,
  width: number,
  height: number,
  m: number
): string => {
  return [
    `M${x + m},${y}`,
    `L${x + width - m},${y}`,
    `L${x + width},${y - height / 2}`,
    `L${x + width - m},${y - height}`,
    `L${x + m},${y - height}`,
    `L${x},${y - height / 2}`,
    'Z',
  ].join(' ');
};

export async function hexagon<T extends SVGGraphicsElement>(parent: D3Selection<T>, node: Node) {
  const { labelStyles, nodeStyles } = styles2String(node);
  const f = node.look === 'neo' ? 3.5 : 4;
  node.labelStyle = labelStyles;
  const nodePadding = node.padding ?? 0;
  const wa = 70;
  const ha = 32;

  const labelPaddingX = node.look === 'neo' ? wa : nodePadding;
  const labelPaddingY = node.look === 'neo' ? ha : nodePadding;
  if (node.width || node.height) {
    const originalHeight = node.height ?? 0;
    const m = originalHeight / f;
    node.width = (node?.width ?? 0) - 2 * m - labelPaddingY;
    node.height = (node.height ?? 0) - labelPaddingX;
  }

  const { shapeSvg, bbox } = await labelHelper(parent, node, getNodeClasses(node));

  const h = bbox.height + (node.padding ?? 0);
  const w = bbox.width + (node.padding ?? 0) * 2.5;
  const { cssStyles } = node;
  // @ts-expect-error -- Passing a D3.Selection seems to work for some reason
  const rc = rough.svg(shapeSvg);
  const options = userNodeOverrides(node, {});

  if (node.look !== 'handDrawn') {
    options.roughness = 0;
    options.fillStyle = 'solid';
  }

  let halfWidth = w / 2;
  const m = halfWidth / 6; // Margin for label
  halfWidth = halfWidth + m; // Adjusted half width for hexagon

  const halfHeight = h / 2;

  const fixedLength = halfHeight / 2;
  const deducedWidth = halfWidth - fixedLength;

  const points = [
    { x: -deducedWidth, y: -halfHeight },
    { x: 0, y: -halfHeight },
    { x: deducedWidth, y: -halfHeight },
    { x: halfWidth, y: 0 },
    { x: deducedWidth, y: halfHeight },
    { x: 0, y: halfHeight },
    { x: -deducedWidth, y: halfHeight },
    { x: -halfWidth, y: 0 },
  ];

  const pathData = createPathFromPoints(points);
  const shapeNode = rc.path(pathData, options);

  const polygon = shapeSvg.insert(() => shapeNode, ':first-child');
  polygon.attr('class', 'basic label-container');

  if (cssStyles && node.look !== 'handDrawn') {
    polygon.selectChildren('path').attr('style', cssStyles);
  }

  if (nodeStyles && node.look !== 'handDrawn') {
    polygon.selectChildren('path').attr('style', nodeStyles);
  }

  node.width = w;
  node.height = h;

  updateNodeBounds(node, polygon);

  node.intersect = function (point) {
    return intersect.polygon(node, points, point);
  };

  return shapeSvg;
}
