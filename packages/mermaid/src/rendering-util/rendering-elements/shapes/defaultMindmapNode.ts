import type { Bounds, D3Selection, Point } from '../../../types.js';
import type { Node } from '../../types.js';
import intersect from '../intersect/index.js';
import { styles2String } from './handDrawnShapeStyles.js';
import { getNodeClasses, labelHelper, updateNodeBounds } from './util.js';
import { getIconSVG } from '../../icons.js';

export async function defaultMindmapNode<T extends SVGGraphicsElement>(
  parent: D3Selection<T>,
  node: Node
) {
  const { labelStyles, nodeStyles } = styles2String(node);
  node.labelStyle = labelStyles;

  const { shapeSvg, bbox, halfPadding, label } = await labelHelper(
    parent,
    node,
    getNodeClasses(node)
  );
  const iconSize = 20;
  const iconGap = 8;
  const iconWidth = node.icon ? iconSize + iconGap : 0;

  const w = bbox.width + 4 * halfPadding + iconWidth;
  const h = bbox.height + 2 * halfPadding;
  const rd = 5;

  // Neo look: rounded top corners only, flat bottom edge (tab-like shape).
  const rectPath =
    node.look === 'neo'
      ? `
    M${-w / 2} ${h / 2 - rd}
    v${-h + 2 * rd}
    q0,-${rd} ${rd},-${rd}
    h${w - 2 * rd}
    q${rd},0 ${rd},${rd}
    v${h - rd}
    H${-w / 2}
    Z
  `
      : `
    M${-w / 2} ${h / 2 - rd}
    v${-h + 2 * rd}
    q0,-${rd} ${rd},-${rd}
    h${w - 2 * rd}
    q${rd},0 ${rd},${rd}
    v${h - 2 * rd}
    q0,${rd} ${-rd},${rd}
    h${-(w - 2 * rd)}
    q${-rd},0 ${-rd},${-rd}
    Z
  `;

  if (!node.domId) {
    throw new Error(
      `defaultMindmapNode: node "${node.id}" is missing a domId — was render.ts domId prefixing skipped?`
    );
  }

  const bg = shapeSvg
    .append('path')
    .attr('id', node.domId)
    .attr('class', 'node-bkg node-' + node.type)
    .attr('style', nodeStyles)
    .attr('d', rectPath);

  shapeSvg
    .append('line')
    .attr('class', 'node-line-')
    .attr('x1', -w / 2)
    .attr('y1', h / 2)
    .attr('x2', w / 2)
    .attr('y2', h / 2);

  // Shift label right to make room for icon on the left
  label.attr('transform', `translate(${-bbox.width / 2 + iconWidth / 2}, ${-bbox.height / 2})`);
  shapeSvg.append(() => label.node());
  // Render icon using Iconify (same system as flowchart shapes)
  if (node.icon) {
    const iconElem = shapeSvg.append('g').attr('class', 'mindmap-icon');
    iconElem.html(
      `<g>${await getIconSVG(node.icon, { height: iconSize, fallbackPrefix: '' })}</g>`
    );
    const iconBBox = iconElem.node()!.getBBox();
    // Place icon to the left of the (shifted) label, vertically centered
    const iconTargetCenterX = -(bbox.width + iconGap) / 2;
    const tx = iconTargetCenterX - iconBBox.x - iconBBox.width / 2;
    const ty = -iconBBox.y - iconBBox.height / 2;
    iconElem.attr('transform', `translate(${tx}, ${ty})`);
  }

  updateNodeBounds(node, bg);
  node.calcIntersect = function (bounds: Bounds, point: Point) {
    return intersect.rect(bounds, point);
  };
  node.intersect = function (point) {
    return intersect.rect(node, point);
  };

  return shapeSvg;
}
