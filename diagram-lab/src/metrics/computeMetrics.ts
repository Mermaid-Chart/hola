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
import { LAYOUT_DEPENDENT_METRIC_KEYS } from './types.js';
import type {
  DiagramMetrics,
  GraphModel,
  LabLayoutData,
  LayoutMetrics,
  StructuralMetrics,
  ValidationSummary,
} from './types.js';

export interface MetricsComputation {
  metrics: DiagramMetrics;
  model: GraphModel;
}

export function computeMetrics(
  layout: LabLayoutData,
  validation?: ValidationSummary
): MetricsComputation {
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

    validationScore: validation ? validation.score : null,
    validationOk: validation ? validation.ok : null,
    validationIssues: validation ? validation.issueCount : null,
    validationHardIssues: validation ? validation.hardIssueCount : null,
    crossings: validation ? validation.crossings : null,

    hasSubgraphs: subgraphs.hasSubgraphs,
    subgraphBoundaryEdgeCount: subgraphs.boundaryEdgeCount,
    hasSubgraphBoundaryEdges: subgraphs.boundaryEdgeCount > 0,
    piercedSubgraphIds: subgraphs.piercedSubgraphIds,
  };

  return { metrics, model };
}

/** Split a measurement into the half that survives a layout change and the half that does not. */
export function splitMetrics(metrics: DiagramMetrics): {
  structural: StructuralMetrics;
  layout: LayoutMetrics;
} {
  const structural = { ...metrics } as Record<string, unknown>;
  const layout = {} as Record<string, unknown>;
  for (const key of LAYOUT_DEPENDENT_METRIC_KEYS) {
    layout[key] = metrics[key];
    delete structural[key];
  }
  return {
    structural: structural as unknown as StructuralMetrics,
    layout: layout as unknown as LayoutMetrics,
  };
}

/**
 * Recombine the two halves for display.
 *
 * With no layout half — the usual state right after switching layout — the
 * layout-dependent fields come back `null`, so the structural columns render
 * and the rest show as not-yet-measured.
 */
export function mergeMetrics(
  structural: StructuralMetrics | undefined,
  layout: LayoutMetrics | undefined
): DiagramMetrics | undefined {
  if (!structural) {
    return undefined;
  }
  const blanks = Object.fromEntries(
    LAYOUT_DEPENDENT_METRIC_KEYS.map((key) => [key, null])
  ) as unknown as LayoutMetrics;
  return { ...structural, ...blanks, ...(layout ?? {}) };
}
