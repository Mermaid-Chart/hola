import { labelHelper, updateNodeBounds, getNodeClasses } from './util.js';
import intersect from '../intersect/index.js';
import type { Node } from '../../types.js';
import { styles2String, userNodeOverrides } from './handDrawnShapeStyles.js';
import rough from 'roughjs';
import type { D3Selection } from '../../../types.js';
import { createRoundedRectPathD } from './roundedRectPath.js';

interface Point {
  x: number;
  y: number;
}
export function generateRoundedRectanglePoints(
  w: number,
  h: number,
  radius: number,
  numPointsPerArc = 10
): Point[] {
  const toRad = (deg: number): number => (deg * Math.PI) / 180;

  const generateArcPoints = (startDeg: number, endDeg: number, cx: number, cy: number): Point[] => {
    const points: Point[] = [];
    const step = toRad(endDeg - startDeg) / (numPointsPerArc - 1);
    for (let i = 0; i < numPointsPerArc; i++) {
      const angle = toRad(startDeg) + i * step;
      points.push({
        x: cx + radius * Math.cos(angle),
        y: cy + radius * Math.sin(angle),
      });
    }
    return points;
  };

  // Define each corner’s center and arc range
  const arcs = {
    topRight: { start: 270, end: 360, cx: w / 2 - radius, cy: -h / 2 + radius },
    bottomRight: { start: 0, end: 90, cx: w / 2 - radius, cy: h / 2 - radius },
    bottomLeft: { start: 90, end: 180, cx: -w / 2 + radius, cy: h / 2 - radius },
    topLeft: { start: 180, end: 270, cx: -w / 2 + radius, cy: -h / 2 + radius },
  };

  const topRightArcPoints = generateArcPoints(
    arcs.topRight.start,
    arcs.topRight.end,
    arcs.topRight.cx,
    arcs.topRight.cy
  );
  const bottomRightArcPoints = generateArcPoints(
    arcs.bottomRight.start,
    arcs.bottomRight.end,
    arcs.bottomRight.cx,
    arcs.bottomRight.cy
  );
  const bottomLeftArcPoints = generateArcPoints(
    arcs.bottomLeft.start,
    arcs.bottomLeft.end,
    arcs.bottomLeft.cx,
    arcs.bottomLeft.cy
  );
  const topLeftArcPoints = generateArcPoints(
    arcs.topLeft.start,
    arcs.topLeft.end,
    arcs.topLeft.cx,
    arcs.topLeft.cy
  );

  // Construct full rounded rectangle points
  return [
    { x: -w / 2 + radius, y: -h / 2 },
    { x: w / 2 - radius, y: -h / 2 },
    ...topRightArcPoints,
    { x: w / 2, y: -h / 2 + radius },
    { x: w / 2, y: h / 2 - radius },
    ...bottomRightArcPoints,
    { x: w / 2 - radius, y: h / 2 },
    { x: -w / 2 + radius, y: h / 2 },
    ...bottomLeftArcPoints,
    { x: -w / 2, y: h / 2 - radius },
    { x: -w / 2, y: -h / 2 + radius },
    ...topLeftArcPoints,
  ];
}

export async function roundedRect<T extends SVGGraphicsElement>(
  parent: D3Selection<T>,
  node: Node
) {
  const { labelStyles, nodeStyles } = styles2String(node);
  node.labelStyle = labelStyles;
  const { shapeSvg, bbox } = await labelHelper(parent, node, getNodeClasses(node));
  const nodePadding = node.padding ?? 0;
  const labelPaddingX = node.look === 'neo' ? 16 : nodePadding;
  const labelPaddingY = node.look === 'neo' ? 12 : nodePadding;

  if (node.width || node.height) {
    node.width = (node?.width ?? 0) - labelPaddingX * 2;
    node.height = (node?.height ?? 0) - labelPaddingY * 2;
  }

  const w = (node?.width ? node?.width : bbox.width) + labelPaddingX * 2;
  const h = (node?.height ? node?.height : bbox.height) + labelPaddingY * 2;
  const radius = node.radius || 5;
  const { cssStyles } = node;
  // @ts-expect-error -- Passing a D3.Selection seems to work for some reason
  const rc = rough.svg(shapeSvg);
  const options = userNodeOverrides(node, {});
  if (node.stroke) {
    options.stroke = node.stroke;
  }
  if (node.look !== 'handDrawn') {
    options.roughness = 0;
    options.fillStyle = 'solid';
  }

  // Use createRoundedRectPathD for both handDrawn and non-handDrawn modes
  const pathData = createRoundedRectPathD(-w / 2, -h / 2, w, h, radius);
  const shapeNode = rc.path(pathData, options);

  const polygon = shapeSvg.insert(() => shapeNode, ':first-child');
  polygon.attr('class', 'basic label-container outer-path');

  if (cssStyles && node.look !== 'handDrawn') {
    polygon.selectChildren('path').attr('style', cssStyles);
  }

  if (nodeStyles && node.look !== 'handDrawn') {
    polygon.selectChildren('path').attr('style', nodeStyles);
  }

  updateNodeBounds(node, polygon);

  const points = generateRoundedRectanglePoints(w, h, radius);

  node.intersect = function (point) {
    const pos = intersect.polygon(node, points, point);
    return pos;
  };

  return shapeSvg;
}
