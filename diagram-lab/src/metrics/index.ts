export { computeMetrics } from './computeMetrics.js';
export type { MetricsComputation } from './computeMetrics.js';
export {
  buildGraphModel,
  drawingBounds,
  isLabelPlaceholder,
  simpleAdjacency,
  topologyVertices,
} from './graphModel.js';
export { computeDegrees, median } from './degrees.js';
export { computeConnectivity } from './connectivity.js';
export { isPlanar } from './planarity.js';
export { computeStress, STRESS_NODE_LIMIT } from './stress.js';
export { ancestorGroups, computeSubgraphStats } from './subgraphs.js';
export type {
  DiagramMetrics,
  GraphModel,
  LabEdge,
  LabLayoutData,
  LabNode,
  NodePosition,
  NormalizedEdge,
} from './types.js';
