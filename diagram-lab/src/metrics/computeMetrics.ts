/**
 * One pass over a captured `LayoutData` producing every number the lab records.
 *
 * Structural metrics (counts, degrees, ratios, planarity, tree-ness, subgraph
 * containment) depend only on the parsed diagram, so they come out identical no
 * matter which layout ran. Only `stress*` and the drawing box depend on the
 * placement — which is why a row in the lab is keyed by *(diagram, layout)*
 * rather than by diagram alone.
 */

import { computeConnectivity } from './connectivity.js';
import { computeDegrees } from './degrees.js';
import { buildGraphModel, drawingBounds, simpleAdjacency } from './graphModel.js';
import { isPlanar } from './planarity.js';
import { computeStress } from './stress.js';
import { computeSubgraphStats } from './subgraphs.js';
import type { DiagramMetrics, GraphModel, LabLayoutData } from './types.js';

export interface MetricsComputation {
  metrics: DiagramMetrics;
  model: GraphModel;
}

export function computeMetrics(layout: LabLayoutData): MetricsComputation {
  const model = buildGraphModel(layout);

  const degrees = computeDegrees(model);
  const connectivity = computeConnectivity(model);
  const subgraphs = computeSubgraphStats(model);
  const stress = computeStress(model);
  const bounds = drawingBounds(layout);

  const nodeCount = model.nodeIds.length;
  const edgeCount = model.edges.length;
  const labeledEdges = model.edges.filter((edge) => edge.label.length > 0).length;

  const metrics: DiagramMetrics = {
    nodeCount,
    edgeCount,
    groupCount: subgraphs.groupCount,
    drawingWidth: bounds ? bounds.width : null,
    drawingHeight: bounds ? bounds.height : null,
    drawingArea: bounds ? bounds.area : null,

    degreeMax: degrees.max,
    degreeMedian: degrees.median,
    edgeNodeRatio: nodeCount === 0 ? null : edgeCount / nodeCount,
    labeledEdgeRatio: edgeCount === 0 ? null : labeledEdges / edgeCount,

    nonPlanar: !isPlanar(simpleAdjacency(model)),
    isTree: connectivity.isTree,
    isForest: connectivity.isForest,
    componentCount: connectivity.componentCount,

    stress: stress ? stress.stress : null,
    stressNormalized: stress ? stress.normalized : null,
    stressOptimalEdgeLength: stress ? stress.optimalEdgeLength : null,
    stressNodeCount: stress ? stress.nodeCount : null,

    hasSubgraphs: subgraphs.hasSubgraphs,
    subgraphBoundaryEdgeCount: subgraphs.boundaryEdgeCount,
    hasSubgraphBoundaryEdges: subgraphs.boundaryEdgeCount > 0,
    piercedSubgraphIds: subgraphs.piercedSubgraphIds,
  };

  return { metrics, model };
}
