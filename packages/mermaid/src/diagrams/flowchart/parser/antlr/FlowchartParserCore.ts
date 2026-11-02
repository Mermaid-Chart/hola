import type { ParserRuleContext, TerminalNode, ParseTree } from 'antlr4ng';
import type { VertexStatementContext } from './generated/FlowParser.js';
import { log } from '../../../../logger.js';
import { extractShapeFromVertexContext, extractTextFromCompleteToken } from './shape-utils.js';
import type { FlowText, FlowVertex, FlowEdge } from '../../types.js';

/**
 * Interface for ANTLR parser contexts used throughout the flowchart parser.
 * This interface extends ParserRuleContext with optional methods that correspond
 * to the ANTLR-generated context methods. Since different context types have
 * different subsets of these methods, they are all optional.
 *
 * The return types use ParserRuleContext to be compatible with the actual
 * ANTLR-generated context types which return specific subtypes.
 */
export interface FlowParserContext extends ParserRuleContext {
  // Child context accessors - these return either a context or null
  // Using ParserRuleContext as return type for compatibility with ANTLR-generated types
  node?(): ParserRuleContext | null;
  styledVertex?(): ParserRuleContext | null;
  vertex?(): ParserRuleContext | null;
  vertexShape?(): ParserRuleContext | null; // Added after left-factoring optimization
  shapeData?(): ParserRuleContext | null;
  idString?(): ParserRuleContext | ParserRuleContext[] | null;
  text?(): ParserRuleContext | null;
  textNoTags?(): ParserRuleContext | null;
  stringLiteral?(): ParserRuleContext[] | null;
  stylesOpt?(): ParserRuleContext | null;
  numList?(): ParserRuleContext | null;
  edgeText?(): ParserRuleContext | null;
  arrowText?(): ParserRuleContext | null;
  linkStatement?(): ParserRuleContext | null;
  alphaNum?(): ParserRuleContext | ParserRuleContext[] | null;
  // Terminal node accessors
  CLICK?(): TerminalNode | null;
  CALL?(): TerminalNode | null;
  HREF?(): TerminalNode | null;
  CALLBACKNAME?(): TerminalNode | null;
  CALLBACKARGS?(): TerminalNode | null;
  LINK_TARGET?(): TerminalNode | null;
  SQS?(): TerminalNode | null;
  STYLE_SEPARATOR?(): TerminalNode | null;
  LINK_ID?(): TerminalNode | null;
  DEFAULT?(): TerminalNode | null;
  INTERPOLATE?(): TerminalNode | null;
  ELLIPSE_COMPLETE?(): TerminalNode | null;
  // PERFORMANCE: Complete tokens that avoid mode transitions
  SQUARE_COMPLETE?(): TerminalNode | null;
  DIAMOND_COMPLETE?(): TerminalNode | null;
  CIRCLE_COMPLETE?(): TerminalNode | null;
  STADIUM_COMPLETE?(): TerminalNode | null;
  CYLINDER_COMPLETE?(): TerminalNode | null;
  SUBROUTINE_COMPLETE?(): TerminalNode | null;
  TRAPEZOID_COMPLETE?(): TerminalNode | null;
  INVTRAPEZOID_COMPLETE?(): TerminalNode | null;
  LEANRIGHT_COMPLETE?(): TerminalNode | null;
  LEANLEFT_COMPLETE?(): TerminalNode | null;
  // Link-related terminals
  LINK_NORMAL?(): TerminalNode | null;
  LINK_THICK?(): TerminalNode | null;
  LINK_DOTTED?(): TerminalNode | null;
  START_LINK_NORMAL?(): TerminalNode | null;
  START_LINK_NORMAL_NOSPACE?(): TerminalNode | null;
  START_LINK_THICK?(): TerminalNode | null;
  START_LINK_DOTTED?(): TerminalNode | null;
  LINK_STATEMENT_NORMAL?(): TerminalNode | null;
  LINK_STATEMENT_THICK?(): TerminalNode | null;
  LINK_STATEMENT_DOTTED?(): TerminalNode | null;
  LINK_INVISIBLE?(): TerminalNode | null;
}

/**
 * Type guard to check if a ParseTree node has a text() method
 */
function hasTextMethod(node: ParseTree): node is ParseTree & { text(): ParserRuleContext | null } {
  return 'text' in node && typeof (node as Record<string, unknown>).text === 'function';
}

/**
 * Helper to get a single context from a value that may be an array or single value
 */
function getFirstContext(
  ctx: ParserRuleContext | ParserRuleContext[] | null | undefined
): ParserRuleContext | null {
  if (!ctx) {
    return null;
  }
  if (Array.isArray(ctx)) {
    return ctx.length > 0 ? ctx[0] : null;
  }
  return ctx;
}

/**
 * Helper to get contexts as an array
 */
function getContextArray(
  ctx: ParserRuleContext | ParserRuleContext[] | null | undefined
): ParserRuleContext[] {
  if (!ctx) {
    return [];
  }
  if (Array.isArray(ctx)) {
    return ctx;
  }
  return [ctx];
}

// Interface for the FlowchartDB methods used by the parser
export interface FlowchartParserDB {
  setDirection(direction: string): void;
  setAccTitle(title: string): void;
  setAccDescription(desc: string): void;
  addSubGraph(
    id: { text: string },
    nodes: SubgraphNode[],
    title: { text: string; type: string }
  ): string;
  setClass(nodeId: string, className: string): void;
  addLink(startNodes: string[], endNodes: string[], linkData: LinkData): void;
  addVertex(
    id: string,
    textObj: FlowText | undefined,
    shape: string | undefined,
    styles: string[],
    classes: string[],
    dir: string,
    props: Record<string, unknown>,
    shapeDataYaml: string
  ): void;
  updateLinkInterpolate(positions: number[], interpolate: string): void;
  updateLink(positions: number[], styles: string[]): void;
  addClass(className: string, styles: string[]): void;
  setClickEvent(nodeId: string, functionName: string, functionArgs?: string): void;
  setLink(nodeId: string, link: string, target?: string): void;
  setTooltip(nodeId: string, tooltip: string): void;
  // Optional methods used by ANTLR parser
  clear?(): void;
  setAST?(ast: unknown): void;
  updateASTWithEdges?(): void;
  // Optional methods for accessing parsed data (available on FlowDB)
  getVertices?(): Map<string, FlowVertex>;
  getEdges?(): FlowEdge[];
}

// Interfaces for subgraph data
interface SubgraphData {
  id: string;
  title: string;
  nodes: string[];
  edges: unknown[];
}

interface DirectionStatement {
  stmt: 'dir';
  value: string;
}

type SubgraphNode = string | DirectionStatement;

// Interface for link data returned from extractLinkData
interface LinkData {
  text: { text: string; type: string };
  type: string;
  stroke: string;
  length: number;
  id?: string;
}

/**
 * Core shared logic for both Listener and Visitor patterns
 * Contains all the proven parsing logic that achieves 99.1% test compatibility
 */
export class FlowchartParserCore {
  protected db: FlowchartParserDB;
  protected subgraphStack: SubgraphData[] = [];
  protected currentSubgraphNodes: SubgraphNode[][] = []; // Stack of node lists for nested subgraphs
  protected direction = 'TB'; // Default direction
  protected subgraphTitleTypeStack: string[] = []; // Stack to track title types for nested subgraphs
  protected processCount = 0; // Track processing calls for performance logging

  // Reserved keywords that cannot be used as node ID prefixes
  private static readonly RESERVED_KEYWORDS = [
    'graph',
    'flowchart',
    'flowchart-elk',
    'style',
    'linkStyle',
    'interpolate',
    'classDef',
    'class',
    '_self',
    '_blank',
    '_parent',
    '_top',
    'end',
    'subgraph',
  ];

  constructor(db: FlowchartParserDB) {
    this.db = db;
  }

  // Direction processing methods
  protected processDirectionStatement(direction: string): void {
    this.direction = this.normalizeDirection(direction);
    this.db.setDirection(this.direction);
  }

