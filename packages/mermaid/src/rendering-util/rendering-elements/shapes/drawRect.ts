import { labelHelper, updateNodeBounds, getNodeClasses } from './util.js';
import intersect from '../intersect/index.js';
import type { Node, RectOptions } from '../../types.js';
import { createRoundedRectPathD } from './roundedRectPath.js';
import { userNodeOverrides, styles2String } from './handDrawnShapeStyles.js';
import rough from 'roughjs';
import type { D3Selection } from '../../../types.js';
import { handleUndefinedAttr } from '../../../utils.js';
import type { Bounds, Point } from '../../../types.js';
import { getIconSVG } from '../../icons.js';

export async function drawRect<T extends SVGGraphicsElement>(
  parent: D3Selection<T>,
  node: Node,
  options: RectOptions
) {
  const { labelStyles, nodeStyles } = styles2String(node);
  node.labelStyle = labelStyles;
  // An explicitly sized dimension is the outer size, so subtract the padding to get the
  // label box the label helper should fit into. Each dimension is handled on its own: a
  // caller may fix only one of them (C4 pins the width to `c4.width` and lets the label
  // drive the height), and the unset one must stay unset so the label measurement wins.
  //
  // The width is handed over as `wrappingWidth` rather than by rewriting `node.width`,
  // because the label helpers disagree about what `node.width` means: the default one
  // treats it as the label box, while `c4LabelHelper` treats it as the outer box and
  // subtracts the padding itself. Passing the wrap width explicitly settles that, and
  // tells the helper to wrap even when the global `wrap` config is off - the box is a
  // fixed size, so an unwrapped label would overflow it.
  //
  // The diagram-level minimum label width (`minNodeWidth`) yields to an explicit width.
  // The label helper only knows to skip it while `node.width` is set, and it is cleared
  // here, so drop the minimum too: otherwise a node pinned narrower than the minimum gets
  // a label box wider than its rect, and the label is centred on that box instead.
  let labelWidth: number | undefined;
  if (node.width) {
    labelWidth = Math.max(node.width - options.labelPaddingX * 2, 1);
    node.wrappingWidth = labelWidth;
    node.width = undefined;
    node.minWidth = undefined;
  }
  if (node.height) {
    node.height = node.height - options.labelPaddingY * 2;
  }

  const iconSize = 20;
  const iconGap = 8;
  const iconWidth = node.icon ? iconSize + iconGap : 0;

  const { shapeSvg, bbox, label } = await labelHelper(parent, node, getNodeClasses(node));

  const totalWidth = (labelWidth ?? bbox.width) + options.labelPaddingX * 2 + iconWidth;
  const totalHeight = (node?.height ? node?.height : bbox.height) + options.labelPaddingY * 2;

  const x = -totalWidth / 2;
  const y = -totalHeight / 2;
  let rect;
  let { rx, ry } = node;
  const { cssStyles } = node;

  //use options rx, ry overrides if present
  if (options?.rx && options.ry) {
    rx = options.rx;
    ry = options.ry;
  }

  if (node.look === 'handDrawn') {
    // @ts-ignore TODO: Fix rough typings
    const rc = rough.svg(shapeSvg);
    const options = userNodeOverrides(node, {});

    const roughNode =
      rx || ry
        ? rc.path(createRoundedRectPathD(x, y, totalWidth, totalHeight, rx || 0), options)
        : rc.rectangle(x, y, totalWidth, totalHeight, options);

    rect = shapeSvg.insert(() => roughNode, ':first-child');
    rect.attr('class', 'basic label-container').attr('style', handleUndefinedAttr(cssStyles));
  } else {
    rect = shapeSvg.insert('rect', ':first-child');

    const rectClass = 'basic label-container';

    rect
      .attr('class', rectClass)
      .attr('style', nodeStyles)
      .attr('rx', handleUndefinedAttr(rx))
      .attr('data-id', node.id)
      .attr('ry', handleUndefinedAttr(ry))
      .attr('x', x)
      .attr('y', y)
      .attr('width', totalWidth)
      .attr('height', totalHeight)
      .attr('stroke', 'url(#gradient)');
  }

  // For a plain (non-roughjs) axis-aligned rect the rendered geometry is exactly
  // the size we just drew, so hand it to updateNodeBounds to avoid a getBBox reflow.
  // Hand-drawn rects are roughjs paths that overflow their nominal box, so they
  // still need a real measurement.
  updateNodeBounds(
    node,
    rect,
    node.look === 'handDrawn' ? undefined : { width: totalWidth, height: totalHeight }
  );

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

  node.calcIntersect = function (bounds: Bounds, point: Point) {
    return intersect.rect(bounds, point);
  };

  node.intersect = function (point) {
    return intersect.rect(node, point);
  };

  return shapeSvg;
}
