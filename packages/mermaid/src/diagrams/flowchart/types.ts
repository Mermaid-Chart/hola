import type { ShapeID } from '../../rendering-util/rendering-elements/shapes.js';

/**
 * Valid `type` args to `yy.addVertex` taken from
 * `packages/mermaid/src/diagrams/flowchart/parser/flow.jison`
 */
export type FlowVertexTypeParam =
  | undefined
  | 'square'
  | 'doublecircle'
  | 'circle'
  | 'ellipse'
  | 'stadium'
  | 'subroutine'
  | 'rect'
  | 'cylinder'
  | 'round'
  | 'diamond'
  | 'hexagon'
  | 'odd'
  | 'trapezoid'
  | 'inv_trapezoid'
  | 'lean_right'
  | 'lean_left';

export interface FlowVertex {
  classes: string[];
  dir?: string;
  domId: string;
  haveCallback?: boolean;
  id: string;
  labelType: 'text';
  link?: string;
  linkTarget?: string;
  props?: any;
  styles: string[];
  text?: string;
  type?: ShapeID | FlowVertexTypeParam;
  icon?: string;
  form?: string;
  pos?: 't' | 'b';
  img?: string;
  assetWidth?: number;
  assetHeight?: number;
  defaultWidth?: number;
  imageAspectRatio?: number;
  constraint?: 'on' | 'off';
}

export interface FlowText {
  text: string;
  type: 'text';
}

export interface FlowEdge {
  isUserDefinedId: boolean;
  start: string;
  end: string;
  interpolate?: string;
  type?: string;
  stroke?: 'normal' | 'thick' | 'invisible' | 'dotted';
  style?: string[];
  length?: number;
  text: string;
  labelType: 'text' | 'markdown' | 'string';
  classes: string[];
  id?: string;
  animation?: 'fast' | 'slow';
  animate?: boolean;
}

export interface FlowClass {
  id: string;
  styles: string[];
  textStyles: string[];
}

export interface FlowSubGraph {
  classes: string[];
  dir?: string;
  id: string;
  labelType: string;
  nodes: string[];
  title: string;
}

export interface FlowLink {
  length?: number;
  stroke: string;
  type: string;
  /** Can be a string or an object with text and type properties from Jison parser */
  text?: string | { text: string; type: string };
}

/**
 * AST-specific types for ANTLR parser
 * These types enable AST generation, round-trip code generation, and bidirectional sync
 */

/**
 * Base diagram statement interface (imported from sequence diagram pattern)
 */
export interface DiagramStatement {
  type: string;
  originalIndex: number; // Sequential counter for source order
  data: unknown;
  sourceTokens?: { start: unknown; stop: unknown }; // Reference to original tokens
  sourceLine?: string; // Original source text for this statement - allows regenerating unchanged code
  dbIndex?: number; // DB index for SVG data-id matching
}

/**
 * Base diagram AST interface
 */
export interface DiagramAST {
  header: string;
  statements: DiagramStatement[];
  metadata?: Record<string, unknown>;

  /** Optional capability flags for additive AST extensions (recommended). */
  extensions?: Record<string, boolean>;

  /** Optional AST version string (advisory). */
  astVersion?: string;
}

/**
 * Flowchart statement types
 */
export type FlowchartStatementType =
  | 'vertex' // Node definition
  | 'edge' // Edge/link definition
  | 'subgraph' // Subgraph block
  | 'style' // Style statement
  | 'linkStyle' // Link style statement
  | 'classDef' // Class definition
  | 'class' // Class assignment
  | 'click' // Click interaction
  | 'direction' // Direction statement
  | 'accTitle' // Accessibility title
  | 'accDescr' // Accessibility description
  | 'comment' // Comment line
  | 'blankLine'; // Blank line

/**
 * Vertex (node) data for AST
 */
export interface VertexData {
  id: string;
  text?: string;
  type?: FlowVertexTypeParam;
  styles?: string[];
  classes?: string[];
  dir?: string;
  props?: any;
  metadata?: any;
}

/**
 * Edge (link) data for AST
 */
export interface EdgeData {
  start: string;
  end: string;
  type?: string;
  text?: string;
  stroke?: 'normal' | 'thick' | 'invisible' | 'dotted';
  length?: number;
  id?: string;
  /** SVG data-id attribute value in format L_start_end_counter */
  svgId?: string;
  interpolate?: string;
}

/**
 * Granular edge occurrence info for compound edge statements (additive-only).
 * Each occurrence corresponds to a syntactic edge as written in source.
 */
export interface FlowchartEdgeOccurrence {
  /** Stable identity for THIS edge occurrence in source */
  occurrenceId: string;

  /** Mirrors EdgeData.id / EdgeData.svgId */
  id: string;
  svgId?: string;

  /** Endpoints */
  start: string;
  end: string;

  /** Span specific to this occurrence (not the whole statement) */
  position: ElementPosition;

  /**
   * Optional tight span for this occurrence.
   * Leave `position` unchanged for backward compatibility.
   */
  exactPosition?: ElementPosition;

  /** Optional finer-grained spans (when available) */
  endTargetPosition?: ElementPosition;
  connectorPosition?: ElementPosition;

  /** Optional label span if available */
  labelPosition?: ElementPosition;

  /** Optional edge data mirrors (when available) */
  text?: string;
  stroke?: 'normal' | 'thick' | 'invisible' | 'dotted';
  length?: number;
  type?: string;