  // Graph declaration processing (handles "graph >", "flowchart ^", etc.)
  protected processGraphDeclaration(ctx: ParserRuleContext): void {
    const graphText = ctx.getText();

    // Extract direction from graph declaration: "graph >", "flowchart ^", etc.
    const directionMatch = /(?:graph|flowchart|flowchart-elk)\s*([<>^v]|TB|TD|BT|LR|RL)/.exec(
      graphText
    );
    if (directionMatch) {
      const direction = directionMatch[1];
      this.processDirectionStatement(direction);
    } else {
      // Set default direction if none specified
      this.processDirectionStatement('TB');
    }
  }

  protected normalizeDirection(dir: string): string {
    switch (dir) {
      case 'TD':
        return 'TB';
      case '<':
        return 'RL';
      case '>':
        return 'LR';
      case '^':
        return 'BT';
      case 'v':
        return 'TB';
      default:
        return dir;
    }
  }

  // Accessibility processing methods
  protected processAccTitleStatement(title: string): void {
    this.db.setAccTitle(title);
  }

  protected processAccDescStatement(desc: string): void {
    this.db.setAccDescription(desc);
  }

  // Subgraph processing methods
  protected processSubgraphStatement(id: string, title?: string): void {
    // Stack is already initialized in processSubgraphStatementCore before title extraction

    const subgraphData: SubgraphData = {
      id: id,
      title: title ?? id, // Use id if title is null/undefined
      nodes: [],
      edges: [],
    };
    this.subgraphStack.push(subgraphData);
    // Push a new node list for this subgraph to track direction statements
    this.currentSubgraphNodes.push([]);
    // Don't call addSubGraph here - wait until we have all nodes
  }

  protected processSubgraphEnd(): void {
    if (this.subgraphStack.length > 0) {
      const completedSubgraph = this.subgraphStack.pop();
      // Pop the current subgraph's node list and merge it with the subgraph nodes
      const currentNodes = this.currentSubgraphNodes.pop() ?? [];
      const allNodes = [...(completedSubgraph?.nodes ?? []), ...currentNodes];

      // Now call addSubGraph with the complete list of nodes
      // Pop the title type for this subgraph from the stack
      const titleType = this.subgraphTitleTypeStack.pop() ?? 'text';

      const subgraphId = this.db.addSubGraph({ text: completedSubgraph?.id ?? '' }, allNodes, {
        text: completedSubgraph?.title ?? '',
        type: titleType,
      });

      // Add the completed subgraph's ID to the parent subgraph's node list (for nested subgraphs)
      if (this.subgraphStack.length > 0) {
        const parentSubgraph = this.subgraphStack.at(-1);
        if (parentSubgraph && !parentSubgraph.nodes.includes(subgraphId)) {
          parentSubgraph.nodes.push(subgraphId);
        }
      }
    }
  }

  // Core vertex statement processing - shared by both Listener and Visitor
  protected processVertexStatementCore(ctx: VertexStatementContext): void {
    // Handle the current node
    const nodeCtx = ctx.node();
    const shapeDataCtx = ctx.shapeData();

    if (nodeCtx) {
      // The vertexStatement-level shapeData should apply to the rightmost node
      // in the ampersand chain, but only if that node doesn't have its own shapeData
      this.processNodeWithVertexStatementShapeData(
        nodeCtx as unknown as FlowParserContext,
        shapeDataCtx as unknown as FlowParserContext | null
      );
    }

    // Handle edges (links) - this is where A-->B gets processed
    const linkCtx = ctx.link();
    const prevVertexCtx = ctx.vertexStatement();

    if (linkCtx && prevVertexCtx && nodeCtx) {
      // We have a link: prevVertex --link--> currentNode
      // Extract arrays of node IDs to handle ampersand chaining
      const startNodeIds = this.extractNodeIds(prevVertexCtx as unknown as FlowParserContext);
      const endNodeIds = this.extractNodeIds(nodeCtx as unknown as FlowParserContext);

      if (startNodeIds.length > 0 && endNodeIds.length > 0) {
        this.processEdgeArray(startNodeIds, endNodeIds, linkCtx as unknown as FlowParserContext);
      }
    }
  }

  // Core node processing - moved from Listener for shared use
  protected processNode(
    nodeCtx: FlowParserContext | null,
    shapeDataCtx?: FlowParserContext | null
  ): void {
    // Process all styled vertices in this node (handles ampersand chaining)
    this.processAllStyledVerticesInNode(nodeCtx, shapeDataCtx);
  }

  // Process a node with vertexStatement-level shape data
  // The shape data should only apply to the rightmost node if it doesn't have its own
  protected processNodeWithVertexStatementShapeData(
    nodeCtx: FlowParserContext | null,
    shapeDataCtx?: FlowParserContext | null
  ): void {
    if (!nodeCtx) {
      return;
    }

    // For ampersand chains, we need to apply the vertexStatement-level shapeData
    // only to the rightmost node, and only if that node doesn't have its own shapeData
    this.processAllStyledVerticesInNodeWithRightmostShapeData(nodeCtx, shapeDataCtx);
  }

  // Recursively process all styled vertices in a node context
  protected processAllStyledVerticesInNode(
    nodeCtx: FlowParserContext | null,
    shapeDataCtx?: FlowParserContext | null
  ): void {
    if (!nodeCtx) {
      return;
    }

    this.processCount++;

    // For left-recursive grammar, process nested node first (left side)
    const nestedNodeCtx = nodeCtx.node?.();
    if (nestedNodeCtx) {
      // Recursively process the nested node first
      // IMPORTANT: Do NOT pass shapeDataCtx to nested nodes in ampersand chains
      // Each node should use only its own local shape data
      this.processAllStyledVerticesInNode(nestedNodeCtx);
    }

    // Then process the direct styled vertex (right side)
    const styledVertexCtx = nodeCtx.styledVertex?.();
    if (styledVertexCtx) {
      // For ampersand chains, only use the passed shapeDataCtx if this is the first node
      // Otherwise, each node should use only its own local shape data
      const effectiveShapeDataCtx = nestedNodeCtx ? undefined : shapeDataCtx;
      this.processSingleStyledVertex(styledVertexCtx, effectiveShapeDataCtx);
    }
  }

  // Process all styled vertices with rightmost shape data application
  protected processAllStyledVerticesInNodeWithRightmostShapeData(
    nodeCtx: FlowParserContext,
    shapeDataCtx?: FlowParserContext | null,
    isOutermostLevel = true
  ): void {
    if (!nodeCtx) {
      return;
    }

    // For left-recursive grammar, process nested node first (left side)
    const nestedNodeCtx = nodeCtx.node?.() as FlowParserContext | null;
    if (nestedNodeCtx) {
      // Recursively process the nested node first, but don't pass shape data
      this.processAllStyledVerticesInNodeWithRightmostShapeData(nestedNodeCtx, undefined, false);
    }

    // Then process the direct styled vertex (right side)
    const styledVertexCtx = nodeCtx.styledVertex?.() as FlowParserContext | null;

    if (styledVertexCtx) {
      // The rightmost node is the styledVertex that is directly under the outermost node context
      // In left-recursive grammar, this is the styledVertex at the outermost level
      const isRightmostNode = isOutermostLevel;
      const hasLocalShapeData = styledVertexCtx.shapeData?.();
      const effectiveShapeDataCtx =
        isRightmostNode && !hasLocalShapeData ? shapeDataCtx : undefined;

      this.processSingleStyledVertex(styledVertexCtx, effectiveShapeDataCtx);
    }
  }

