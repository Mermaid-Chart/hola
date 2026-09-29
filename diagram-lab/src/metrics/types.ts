/**
 * Structural types for the Diagram Lab metrics pass.
 *
 * Declared here rather than imported from `packages/mermaid/src/rendering-util/types.ts`
 * for the same reason the Dev Explorer declares its own mirrors: the lab client is
 * bundled on its own and reaches Mermaid only through `window`, so a real import
 * would drag the library into this bundle. Only the fields the metrics read are
 * listed — `LayoutData` carries far more, and everything here is optional so a
 * captured layout from any layout engine satisfies it structurally.
 */

/** Subset of `rendering-util/types.ts` `Node` the metrics read. */
export interface LabNode {
  id: string;
  label?: string;
  parentId?: string;
  isGroup?: boolean;
  /** Edge-label placeholder markers, in the several spellings layouts use. */
  isEdgeLabel?: boolean;
  isLabelNode?: boolean;
  isDummy?: boolean;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

/** Subset of `rendering-util/types.ts` `Edge` the metrics read. */
export interface LabEdge {
  id?: string;
  /** Flowcharts populate `start`/`end`; other producers use `source`/`target`. */
  start?: string;
  end?: string;
  source?: string;
  target?: string;
  label?: string;
  text?: string;
  /** Virtual edge that exists only to feed a layout pass — never a real connection. */
  isLayoutOnly?: boolean;
  /** Set when an edge is routed through a label node rather than split around it. */
  labelNodeId?: string;
}

/** Structural shape of a captured `LayoutData`. */
export interface LabLayoutData {
  nodes: LabNode[];
  edges: LabEdge[];
  [key: string]: unknown;
}

/**
 * The graph the metrics are actually computed on: real nodes only, with
 * edge-label placeholder nodes collapsed back into the edges they belong to.
 *
 * See `graphModel.ts` for why that normalisation is needed.
 */
export interface GraphModel {
  /** Ids of "pure" nodes — not groups, not edge-label placeholders. */
  nodeIds: string[];
  /** Ids of group/subgraph container nodes. */
  groupIds: string[];
  /** Normalised connections between pure nodes. */
  edges: NormalizedEdge[];
  /** `id -> parentId` for every node, including groups. */
  parentOf: Map<string, string | undefined>;
  /** Node geometry, when the layout has been run. Absent before layout. */
  positions: Map<string, NodePosition>;
  /** Edge-label placeholder nodes that were collapsed away. */
  collapsedLabelNodeIds: string[];
  /** Endpoints that named a node the layout never produced. */
  danglingEdgeCount: number;
}

export interface NormalizedEdge {
  id: string;
  source: string;
  target: string;
  /** Trimmed label text, or `''` when the edge carries no label. */
  label: string;
}

export interface NodePosition {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Every number the lab records for one (diagram, layout) pair. */
export interface DiagramMetrics {
  // ── Size ───────────────────────────────────────────────────────────────────
  /** Pure nodes: groups and edge-label placeholders excluded. */
  nodeCount: number;
  /** Connections between pure nodes, after label-node collapsing. */
  edgeCount: number;
  /** Subgraph/cluster containers. */
  groupCount: number;
  /** Width of the laid-out drawing, in layout px. `null` before layout. */
  drawingWidth: number | null;
  /** Height of the laid-out drawing, in layout px. `null` before layout. */
  drawingHeight: number | null;
  /** `drawingWidth * drawingHeight`. `null` before layout. */
  drawingArea: number | null;

  // ── Connectivity ───────────────────────────────────────────────────────────
  /** Highest incident-edge count over all pure nodes. */
  degreeMax: number;
  /** Median incident-edge count over all pure nodes. */
  degreeMedian: number;
  /** `edgeCount / nodeCount`. `null` when there are no nodes. */
  edgeNodeRatio: number | null;
  /** Share of edges carrying a label, in `[0, 1]`. `null` when there are no edges. */
  labeledEdgeRatio: number | null;

  // ── Topology ───────────────────────────────────────────────────────────────
  /** `true` when the underlying simple graph has no planar embedding. */
  nonPlanar: boolean;
  /** `true` when the graph is a single connected acyclic component. */
  isTree: boolean;
  /** `true` when every component is acyclic (a tree is also a forest). */
  isForest: boolean;
  /** Number of connected components over pure nodes. */
  componentCount: number;

  // ── Layout quality ─────────────────────────────────────────────────────────
  /** Stress at the best uniform scale. `null` when positions are unavailable. */
  stress: number | null;
  /** Scale-invariant stress in `[0, 1]`. `null` when positions are unavailable. */
  stressNormalized: number | null;
  /** The ideal edge length that minimises stress for this drawing. */
  stressOptimalEdgeLength: number | null;
  /**
   * Vertices stress was computed over. Below `nodeCount` means the layout left
   * some nodes unpositioned in the captured data — dagre does this for nested
   * cluster children, which it lays out in their own coordinate space.
   */
  stressNodeCount: number | null;

  // ── Subgraphs ──────────────────────────────────────────────────────────────
  /** `true` when the diagram declares at least one subgraph. */
  hasSubgraphs: boolean;
  /** Edges with exactly one endpoint inside some subgraph — they pierce its frame. */
  subgraphBoundaryEdgeCount: number;
  /** `true` when any subgraph is entered by an edge from outside it. */
  hasSubgraphBoundaryEdges: boolean;
  /** Ids of the subgraphs an outside edge reaches into. */
  piercedSubgraphIds: string[];
}