  /** Compound context */
  parentStatementId?: string;
  parentOriginalIndex?: number;
  occurrenceIndex?: number;
  compoundKind?: 'single' | 'and_list' | 'chain' | 'other';
}

/**
 * Statement-level summary of elements defined/referenced by a statement.
 */
export interface DefinedElements {
  edgeIds?: string[];
  nodeIds?: string[];
  inlineNodeDefs?: Record<string, VertexData>;
}

/**
 * Subgraph data for AST
 */
export interface SubgraphData {
  id: string;
  title: string;
  statements: FlowchartStatement[];
  dir?: string;
}

/**
 * Style statement data
 */
export interface StyleData {
  id: string;
  styles: string[];
}

/**
 * Link style statement data
 */
export interface LinkStyleData {
  indices: number[];
  styles: string[];
}

/**
 * Class definition data
 */
export interface ClassDefData {
  id: string;
  styles: string[];
}

/**
 * Class assignment data
 */
export interface ClassAssignmentData {
  ids: string[];
  className: string;
}

/**
 * Click interaction data
 */
export interface ClickData {
  nodeId: string;
  link?: string;
  tooltip?: string;
  target?: string;
}

/**
 * Direction data
 */
export interface DirectionData {
  direction: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
}

/**
 * Accessibility title data
 */
export interface AccTitleData {
  title: string;
}

/**
 * Accessibility description data
 */
export interface AccDescrData {
  description: string;
}

/**
 * Comment data
 */
export interface CommentData {
  text: string;
}

/**
 * Blank line data
 */
export type BlankLineData = Record<string, never>;

/**
 * Flowchart statement interface
 */
export interface FlowchartStatement extends DiagramStatement {
  type: FlowchartStatementType;
  data:
    | VertexData
    | EdgeData
    | SubgraphData
    | StyleData
    | LinkStyleData
    | ClassDefData
    | ClassAssignmentData
    | ClickData
    | DirectionData
    | AccTitleData
    | AccDescrData
    | CommentData
    | BlankLineData;

  /** Statement span in source (optional, additive-only) */
  position?: ElementPosition;

  /** Deterministic identifier for statement in a specific source snapshot */
  statementId?: string;

  /** All syntactic edge occurrences defined by this statement (for type: 'edge') */
  edgeOccurrences?: FlowchartEdgeOccurrence[];

  /**
   * For compound edge statements, explicitly indicates which occurrence the legacy
   * `statement.data` should be interpreted as describing.
   */
  dataRef?: { kind: 'edgeOccurrence'; occurrenceId: string; occurrenceIndex?: number };

  /**
   * Normalized, unambiguous representative edge for this statement.
   * Must match `edgeOccurrences[0]` projected into EdgeData shape.
   */
  primaryEdgeData?: EdgeData;

  /** Advisory flags for consumers */
  statementFlags?: { dataIsLegacyForCompoundEdges?: boolean };

  /** Explicit compound structure metadata for edge statements */
  compound?: {
    kind: 'and_list' | 'chain' | 'single' | 'other';
    separatorTokens?: { position: ElementPosition }[];
  };

  /** Summary of elements defined/referenced by this statement */
  definedElements?: DefinedElements;
}

/**
 * Element position for bidirectional sync
 */
export interface ElementPosition {
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
  startIndex: number;
  endIndex: number;
}

/**
 * Element mapping (code ↔ SVG)
 */
export interface FlowchartElementMapping {
  id: string;
  type: FlowchartStatementType;
  position: ElementPosition;
  svgId?: string;
  svgSelector?: string;

  /** Link mapping back to its parent statement (optional, additive-only) */
  statementId?: string;
  statementOriginalIndex?: number;
  /** For edge mappings: link to a specific syntactic edge occurrence */
  occurrenceId?: string;
  occurrenceIndex?: number;
  data:
    | VertexData
    | EdgeData
    | SubgraphData
    | StyleData
    | LinkStyleData
    | ClassDefData
    | ClassAssignmentData
    | ClickData
    | DirectionData;
}

/**
 * Complete Flowchart AST with bidirectional sync
 */
export interface FlowchartAST extends DiagramAST {
  header: 'flowchart' | 'graph';
  direction?: 'TB' | 'TD' | 'BT' | 'RL' | 'LR';
  statements: FlowchartStatement[];
  elementMappings?: FlowchartElementMapping[];
  metadata?: {
    title?: string;
    /**
     * Backwards-compat: a plain object so `Object.keys(metadata.nodes)` works (see instructions.md A1).
     */
    nodes?: Record<string, VertexData>;
    edges?: FlowEdge[];
    subgraphs?: Map<string, SubgraphData>;
    classes?: Map<string, ClassDefData>;
  };

  // Bidirectional sync methods (similar to SequenceAST)
  getElementAtPosition?(line: number, column: number): FlowchartElementMapping | undefined;
  getElementsOnLine?(line: number): FlowchartElementMapping[];
  getElementById?(id: string): FlowchartElementMapping | undefined;
  getElementAtIndex?(index: number): FlowchartElementMapping | undefined;
  getElementByDataId?(dataId: string): FlowchartElementMapping | undefined;
  getVertices?(): FlowchartElementMapping[];
  getEdges?(): FlowchartElementMapping[];
  getSubgraphs?(): FlowchartElementMapping[];
  getStats?(): {
    vertices: number;
    edges: number;
    subgraphs: number;
    totalElements: number;
  };
}
