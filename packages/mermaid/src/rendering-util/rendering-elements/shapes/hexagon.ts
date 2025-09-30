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
  node.labelStyle = labelStyles;
  const nodePadding = node.padding ?? 0;
  const labelPaddingX = node.look === 'neo' ? 16 : nodePadding;
  const labelPaddingY = node.look === 'neo' ? 12 : nodePadding;

  if (node.width || node.height) {
    node.width = (node?.width ?? 0) - labelPaddingX * 2;
    node.width = Math.max(node.width, 10);
    node.height = (node?.height ?? 0) - labelPaddingY * 2;
    node.height = Math.max(node.height, 10);
  }

  const { shapeSvg, bbox } = await labelHelper(parent, node, getNodeClasses(node));

  const w = (node?.width ?? bbox.width) + labelPaddingX * 2;
  const h = (node?.height ?? bbox.height) + labelPaddingY * 2;
  const { cssStyles } = node;
  // @ts-expect-error -- Passing a D3.Selection seems to work for some reason
  const rc = rough.svg(shapeSvg);
  const options = userNodeOverrides(node, {});

  if (node.look !== 'handDrawn') {
    options.roughness = 0;
    options.fillStyle = 'solid';
    options.stroke = 'none';
  }

  const halfWidth = w / 2;
  const halfHeight = h / 2;

  const hexagonWidth = halfWidth * 0.8;
  const hexagonHeight = halfHeight;

  const points = [
    { x: -hexagonWidth, y: -hexagonHeight },
    { x: hexagonWidth, y: -hexagonHeight },
    { x: halfWidth, y: 0 },
    { x: hexagonWidth, y: hexagonHeight },
    { x: -hexagonWidth, y: hexagonHeight },
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