  // Process a single styled vertex
  protected processSingleStyledVertex(
    styledVertexCtx: FlowParserContext,
    shapeDataCtx?: FlowParserContext | null
  ): void {
    const vertexCtx = styledVertexCtx.vertex?.() as FlowParserContext | null;
    if (!vertexCtx) {
      return;
    }

    // Get node ID for debugging
    const idCtx = getFirstContext(vertexCtx.idString?.());
    const nodeId = idCtx ? idCtx.getText() : '';

    // Check if this styled vertex has its own shape data
    const localShapeDataCtx = styledVertexCtx.shapeData?.() as FlowParserContext | null;
    const effectiveShapeDataCtx = localShapeDataCtx ?? shapeDataCtx;

    // Validate node ID against reserved keywords
    this.validateNodeId(nodeId);

    // Always process as regular vertex first to create the vertex
    this.processRegularVertex(styledVertexCtx, effectiveShapeDataCtx);

    // Then check for class application pattern: vertex STYLE_SEPARATOR idString
    const children = styledVertexCtx.children;
    if (children && children.length >= 3) {
      // Look for STYLE_SEPARATOR (:::) pattern
      for (let i = 0; i < children.length - 1; i++) {
        const child = children[i];
        if (
          'getText' in child &&
          typeof child.getText === 'function' &&
          child.getText() === ':::'
        ) {
          // Found STYLE_SEPARATOR, next should be the class name
          const nextChild = children[i + 1];
          const className =
            'getText' in nextChild && typeof nextChild.getText === 'function'
              ? nextChild.getText()
              : '';
          if (className) {
            // Apply class to vertex: setClass(vertex, className)
            this.db.setClass(nodeId, className);
          }
        }
      }
    }
  }

  protected extractNodeIds(nodeCtx: FlowParserContext | null): string[] {
    if (!nodeCtx) {
      return [];
    }

    const nodeIds: string[] = [];

    // For VertexStatementContext, get the node
    if (nodeCtx.node) {
      const node = nodeCtx.node();
      if (node) {
        // Recursively collect all node IDs from the node context
        this.collectNodeIdsFromNode(node, nodeIds);
      }
    }

    // For NodeContext directly
    if (nodeCtx.styledVertex) {
      this.collectNodeIdsFromNode(nodeCtx, nodeIds);
    }

    return nodeIds;
  }

  // Helper method to collect node IDs from a node context
  protected collectNodeIdsFromNode(nodeCtx: FlowParserContext | null, nodeIds: string[]): void {
    if (!nodeCtx) {
      return;
    }

    // For NodeContext, handle nested node first to maintain correct order (A & B should be [A, B])
    if (nodeCtx.node) {
      const nestedNodeCtx = nodeCtx.node() as FlowParserContext | null;
      if (nestedNodeCtx) {
        this.collectNodeIdsFromNode(nestedNodeCtx, nodeIds);
      }
    }

    // Then handle the direct styled vertex
    if (nodeCtx.styledVertex) {
      const styledVertexCtx = nodeCtx.styledVertex() as FlowParserContext | null;
      if (styledVertexCtx) {
        const vertexCtx = styledVertexCtx.vertex?.() as FlowParserContext | null;
        if (vertexCtx) {
          const idCtx = getFirstContext(vertexCtx.idString?.());
          if (idCtx) {
            const nodeId = idCtx.getText();
            if (nodeId && !nodeIds.includes(nodeId)) {
              nodeIds.push(nodeId);
            }
          }
        }
      }
    }

    // Handle other children recursively (but skip node and styledVertex as they're handled above)
    if (nodeCtx.children) {
      for (const child of nodeCtx.children) {
        // Skip node and styledVertex contexts as they're handled above
        const childCtx = child as FlowParserContext;
        if (
          childCtx &&
          typeof childCtx.node !== 'function' &&
          typeof childCtx.styledVertex !== 'function'
        ) {
          this.collectNodeIdsFromNode(childCtx, nodeIds);
        }
      }
    }
  }

  protected processEdgeArray(
    startNodeIds: string[],
    endNodeIds: string[],
    linkCtx: FlowParserContext
  ): void {
    // Extract link information
    const linkData = this.extractLinkData(linkCtx);

    // Use the database's addLink method which handles all combinations
    this.db.addLink(startNodeIds, endNodeIds, linkData);

    // Track nodes in current subgraph if we're inside one
    if (this.subgraphStack.length > 0) {
      const currentSubgraph = this.subgraphStack.at(-1);

      // Add start nodes first, then end nodes
      for (const startNodeId of startNodeIds) {
        if (currentSubgraph && !currentSubgraph.nodes.includes(startNodeId)) {
          currentSubgraph.nodes.unshift(startNodeId);
        }
      }
      for (const endNodeId of endNodeIds) {
        if (currentSubgraph && !currentSubgraph.nodes.includes(endNodeId)) {
          currentSubgraph.nodes.unshift(endNodeId);
        }
      }
    }
  }

  // Validate that a node ID doesn't start with reserved keywords
  protected validateNodeId(nodeId: string | null): void {
    if (!nodeId) {
      return; // Skip validation for null/undefined nodeId
    }

    for (const keyword of FlowchartParserCore.RESERVED_KEYWORDS) {
      if (
        nodeId.startsWith(keyword + '.') ||
        nodeId.startsWith(keyword + '-') ||
        nodeId.startsWith(keyword + '/')
      ) {
        throw new Error(`Node ID cannot start with reserved keyword: ${keyword}`);
      }
    }
  }

  protected processRegularVertex(
    styledVertexCtx: FlowParserContext,
    shapeDataCtx?: FlowParserContext | null
  ): void {
    // Extract node ID from styled vertex
    const nodeId = this.extractNodeId(styledVertexCtx);
    if (!nodeId) {
      return;
    }

    // Validate node ID against reserved keywords
    this.validateNodeId(nodeId);

    // Extract vertex context to get text and shape
    const vertexCtx = styledVertexCtx.vertex?.() as FlowParserContext | null;
    if (!vertexCtx) {
      return;
    }

    // After left-factoring optimization, text is in vertexShape child
    const vertexShapeCtx = vertexCtx.vertexShape?.() as FlowParserContext | null;

    // Get node text - if there's explicit text, use it, otherwise pass undefined
    // to preserve any existing label
    const textCtx = vertexShapeCtx?.text?.() as FlowParserContext | null;
    let textObj: FlowText | undefined;
    if (textCtx) {
      const textWithType = this.extractTextWithType(textCtx);
      // FlowText requires type to be 'text' literal
      textObj = { text: textWithType.text, type: 'text' };
    } else {
      // Try to extract text from complete tokens using shared utility
      const extractedText = extractTextFromCompleteToken(vertexShapeCtx);
      if (extractedText !== null) {
        textObj = { text: extractedText, type: 'text' };
      } else {
        // No explicit text - pass undefined to preserve existing label
        textObj = undefined;
      }
    }

    // Get node shape from vertex context using shared utility
    const nodeShape = extractShapeFromVertexContext(vertexCtx);

    // Process shape data if present
    let shapeDataYaml = '';
    if (shapeDataCtx) {
      shapeDataYaml = this.processShapeData(shapeDataCtx);
    }

    // Add vertex to database
    this.db.addVertex(nodeId, textObj, nodeShape, [], [], '', {}, shapeDataYaml);

    // Track individual nodes in current subgraph if we're inside one
    if (this.subgraphStack.length > 0) {
      const currentSubgraph = this.subgraphStack.at(-1);
      if (currentSubgraph && !currentSubgraph.nodes.includes(nodeId)) {
        currentSubgraph.nodes.unshift(nodeId);
      }
    }
  }

  // Helper methods (simplified versions for now)
  protected extractNodeId(styledVertexCtx: FlowParserContext | null): string | null {
    if (!styledVertexCtx) {
      return null;
    }
    const vertexCtx = styledVertexCtx.vertex?.() as FlowParserContext | null;
    if (!vertexCtx) {
      return null;
    }
    const idCtx = getFirstContext(vertexCtx.idString?.());
    return idCtx ? idCtx.getText() : null;
  }

