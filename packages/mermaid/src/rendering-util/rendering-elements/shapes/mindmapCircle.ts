import rough from 'roughjs';
import { log } from '../../../logger.js';
import type { Bounds, D3Selection, Point } from '../../../types.js';
import { handleUndefinedAttr } from '../../../utils.js';
import type { MindmapOptions, Node, ShapeRenderOptions } from '../../types.js';
import intersect from '../intersect/index.js';
import { styles2String, userNodeOverrides } from './handDrawnShapeStyles.js';
import { getNodeClasses, labelHelper, updateNodeBounds } from './util.js';
import { getIconSVG } from '../../icons.js';

export async function mindmapCircle<T extends SVGGraphicsElement>(
  parent: D3Selection<T>,
  node: Node,
  options?: MindmapOptions | ShapeRenderOptions
) {
  const { labelStyles, nodeStyles } = styles2String(node);
  node.labelStyle = labelStyles;
  const { shapeSvg, bbox, halfPadding, label } = await labelHelper(
    parent,
    node,
    getNodeClasses(node)
  );

  // Mindmap-specific padding and radius calculation
  const padding = options?.padding ?? (halfPadding ?? 0) * 2;
  const labelPadding = node.look === 'neo' ? 16 : padding;
  const iconSize = 20;
  const iconGap = 6;
  const iconShift = node.icon ? (iconSize + iconGap) / 2 : 0;

  if (node.width || node.height) {
    node.width = (node.width ?? 6) - labelPadding * 2;
    node.height = node.width;
  }

  if (node?.width) {
    node.width = node?.width - labelPadding * 2;
  }

  // Mindmap-specific radius calculation — grow to fit icon above text
  const radius = Math.max(bbox.width, iconSize) / 2 + padding + iconShift;
  let circleElem;
  const { cssStyles } = node;

  if (node.look === 'handDrawn') {
    // @ts-expect-error -- Passing a D3.Selection seems to work for some reason
    const rc = rough.svg(shapeSvg);
    const options = userNodeOverrides(node, {});
    const roughNode = rc.circle(0, 0, radius * 2, options);

    circleElem = shapeSvg.insert(() => roughNode, ':first-child');
    circleElem.attr('class', 'basic label-container').attr('style', handleUndefinedAttr(cssStyles));
  } else {
    circleElem = shapeSvg
      .insert('circle', ':first-child')
      .attr('class', 'basic label-container')
      .attr('style', nodeStyles)
      .attr('r', radius)
      .attr('cx', 0)
      .attr('cy', 0);
  }

  // Shift label down to make room for icon above
  if (node.icon) {
    const currentTransform = label.attr('transform') ?? 'translate(0,0)';
    // labelHelper positions non-HTML labels at translate(0, -bbox.height/2)
    // and HTML labels at translate(-bbox.width/2, -bbox.height/2)
    // We shift Y down by iconShift in both cases
    label.attr(
      'transform',
      currentTransform.replace(/translate\(([^,]+),([^)]+)\)/, (_m, x, y) => {
        return `translate(${x}, ${parseFloat(y) + iconShift})`;
      })
    );

    const iconElem = shapeSvg.append('g').attr('class', 'mindmap-icon');
    iconElem.html(
      `<g>${await getIconSVG(node.icon, { height: iconSize, fallbackPrefix: '' })}</g>`
    );
    const iconBBox = iconElem.node()!.getBBox();
    // Place icon above the (shifted) label center, horizontally centered
    const iconTargetCenterY = -(bbox.height / 2 + iconGap + iconSize / 2) + iconShift;
    const tx = -iconBBox.x - iconBBox.width / 2;
    const ty = iconTargetCenterY - iconBBox.y - iconBBox.height / 2;
    iconElem.attr('transform', `translate(${tx}, ${ty})`);
  }

  updateNodeBounds(node, circleElem);
  node.calcIntersect = function (bounds: Bounds, point: Point) {
    const radius = bounds.width / 2;
    return intersect.circle(bounds, radius, point);
  };
  node.intersect = function (point) {
    log.info('MindmapCircle intersect', node, radius, point);
    return intersect.circle(node, radius, point);
  };

  return shapeSvg;
}
