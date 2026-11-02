import cytoscape from 'cytoscape';
import coseBilkent from 'cytoscape-cose-bilkent';
import type { DrawDefinition } from '../../diagram-api/types.js';
import { log } from '../../logger.js';
import type { FilledMindMapNode } from './mindmapTypes.js';
import defaultConfig from '../../defaultConfig.js';
import * as configApi from '../../config.js';
import type { MindmapDB } from './mindmapDb.js';
import type { LayoutData } from '../../mermaid.js';
import { getRegisteredLayoutAlgorithm, render } from '../../rendering-util/render.js';
import { getDiagramElement } from '../../rendering-util/insertElementsForSize.js';
import { setupViewPortForSVG } from '../../rendering-util/setupViewPortForSVG.js';

// Inject the layout algorithm into cytoscape
cytoscape.use(coseBilkent);

/**
 * Update the layout data with actual node dimensions after drawing
 */
function _updateNodeDimensions(data4Layout: LayoutData, mindmapRoot: FilledMindMapNode) {
  const updateNode = (node: FilledMindMapNode) => {
    // Find the corresponding node in the layout data
    const layoutNode = data4Layout.nodes.find((n) => n.id === node.id.toString());
    if (layoutNode) {
      // Update with the actual dimensions calculated by drawNode
      layoutNode.width = node.width;
      layoutNode.height = node.height;
      log.debug('Updated node dimensions:', node.id, 'width:', node.width, 'height:', node.height);
    }

    // Recursively update children
    node.children?.forEach(updateNode);
  };

  updateNode(mindmapRoot);
}

declare module 'cytoscape' {
  interface EdgeSingular {
    _private: {
      bodyBounds: unknown;
      rscratch: {
        startX: number;
        startY: number;
        midX: number;
        midY: number;
        endX: number;
        endY: number;
      };
    };
  }
}

export const draw: DrawDefinition = async (text, id, _version, diagObj) => {
  log.debug('Rendering mindmap diagram\n' + text);
  const config = configApi.getConfig();
  const { look, themeVariables } = config;
  const { useGradient, gradientStart, gradientStop } = themeVariables;
  const db = diagObj.db as MindmapDB;

  const data4Layout = db.getData();

  const svg = getDiagramElement(id, data4Layout.config.securityLevel);

  data4Layout.type = diagObj.type;
  data4Layout.layoutAlgorithm = getRegisteredLayoutAlgorithm(data4Layout.config.layout, {
    fallback: 'cose-bilkent',
  });

  data4Layout.diagramId = id;

  const mm = db.getMindmap();
  if (!mm) {
    return;
  }

  data4Layout.nodes.forEach((node) => {
    if (node.shape === 'rounded') {
      node.radius = 15;
      node.taper = 15;
      node.stroke = 'none';
      node.width = 0;
      node.padding = 15;
    } else if (node.shape === 'circle') {
      node.padding = 10;
    } else if (node.shape === 'rect') {
      node.width = 0;
      node.padding = 10;
    } else if (node.shape === 'hexagon') {
      node.width = 0;
      node.height = 0;
    }
  });

  // Use the unified rendering system
  await render(data4Layout, svg);

  // Setup the view box and size of the svg element using config from data4Layout
  setupViewPortForSVG(
    svg,
    data4Layout.config.mindmap?.padding ?? defaultConfig.mindmap.padding,
    'mindmapDiagram',
    data4Layout.config.mindmap?.useMaxWidth ?? defaultConfig.mindmap.useMaxWidth
  );

  if (look === 'neo' && useGradient) {
    const gradient = svg
      .append('linearGradient')
      .attr('id', svg.attr('id') + '-gradient')
      .attr('gradientUnits', 'objectBoundingBox')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '100%')
      .attr('y2', '0%');

    gradient
      .append('svg:stop')
      .attr('offset', '0%')
      .attr('stop-color', gradientStart)
      .attr('stop-opacity', 1);

    gradient
      .append('svg:stop')
      .attr('offset', '100%')
      .attr('stop-color', gradientStop)
      .attr('stop-opacity', 1);
  }
};

export default {
  draw,
};