  protected extractLinkData(linkCtx: FlowParserContext): LinkData {
    let linkText = '';
    let linkTextType = 'text';
    let stroke = 'normal';
    let length = 1;
    let type = 'arrow_point'; // default arrow type
    let edgeId = null;

    if (!linkCtx) {
      return {
        text: { text: linkText, type: linkTextType },
        type,
        stroke,
        length,
      };
    }

    // Get the raw link text to analyze arrow type and stroke
    const linkText_raw = linkCtx.getText();

    // Extract edge ID if present (e.g., "e1@-->")
    const idMatch = /^([^@]+)@/.exec(linkText_raw);
    if (idMatch) {
      edgeId = idMatch[1];
    }

    // Extract link text if present - try multiple ways to find text
    let textCtx = null;

    // Method 0: Check for arrowText() method (for pipe-delimited text)
    // Jison has two different behaviors:
    // 1. "linkStatement arrowText" (e.g., A -->|text| B) - pipes are stripped
    // 2. "LINK_STATEMENT_* arrowText LINK_*" (e.g., A --|text|--> B) - pipes are kept
    if (linkCtx.arrowText && typeof linkCtx.arrowText === 'function') {
      const arrowTextCtx = linkCtx.arrowText() as FlowParserContext | null;
      if (arrowTextCtx) {
        // Check if linkStatement exists - if so, we strip pipes (pattern 1)
        // If linkStatement doesn't exist, we keep pipes (pattern 2)
        const hasLinkStatement =
          linkCtx.linkStatement && typeof linkCtx.linkStatement === 'function'
            ? !!linkCtx.linkStatement()
            : false;

        if (hasLinkStatement) {
          // Pattern 1: linkStatement arrowText - extract text without pipes
          // The text() inside arrowText has the actual content
          const innerTextCtx = arrowTextCtx.text?.() as FlowParserContext | null;
          if (innerTextCtx) {
            const textWithType = this.extractTextWithType(innerTextCtx);
            linkText = textWithType.text;
            linkTextType = textWithType.type;
          }
        } else {
          // Pattern 2: LINK_STATEMENT_* arrowText LINK_* - keep the pipes
          const arrowTextRaw = arrowTextCtx.getText();
          linkText = arrowTextRaw; // Keep the full |text| including pipes
        }
        textCtx = arrowTextCtx; // Mark as found so we skip other methods
      }
    }

    // Method 1: Direct edgeText() method (for inline edge text like --<<include>>-->)
    if (!textCtx && linkCtx.edgeText && typeof linkCtx.edgeText === 'function') {
      textCtx = linkCtx.edgeText() as FlowParserContext | null;
    }

    // Method 2: Direct text() method
    if (!textCtx && linkCtx.text && typeof linkCtx.text === 'function') {
      textCtx = linkCtx.text() as FlowParserContext | null;
    }

    // Method 3: Look for text in children
    if (!textCtx && linkCtx.children) {
      for (const child of linkCtx.children) {
        if (child.constructor.name.includes('Text') || hasTextMethod(child)) {
          if (hasTextMethod(child)) {
            textCtx = child.text() as FlowParserContext | null;
          } else {
            textCtx = child as unknown as FlowParserContext;
          }
          break;
        }
      }
    }

    // Method 4: Extract text from patterns like |text| or "text"
    if (!textCtx) {
      // For pipe-delimited text (|text|), Jison keeps the pipes in the text
      // so we need to match the full pattern including pipes
      const pipeMatch = /(\|[^|]*\|)/.exec(linkText_raw);
      if (pipeMatch) {
        linkText = pipeMatch[1]; // Keep the full |text| including pipes
      } else {
        const textMatch =
          /"([^"]*`[^"]*)"/.exec(linkText_raw) ?? // Handle quotes with backticks inside: "`content`"
          /"([^"]*)"/.exec(linkText_raw) ?? // Handle regular quotes: "content"
          /--\s+([^-]+?)\s+--/.exec(linkText_raw) ??
          /==\s+([^=]+?)\s+==/.exec(linkText_raw) ??
          /-\.\s*([^.]+?)\s*\.+-/.exec(linkText_raw); // Handle both "-.text.->" and "-. text .->"

        if (textMatch) {
          linkText = textMatch[1];

          // Check if extracted text contains backticks (markdown inside quotes)
          if (linkText.startsWith('`') && linkText.endsWith('`')) {
            linkTextType = 'markdown';
            linkText = linkText.slice(1, -1); // Remove backticks like Jison does
          }
        }
      }
    } else if (textCtx && !linkText) {
      // Use the same text processing logic as nodes for consistency
      // But only if linkText wasn't already set (e.g., by arrowText)
      const textWithType = this.extractTextWithType(textCtx);
      linkText = textWithType.text;
      linkTextType = textWithType.type;
    }

    // Extract the pure link pattern without text for destructLink analysis
    let linkPattern = linkText_raw;

    // For LINK_STATEMENT_* arrowText LINK_* patterns, we should use just the LINK_* token
    // to calculate the link info, not the whole concatenated text
    // Check for LINK_NORMAL, LINK_THICK, LINK_DOTTED tokens
    const linkNormalToken = linkCtx.LINK_NORMAL ? linkCtx.LINK_NORMAL() : null;
    const linkThickToken = linkCtx.LINK_THICK ? linkCtx.LINK_THICK() : null;
    const linkDottedToken = linkCtx.LINK_DOTTED ? linkCtx.LINK_DOTTED() : null;
    const arrowTextCtx = linkCtx.arrowText ? linkCtx.arrowText() : null;

    // If we have arrowText AND a LINK_* token (not linkStatement pattern),
    // use just the LINK_* token for pattern analysis
    if (arrowTextCtx && !linkCtx.linkStatement?.()) {
      if (linkNormalToken) {
        linkPattern = linkNormalToken.getText().trim();
      } else if (linkThickToken) {
        linkPattern = linkThickToken.getText().trim();
      } else if (linkDottedToken) {
        linkPattern = linkDottedToken.getText().trim();
      }
    } else {
      // Remove edge ID if present (e.g., "e1@<-- text -->" -> "<-- text -->")
      if (edgeId) {
        linkPattern = linkText_raw.replace(/^[^@]+@/, '');
      }

      // Remove text from link pattern for destructLink analysis
      // Handle different text patterns:
      // 1. --x|text| -> --x
      // 2. -- text --x -> --x
      // 3. <-- text --> -> <-- and -->

      // Pattern 1: Remove |text| from patterns like --x|text|
      linkPattern = linkPattern.replace(/\|[^|]*\|/, '');
    }

    // Pattern 2: Remove text from patterns like "-- text --x" -> "--x"
    // Look for pattern: START_PATTERN text END_PATTERN
    const textInMiddleMatch = /^(\s*-+)\s+(.+?)\s+(-+[>ox]?\s*)$/.exec(linkPattern);
    if (textInMiddleMatch) {
      const startPart = textInMiddleMatch[1]; // "--"
      const endPart = textInMiddleMatch[3]; // "--x"
      linkPattern = startPart + endPart; // "--" + "--x" = "----x"
      // But we want just the end part for single arrows
      linkPattern = endPart.trim();
    }

    // For patterns with text, extract just the link pattern parts
    // Examples: "<-- text -->" -> "<-->"
    //          "x-- text --x" -> "x--x"
    //          "o== text ==o" -> "o==o"
    if (linkText) {
      // Double-ended patterns with text
      // Note: \s* allows optional whitespace between arrows and text (handles both "-- text --" and "--text--")
      const doublePatterns = [
        { regex: /^\s*<--+\s*.+?\s+--+>\s*$/, replacement: '<-->' }, // <-- text --> or <--text --> -> <-->
        { regex: /^\s*<==+\s*.+?\s+==+>\s*$/, replacement: '<==>' }, // <== text ==> or <==text ==> -> <==>
        { regex: /^\s*<-\.+\s*.+?\s+\.+->\s*$/, replacement: '<-.->' }, // <-. text .-> or <-.text .-> -> <-.->
        { regex: /^\s*x--+\s*.+?\s+--+x\s*$/, replacement: 'x--x' }, // x-- text --x or x--text --x -> x--x
        { regex: /^\s*x==+\s*.+?\s+==+x\s*$/, replacement: 'x==x' }, // x== text ==x or x==text ==x -> x==x
        { regex: /^\s*x-\.+\s*.+?\s+\.+-x\s*$/, replacement: 'x-.-x' }, // x-. text .-x or x-.text .-x -> x-.-x
        { regex: /^\s*o--+\s*.+?\s+--+o\s*$/, replacement: 'o--o' }, // o-- text --o or o--text --o -> o--o
        { regex: /^\s*o==+\s*.+?\s+==+o\s*$/, replacement: 'o==o' }, // o== text ==o or o==text ==o -> o==o
        { regex: /^\s*o-\.+\s*.+?\s+\.+-o\s*$/, replacement: 'o-.-o' }, // o-. text .-o or o-.text .-o -> o-.-o
      ];

      for (const pattern of doublePatterns) {
        if (pattern.regex.test(linkPattern)) {
          linkPattern = linkPattern.replace(pattern.regex, pattern.replacement);
          break;
        }
      }

      // Single-ended patterns with text (e.g., "-- text -->" -> "-->")
      const singlePatterns = [
        { regex: /^--+\s+.+?\s+--+[>ox]$/, replacement: '-->' }, // -- text --> -> -->
        { regex: /^==+\s+.+?\s+==+[>ox]$/, replacement: '==>' }, // == text ==> -> ==>
        { regex: /^-\.+\s+.+?\s+\.+-[>ox]$/, replacement: '.->' }, // -. text .-> -> .->
        { regex: /^--+\|.+?\|$/, replacement: '---' }, // ---|text| -> ---
        { regex: /^==+\|.+?\|$/, replacement: '===' }, // ===|text| -> ===
        { regex: /^-\.+\|.+?\|$/, replacement: '-.-' }, // -.-|text| -> -.-
        // Handle labeled edges - preserve the length from the right side
        {
          regex: /^\s*--\s+.+?\s+(--+)\s*$/,
          replacement: (_match: string, p1: string) => p1,
        }, // -- Label --- -> ---
        {
          regex: /^\s*==\s+.+?\s+(==+)\s*$/,
          replacement: (_match: string, p1: string) => p1,
        }, // == Label === -> ===
        {
          regex: /^\s*-\.\s+.+?\s+(\.+-)\s*$/,
          replacement: (_match: string, p1: string) => p1,
        }, // -. Label .- -> -.-
        // Handle labeled edges with arrows - preserve the length from the right side
        {
          regex: /^\s*--\s+.+?\s+(--+)>\s*$/,
          replacement: (_match: string, p1: string) => p1 + '>',
        }, // -- Label --> -> -->
        {
          regex: /^\s*==\s+.+?\s+(==+)>\s*$/,
          replacement: (_match: string, p1: string) => p1 + '>',
        }, // == Label ==> -> ==>
        {
          regex: /^\s*-\.\s+.+?\s+(\.+-)>\s*$/,
          replacement: (_match: string, p1: string) => p1 + '>',
        }, // -. Label .-> -> .->
        // Handle inline edge text WITHOUT spaces (e.g., "--<<include>>-->" -> "-->")
        {
          regex: /^\s*(--+).+?(--+[>ox])\s*$/,
          replacement: (_match: string, _p1: string, p2: string) => p2.trim(),
        }, // --text--> -> -->
        {
          regex: /^\s*(==+).+?(==+[>ox])\s*$/,
          replacement: (_match: string, _p1: string, p2: string) => p2.trim(),
        }, // ==text==> -> ==>
        {
          regex: /^\s*(-\.+).+?(\.+-[>ox])\s*$/,
          replacement: (_match: string, _p1: string, p2: string) => p2.trim(),
        }, // -.text.-> -> .->
      ];

      for (const pattern of singlePatterns) {
        if (pattern.regex.test(linkPattern)) {
          if (typeof pattern.replacement === 'function') {
            linkPattern = linkPattern.replace(pattern.regex, pattern.replacement);
          } else {
            linkPattern = pattern.replacement;
          }
          break;
        }
      }
    }

    // Use destructLink logic to determine arrow type and stroke
    // Check if this is a double arrow pattern
    const doubleArrowMatch = /^\s*(<[.=-]+)\s+.+?\s+([.=-]+>)\s*$/.exec(linkPattern);
    let linkInfo;
    if (doubleArrowMatch) {
      // Double arrow: call destructLink with both start and end parts
      const startLink = doubleArrowMatch[1]; // e.g., "<--"
      const endLink = doubleArrowMatch[2]; // e.g., "-->"
      linkInfo = this.destructLink(endLink, startLink);
    } else {
      // Single arrow: call destructLink with just the pattern
      linkInfo = this.destructLink(linkPattern);
    }
    type = linkInfo.type;
    stroke = linkInfo.stroke;
    length = linkInfo.length;

    const result: LinkData = {
      text: { text: linkText, type: linkTextType },
      type,
      stroke,
      length,
    };

    if (edgeId) {
      result.id = edgeId;
    }

    return result;
  }

  // Implement destructLink logic from FlowDB
  private destructStartLink(str: string): { type: string; stroke: string } {
    str = str.trim();
    let type = 'arrow_open';

    switch (str[0]) {
      case '<':
        type = 'arrow_point';
        str = str.slice(1);
        break;
      case 'x':
        type = 'arrow_cross';
        str = str.slice(1);
        break;
      case 'o':
        type = 'arrow_circle';
        str = str.slice(1);
        break;
    }

    let stroke = 'normal';

    if (str.includes('=')) {
      stroke = 'thick';
    }

    if (str.includes('.')) {
      stroke = 'dotted';
    }

    return { type, stroke };
  }

  private countChar(char: string, str: string): number {
    const length = str.length;
    let count = 0;
    for (let i = 0; i < length; ++i) {
      if (str[i] === char) {
        ++count;
      }
    }
    return count;
  }

  private destructEndLink(str: string): { type: string; stroke: string; length: number } {
    str = str.trim();
    let line = str.slice(0, -1);
    let type = 'arrow_open';

    switch (str.slice(-1)) {
      case 'x':
        type = 'arrow_cross';
        if (str.startsWith('x')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
      case '>':
        type = 'arrow_point';
        if (str.startsWith('<')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
      case 'o':
        type = 'arrow_circle';
        if (str.startsWith('o')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
    }

    let stroke = 'normal';
    let length = line.length - 1;

    if (line.startsWith('=')) {
      stroke = 'thick';
    }

    if (line.startsWith('~')) {
      stroke = 'invisible';
    }

    const dots = this.countChar('.', line);

    if (dots) {
      stroke = 'dotted';
      length = dots;
    }

    return { type, stroke, length };
  }

  private destructLink(
    str: string,
    startStr?: string
  ): { type: string; stroke: string; length: number } {
    const info = this.destructEndLink(str);
    let startInfo;
    if (startStr) {
      startInfo = this.destructStartLink(startStr);

      if (startInfo.stroke !== info.stroke) {
        return { type: 'INVALID', stroke: 'INVALID', length: 1 };
      }

      if (startInfo.type === 'arrow_open') {
        // -- xyz -->  - take arrow type from ending
        startInfo.type = info.type;
      } else {
        // x-- xyz -->  - not supported
        if (startInfo.type !== info.type) {
          return { type: 'INVALID', stroke: 'INVALID', length: 1 };
        }

        startInfo.type = 'double_' + startInfo.type;
      }

      if (startInfo.type === 'double_arrow') {
        startInfo.type = 'double_arrow_point';
      }

      return { type: startInfo.type, stroke: startInfo.stroke, length: info.length };
    }

    return info;
  }

  protected extractTextWithType(textCtx: FlowParserContext | null): { text: string; type: string } {
    if (!textCtx) {
      return { text: '', type: 'text' };
    }

    let text = textCtx.getText();
    let type = 'text';

    // Check parse tree structure to detect string types (since ANTLR lexer strips quotes)
    if (textCtx.children) {
      for (const child of textCtx.children) {
        const childCtx = child as FlowParserContext;
        // Check for stringLiteral (quoted strings) - quotes already stripped by lexer
        if (childCtx.constructor.name === 'StringLiteralContext' || childCtx.stringLiteral?.()) {
          type = 'string';

          // Special case: Check if quoted string contains backticks (markdown inside quotes)
          // This matches Jison behavior where "`content`" inside quotes becomes markdown
          if (text.startsWith('`') && text.endsWith('`')) {
            type = 'markdown';
            text = text.slice(1, -1); // Remove backticks like Jison does
          }
          break;
        }
        // Check for EdgeTextTokenContext (edge text tokens)
        else if (childCtx.constructor.name === 'EdgeTextTokenContext') {
          // Edge text can contain quoted strings with backticks
          // Handle pattern: "`content`" -> markdown with backticks stripped
          if (/^"[^"]*`[^`]*`[^"]*"\s*$/.exec(text)) {
            type = 'markdown';
            // Extract content between quotes and strip backticks
            const match = /^"([^"]*)"(\s*)$/.exec(text);
            if (match) {
              let content = match[1];
              if (content.startsWith('`') && content.endsWith('`')) {
                content = content.slice(1, -1); // Remove backticks
              }
              text = content;
            }
          }
          // Handle regular quoted strings: "content" -> string
          else if (/^"[^"]*"\s*$/.exec(text)) {
            type = 'string';
            // Extract content between quotes
            const match = /^"([^"]*)"\s*$/.exec(text);
            if (match) {
              text = match[1];
            }
          }
          break;
        }
        // Check for MD_STR (markdown strings with backticks)
        else if (
          'symbol' in childCtx &&
          (
            childCtx as unknown as { symbol: { type: number; text: string } }
          ).symbol?.text?.includes('`')
        ) {
          type = 'markdown';
          // Strip backticks for markdown (matches Jison behavior)
          if (text.startsWith('`') && text.endsWith('`')) {
            text = text.slice(1, -1);
          }
          break;
        }
      }
    }

    // Fallback: Check text content for markdown backticks (for cases where parse tree detection fails)
    if (type === 'text' && text.startsWith('`') && text.endsWith('`')) {
      type = 'markdown';
      text = text.slice(1, -1); // Remove backticks like Jison does
    }
    return { text, type };
  }

  protected processShapeData(shapeDataCtx: FlowParserContext | null): string {
    if (!shapeDataCtx) {
      return '';
    }

    const shapeDataText = shapeDataCtx.getText();

    // Extract the content between { and } for YAML parsing
    let yamlContent = shapeDataText;

    // Remove the @ prefix if present
    if (yamlContent.startsWith('@')) {
      yamlContent = yamlContent.substring(1);
    }

    // Remove optional whitespace after @
    yamlContent = yamlContent.trim();

    // Remove the { and } wrapper
    if (yamlContent.startsWith('{') && yamlContent.endsWith('}')) {
      yamlContent = yamlContent.substring(1, yamlContent.length - 1);
    }

    // Normalize YAML indentation while preserving structure
    const lines = yamlContent.split('\n');

    // Find the minimum indentation (excluding empty lines)
    let minIndent = Infinity;
    for (const line of lines) {
      if (line.trim().length > 0) {
        const indent = line.length - line.trimStart().length;
        minIndent = Math.min(minIndent, indent);
      }
    }

    // Remove the common indentation from all lines
    if (minIndent !== Infinity && minIndent > 0) {
      const normalizedLines = lines.map((line: string) => {
        if (line.trim().length === 0) {
          return '';
        }
        return line.substring(minIndent);
      });
      return normalizedLines.join('\n').trim();
    }

    return yamlContent.trim();
  }

  // Style processing methods
  protected processStyleStatementCore(ctx: FlowParserContext): void {
    // Extract style information - for style statements, the idString is a vertex ID, not a class name
    const styleData = this.extractStyleData(ctx);
    if (styleData) {
      // Create vertex with styles - matches Jison behavior: yy.addVertex($idString,undefined,undefined,$stylesOpt);
      // Parameters: id, text, type, styles, classes, dir, props, shapeDataYaml
      this.db.addVertex(
        styleData.className,
        undefined,
        undefined,
        styleData.styles,
        [],
        '',
        {},
        ''
      );
    }
  }

  protected processLinkStyleStatementCore(ctx: FlowParserContext): void {
    try {
      // Extract components from the linkStyle statement
      // Grammar patterns:
      // LINKSTYLE WS DEFAULT WS stylesOpt
      // LINKSTYLE WS numList WS stylesOpt
      // LINKSTYLE WS DEFAULT WS INTERPOLATE WS alphaNum WS stylesOpt
      // LINKSTYLE WS numList WS INTERPOLATE WS alphaNum WS stylesOpt
      // LINKSTYLE WS DEFAULT WS INTERPOLATE WS alphaNum
      // LINKSTYLE WS numList WS INTERPOLATE WS alphaNum

      let positions: ('default' | number)[] = [];
      let interpolateValue: string | null = null;
      let styles: string[] = [];

      // Check for DEFAULT token
      const defaultToken = ctx.DEFAULT?.();
      if (defaultToken) {
        positions = ['default'];
      }

      // Check for numList (comma-separated numbers)
      const numListCtx = ctx.numList?.();
      if (numListCtx) {
        positions = this.extractNumList(numListCtx);
      }

      // Check for INTERPOLATE and alphaNum
      const interpolateToken = ctx.INTERPOLATE?.();
      const alphaNumCtxArray = getContextArray(ctx.alphaNum?.());
      if (interpolateToken && alphaNumCtxArray.length > 0) {
        // alphaNum may return an array, get text from first element
        interpolateValue = alphaNumCtxArray[0].getText();
      }

      // Check for stylesOpt
      const stylesOptCtx = ctx.stylesOpt?.() as FlowParserContext | null;
      if (stylesOptCtx) {
        styles = this.extractStylesOpt(stylesOptCtx);
      }

      // Apply interpolation if specified - filter out 'default' for numeric-only methods
      const numericPositions = positions.filter((p): p is number => typeof p === 'number');
      if (interpolateValue) {
        this.db.updateLinkInterpolate(numericPositions, interpolateValue);
      }

      // Apply styles if specified
      if (styles.length > 0) {
        this.db.updateLink(numericPositions, styles);
      }
    } catch (error) {
      log.error('FlowchartParser: Error processing linkStyle statement:', error);
    }
  }

  // Helper method to extract number list from numList context
  private extractNumList(numListCtx: FlowParserContext): number[] {
    const numbers: number[] = [];

    try {
      // numList can be: NUM | numList COMMA NUM
      // We need to traverse the context to extract all numbers
      const children = numListCtx.children ?? [];

      for (const child of children) {
        const childWithSymbol = child as unknown as { symbol?: { type: number } };
        if (childWithSymbol.symbol?.type) {
          // Check if this is a NUM token
          const tokenType = childWithSymbol.symbol.type;
          if (tokenType === this.getNumTokenType()) {
            const numValue = Number.parseInt(child.getText(), 10);
            if (!Number.isNaN(numValue)) {
              numbers.push(numValue);
            }
          }
        }
      }

      // Fallback: try to extract numbers from text
      if (numbers.length === 0) {
        const text = numListCtx.getText();
        const matches = /\d+/g.exec(text);
        if (matches) {
          for (const match of matches) {
            const num = Number.parseInt(match, 10);
            if (!Number.isNaN(num)) {
              numbers.push(num);
            }
          }
        }
      }
    } catch (error) {
      log.error('FlowchartParser: Error extracting numList:', error);
    }

    return numbers;
  }

  // Helper method to extract styles from stylesOpt context
  private extractStylesOpt(stylesOptCtx: FlowParserContext): string[] {
    const styles: string[] = [];

    try {
      // stylesOpt can be: style | stylesOpt COMMA style
      // We need to traverse and extract all style components
      const text = stylesOptCtx.getText();

      // Split by comma and clean up each style
      const styleStrings = text
        .split(',')
        .map((s: string) => s.trim())
        .filter((s: string) => s.length > 0);
      styles.push(...styleStrings);
    } catch (error) {
      log.error('FlowchartParser: Error extracting stylesOpt:', error);
    }

    return styles;
  }

  // Helper method to get NUM token type (implementation depends on lexer)
  private getNumTokenType(): number {
    // This would need to be implemented based on the actual lexer token types
    // For now, return a placeholder
    return -1; // Placeholder
  }

  // Core class definition statement processing - shared by both Listener and Visitor
  protected processClassDefStatementCore(ctx: FlowParserContext): void {
    const classDefData = this.extractClassDefData(ctx);
    if (!classDefData) {
      return;
    }

    const { className, styles } = classDefData;
    this.db.addClass(className, styles);
  }

  protected processClassStatementCore(ctx: FlowParserContext): void {
    const classData = this.extractClassData(ctx);
    if (classData) {
      for (const nodeId of classData.nodeIds) {
        this.db.setClass(nodeId, classData.className);
      }
    }
  }

  protected processClickStatementCore(ctx: FlowParserContext): void {
    const clickData = this.extractClickData(ctx);
    if (!clickData) {
      return;
    }

    const { nodeId, functionName, link, target } = clickData;

    if (functionName) {
      // Handle callback function - match Jison parser behavior
      const functionArgs = functionName.includes('(')
        ? functionName.substring(functionName.indexOf('(') + 1, functionName.lastIndexOf(')'))
        : '';
      const cleanFunctionName = functionName.includes('(')
        ? functionName.substring(0, functionName.indexOf('('))
        : functionName;

      if (functionArgs) {
        this.db.setClickEvent(nodeId, cleanFunctionName, functionArgs);
      } else {
        this.db.setClickEvent(nodeId, cleanFunctionName);
      }
    } else if (link) {
      // Handle href link - match Jison parser behavior
      if (target && target !== '_self') {
        this.db.setLink(nodeId, link, target);
      } else {
        this.db.setLink(nodeId, link);
      }
    }

    // Handle tooltip separately
    this.extractAndSetTooltip(ctx, nodeId);
  }

  protected extractAndSetTooltip(ctx: FlowParserContext, nodeId: string): void {
    const stringLiterals = ctx.stringLiteral?.();
    const callToken = ctx.CALL?.();
    const callbackArgsToken = ctx.CALLBACKARGS?.();
    const hrefToken = ctx.HREF?.();

    if (!stringLiterals || stringLiterals.length === 0) {
      return;
    }

    let tooltip: string | undefined;

    // Determine tooltip based on the click statement pattern
    if (callToken && callbackArgsToken) {
      // Pattern: "click A call callback() 'tooltip'" - tooltip is first string literal
      if (stringLiterals.length > 0) {
        const tooltipText = stringLiterals[0].getText();
        tooltip = tooltipText.replace(/^["'](.*?)["']$/, '$1');
      }
    } else if (ctx.CALLBACKNAME?.()) {
      // Pattern: "click A callback 'tooltip'" - tooltip is first string literal
      if (stringLiterals.length > 0) {
        const tooltipText = stringLiterals[0].getText();
        tooltip = tooltipText.replace(/^["'](.*?)["']$/, '$1');
      }
    } else if (hrefToken) {
      // Pattern: "click A href 'link' 'tooltip'" - tooltip is second string literal
      if (stringLiterals.length > 1) {
        const tooltipText = stringLiterals[1].getText();
        if (tooltipText.startsWith('"') || tooltipText.startsWith("'")) {
          tooltip = tooltipText.replace(/^["'](.*?)["']$/, '$1');
        }
      }
    } else if (stringLiterals.length > 1) {
      // Pattern: "click A 'link' 'tooltip'" - tooltip is second string literal
      const tooltipText = stringLiterals[1].getText();
      if (tooltipText.startsWith('"') || tooltipText.startsWith("'")) {
        tooltip = tooltipText.replace(/^["'](.*?)["']$/, '$1');
      }
    }

    if (tooltip) {
      this.db.setTooltip(nodeId, tooltip);
    }
  }

  // Direction statement processing
  protected processDirectionStatementCore(ctx: FlowParserContext): void {
    const directionText = ctx.getText();
    const directionMatch = /direction\s+(TB|TD|BT|LR|RL)/.exec(directionText);
    if (directionMatch) {
      const direction = directionMatch[1];

      // Check if we're inside a subgraph
      if (this.currentSubgraphNodes.length > 0) {
        const currentNodes = this.currentSubgraphNodes.at(-1);
        if (currentNodes) {
          currentNodes.push({
            stmt: 'dir',
            value: direction,
          });
        }
      } else {
        this.processDirectionStatement(direction);
      }
    }
  }

  // Accessibility statement processing
  protected processAccTitleStatementCore(ctx: FlowParserContext): void {
    const titleText = ctx.getText();
    const titleMatch = /accTitle:\s*(.+)/.exec(titleText);
    if (titleMatch) {
      this.processAccTitleStatement(titleMatch[1].trim());
    }
  }

  protected processAccDescStatementCore(ctx: FlowParserContext): void {
    const descText = ctx.getText();

    // Handle single-line format: accDescr: description
    const singleLineMatch = /accDescr:\s*(.+)/.exec(descText);
    if (singleLineMatch) {
      this.processAccDescStatement(singleLineMatch[1].trim());
      return;
    }

    // Handle multi-line block format: accDescr { description with multiple lines }
    const blockMatch = /accDescr\s*{\s*([\S\s]*?)\s*}/.exec(descText);
    if (blockMatch) {
      // Clean up the multi-line content: trim whitespace and normalize line breaks
      const content = blockMatch[1]
        .split('\n')
        .map((line: string) => line.trim())
        .filter((line: string) => line.length > 0)
        .join('\n');
      this.processAccDescStatement(content);
      return;
    }
  }

  // Subgraph statement processing
  protected processSubgraphStatementCore(ctx: FlowParserContext): void {
    // Initialize the stack BEFORE extracting the title so title processing can update it
    this.subgraphTitleTypeStack.push('text');

    const extractedId = this.extractSubgraphId(ctx);
    const title = this.extractSubgraphLabel(ctx);

    // Handle auto-ID generation for title-only subgraphs
    const id = extractedId ?? `subGraph${this.subgraphStack.length}`;

    this.processSubgraphStatement(id, title ?? undefined);
  }

  protected processSubgraphEndCore(): void {
    this.processSubgraphEnd();
  }

  // Helper methods for extracting data from contexts
  protected extractSubgraphId(ctx: FlowParserContext): string | null {
    // Extract subgraph ID from context based on grammar patterns:
    // SUBGRAPH WS textNoTags SQS text SQE - textNoTags is ID, text is title
    // SUBGRAPH WS textNoTags SQUARE_COMPLETE - textNoTags is ID, SQUARE_COMPLETE contains title
    // SUBGRAPH WS textNoTags - textNoTags is both ID and title
    // SUBGRAPH - no ID or title

    const children = ctx.children ?? [];

    // Check if we have the pattern with square brackets (ID + title)
    let hasSQS = false;
    let hasSquareComplete = false;
    for (const child of children) {
      if (child.constructor.name === 'TerminalNode') {
        const text = child.getText();
        if (text === '[') {
          hasSQS = true;
          break;
        }
        // Check for SQUARE_COMPLETE token (e.g., [Title])
        if (text.startsWith('[') && text.endsWith(']') && text.length > 2) {
          hasSquareComplete = true;
          break;
        }
      }
    }

    if (hasSQS || hasSquareComplete) {
      // Pattern: SUBGRAPH WS textNoTags SQS text SQE or SUBGRAPH WS textNoTags SQUARE_COMPLETE
      // textNoTags is the ID
      for (const child of children) {
        if (child.constructor.name === 'TextNoTagsContext') {
          return child.getText().trim();
        }
      }
    } else {
      // Pattern: SUBGRAPH WS textNoTags - textNoTags could be ID or title
      for (const child of children) {
        if (child.constructor.name === 'TextNoTagsContext') {
          const text = child.getText().trim();
          // If the text is quoted, treat it as a title-only subgraph (return null for auto-ID generation)
          if (
            (text.startsWith('"') && text.endsWith('"')) ||
            (text.startsWith("'") && text.endsWith("'"))
          ) {
            return null; // This will trigger auto-ID generation in the database
          }
          // Otherwise, treat it as both ID and title
          return text;
        }
      }
    }

    // Pattern: SUBGRAPH - generate a unique ID
    return `subgraph_${Date.now()}`;
  }

  protected extractSubgraphLabel(ctx: FlowParserContext): string | null {
    // Extract subgraph label from context based on grammar patterns:
    // SUBGRAPH WS textNoTags SQS text SQE - title is in 'text' between SQS and SQE
    // SUBGRAPH WS textNoTags SQUARE_COMPLETE - title is in SQUARE_COMPLETE token
    // SUBGRAPH WS textNoTags - textNoTags is the title
    // SUBGRAPH - no title

    const children = ctx.children ?? [];

    // Check if we have the pattern with square brackets (ID + title)
    let hasSQS = false;
    let squareCompleteText: string | null = null;
    for (const child of children) {
      if (child.constructor.name === 'TerminalNode') {
        const text = child.getText();
        if (text === '[') {
          hasSQS = true;
          break;
        }
        // Check for SQUARE_COMPLETE token (e.g., [Title])
        if (text.startsWith('[') && text.endsWith(']') && text.length > 2) {
          squareCompleteText = text;
          break;
        }
      }
    }

    // Handle SQUARE_COMPLETE token: extract title from [Title] format
    if (squareCompleteText) {
      let title = squareCompleteText.slice(1, -1); // Remove [ and ]
      // Remove surrounding quotes if present
      if (
        (title.startsWith('"') && title.endsWith('"')) ||
        (title.startsWith("'") && title.endsWith("'"))
      ) {
        title = title.slice(1, -1);
      }
      return title;
    }

    if (hasSQS) {
      // Pattern: SUBGRAPH WS textNoTags SQS text SQE
      // Title is in the 'text' part between SQS and SQE
      let foundSQS = false;

      for (const child of children) {
        if (child.constructor.name === 'TerminalNode' && child.getText() === '[') {
          foundSQS = true;
          continue;
        }

        if (foundSQS && child.constructor.name === 'TextContext') {
          // Use the same text processing logic as nodes and edges for consistency
          const textWithType = this.extractTextWithType(child as FlowParserContext);
          // Update the current subgraph's title type in the stack
          const lastIndex = this.subgraphTitleTypeStack.length - 1;
          if (lastIndex >= 0) {
            this.subgraphTitleTypeStack[lastIndex] = textWithType.type;
          }
          return textWithType.text;
        }
      }
    } else {
      // Pattern: SUBGRAPH WS textNoTags - textNoTags is the title
      for (const child of children) {
        if (child.constructor.name === 'TextNoTagsContext') {
          let text = child.getText().trim();
          // For TextNoTagsContext, we need to manually check for markdown patterns
          // since it doesn't go through the same parse tree structure as TextContext
          let type = 'text';

          // Check for quoted strings with backticks: "`content`"
          if (/^"[^"]*`[^`]*`[^"]*"$/.exec(text)) {
            type = 'markdown';
            // Extract content between quotes and strip backticks
            const match = /^"([^"]*)"$/.exec(text);
            if (match) {
              let content = match[1];
              if (content.startsWith('`') && content.endsWith('`')) {
                content = content.slice(1, -1); // Remove backticks
              }
              text = content;
            }
          }
          // Check for regular quoted strings: "content"
          else if (/^"[^"]*"$/.exec(text)) {
            type = 'text'; // Regular quoted strings should be 'text', not 'string'
            const match = /^"([^"]*)"$/.exec(text);
            if (match) {
              text = match[1];
            }
          }
          // Check for backtick strings: `content`
          else if (text.startsWith('`') && text.endsWith('`')) {
            type = 'markdown';
            text = text.slice(1, -1); // Remove backticks
          }

          // Update the current subgraph's title type in the stack
          const lastIndex = this.subgraphTitleTypeStack.length - 1;
          if (lastIndex >= 0) {
            this.subgraphTitleTypeStack[lastIndex] = type;
          }
          return text;
        }
      }
    }

    return null;
  }

  protected extractStyleData(
    ctx: FlowParserContext
  ): { className: string; styles: string[] } | null {
    // Extract style class name and styles
    const classNameCtx = getFirstContext(ctx.idString?.());
    const stylesCtx = ctx.stylesOpt?.();

    if (!classNameCtx) {
      return null;
    }

    const className = classNameCtx.getText();
    const styles = stylesCtx ? this.extractStylesOpt(stylesCtx) : [];

    return { className, styles };
  }

  protected extractClassDefData(
    ctx: FlowParserContext
  ): { className: string; styles: string[] } | null {
    // For classDefStatement: CLASSDEF WS idString WS stylesOpt
    // We need to access the children to get the idString and stylesOpt elements
    const children = ctx.children;
    if (!children || children.length < 5) {
      return null;
    }

    // children[2] = idString (class name), children[4] = stylesOpt (styles)
    const classNameCtx = children[2];
    const stylesOptCtx = children[4];

    if (!classNameCtx || !stylesOptCtx) {
      return null;
    }

    const className = classNameCtx.getText();
    const stylesText = stylesOptCtx.getText();

    // Parse styles - split by comma and trim
    const styles = stylesText
      .split(',')
      .map((style: string) => style.trim())
      .filter((style: string) => style.length > 0);

    return { className, styles };
  }

  protected extractClassData(
    ctx: FlowParserContext
  ): { nodeIds: string[]; className: string } | null {
    // For classStatement: CLASS WS idString WS idString
    // We need to access the children to get the two different idString elements
    const children = ctx.children;
    if (!children || children.length < 5) {
      return null;
    }

    // children[2] = first idString (node IDs), children[4] = second idString (class name)
    const nodeIdsCtx = children[2];
    const classNameCtx = children[4];

    if (!nodeIdsCtx || !classNameCtx) {
      return null;
    }

    // Get the text and split by comma to handle multiple node IDs
    const nodeIdsText = nodeIdsCtx.getText();
    const nodeIds = nodeIdsText
      .split(',')
      .map((id: string) => id.trim())
      .filter((id: string) => id.length > 0);
    const className = classNameCtx.getText();

    return { nodeIds, className };
  }

  protected extractClickData(
    ctx: FlowParserContext
  ): { nodeId: string; functionName?: string; link?: string; target?: string } | null {
    // The CLICK token contains both 'click' and the node ID
    const clickToken = ctx.CLICK?.();
    if (!clickToken) {
      return null;
    }

    // Extract node ID from CLICK token (format: "click NodeId")
    const clickText = clickToken.getText();
    const clickMatch = /^click\s+(\w+)$/.exec(clickText);
    if (!clickMatch) {
      return null;
    }

    const nodeId = clickMatch[1];

    // Check for callback function
    const callToken = ctx.CALL?.();
    const callbackNameToken = ctx.CALLBACKNAME?.();
    const callbackArgsToken = ctx.CALLBACKARGS?.();
    const hrefToken = ctx.HREF?.();
    const stringLiterals = ctx.stringLiteral?.();

    let functionName: string | undefined;
    let link: string | undefined;
    let target = '_self';

    if (callbackNameToken) {
      functionName = callbackNameToken.getText();

      // If there are callback args, append them
      if (callbackArgsToken) {
        const argsText = callbackArgsToken.getText();
        functionName += argsText;
      }
    } else if (callToken && callbackArgsToken) {
      // Handle "call callback(args)" pattern where CALLBACKARGS contains the full function call
      const argsText = callbackArgsToken.getText();
      functionName = argsText;
    }

    if (hrefToken) {
      // For href, the link is in the string literal
      if (stringLiterals && stringLiterals.length > 0) {
        const linkText = stringLiterals[0].getText();
        link = linkText.replace(/^"(.*)"$/, '$1');
      }

      // Check for LINK_TARGET token (like _blank, _self, etc.)
      const linkTargetToken = ctx.LINK_TARGET?.();
      if (linkTargetToken) {
        target = linkTargetToken.getText();
      }
    } else if (
      !hrefToken &&
      !callToken &&
      !callbackNameToken &&
      stringLiterals &&
      stringLiterals.length > 0
    ) {
      // Handle direct string literal (like: click A "click.html")
      const linkText = stringLiterals[0].getText();
      link = linkText.replace(/^"(.*)"$/, '$1');

      // Check for LINK_TARGET token (like _blank, _self, etc.)
      const linkTargetToken = ctx.LINK_TARGET?.();
      if (linkTargetToken) {
        target = linkTargetToken.getText();
      }
    }

    return {
      nodeId,
      functionName,
      link,
      target,
    };
  }
}
