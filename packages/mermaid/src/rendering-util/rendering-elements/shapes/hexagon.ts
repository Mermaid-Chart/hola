import { labelHelper, updateNodeBounds, getNodeClasses } from './util.js';
import intersect from '../intersect/index.js';
import type { Node } from '../../types.js';
import { styles2String, userNodeOverrides } from './handDrawnShapeStyles.js';
import rough from 'roughjs';
import { insertPolygonShape } from './insertPolygonShape.js';
import type { D3Selection } from '../../../types.js';
import { getIconSVG } from '../../icons.js';

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

  const iconSize = 20;
  const iconGap = 8;
  const iconWidth = node.icon ? iconSize + iconGap : 0;

  const labelPaddingX = node.look === 'neo' ? wa : nodePadding;
  const labelPaddingY = node.look === 'neo' ? ha : nodePadding;
  if (node.width || node.height) {
    const originalHeight = node.height ?? 0;
    const m = originalHeight / f;
    node.width = (node?.width ?? 0) - 2 * m - labelPaddingY;
    node.height = (node.height ?? 0) - labelPaddingX;
  }

  const { shapeSvg, bbox, label } = await labelHelper(parent, node, getNodeClasses(node));

  const h = (node?.height ? node?.height : bbox.height) + labelPaddingX;
  const m = h / f;

  const w = (node?.width ? node?.width : bbox.width) + 2 * m + labelPaddingY + iconWidth;
  const points = [
    { x: m, y: 0 },
    { x: w - m, y: 0 },
    { x: w, y: -h / 2 },
    { x: w - m, y: -h },
    { x: m, y: -h },
    { x: 0, y: -h / 2 },
  ];

  let polygon: D3Selection<SVGGElement> | Awaited<ReturnType<typeof insertPolygonShape>>;
  const { cssStyles } = node;

  if (node.look === 'handDrawn') {
    // @ts-expect-error -- Passing a D3.Selection seems to work for some reason
    const rc = rough.svg(shapeSvg);
    const options = userNodeOverrides(node, {});
    const pathData = createHexagonPathD(0, 0, w, h, m);
    const roughNode = rc.path(pathData, options);

    polygon = shapeSvg
      .insert(() => roughNode, ':first-child')
      .attr('transform', `translate(${-w / 2}, ${h / 2})`);

    if (cssStyles) {
      polygon.attr('style', cssStyles);
    }
  } else {
    polygon = insertPolygonShape(shapeSvg, w, h, points);
  }

  if (nodeStyles) {
    polygon.attr('style', nodeStyles);
  }

  node.width = w;
  node.height = h;

  updateNodeBounds(node, polygon);

  // Shift label right to make room for icon on the left, and render icon
  if (node.icon) {
    const currentTransform = label.attr('transform') ?? 'translate(0,0)';
    label.attr(
      'transform',
      currentTransform.replace(/translate\(([^,]+),([^)]+)\)/, (_m, x, y) => {
        return `translate(${parseFloat(x) + iconWidth / 2}, ${y})`;
      })
    );

    const iconElem = shapeSvg.append('g').attr('class', 'mindmap-icon');
    iconElem.html(
      `<g>${await getIconSVG(node.icon, { height: iconSize, fallbackPrefix: '' })}</g>`
    );
    const iconBBox = iconElem.node()!.getBBox();
    const iconTargetCenterX = -(bbox.width + iconGap) / 2;
    const tx = iconTargetCenterX - iconBBox.x - iconBBox.width / 2;
    const ty = -iconBBox.y - iconBBox.height / 2;
    iconElem.attr('transform', `translate(${tx}, ${ty})`);
  }

  node.intersect = function (point) {
    return intersect.polygon(node, points, point);
  };

  return shapeSvg;
}
