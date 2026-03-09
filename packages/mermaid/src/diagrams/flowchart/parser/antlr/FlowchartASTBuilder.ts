import { FlowParserVisitor } from './generated/FlowParserVisitor.js';
import type {
  StartContext,
  GraphConfigContext,
  DocumentContext,
  LineContext,
  StatementContext,
  VertexStatementContext,
  StandaloneVertexContext,
  StyleStatementContext,
  LinkStyleStatementContext,
  ClassDefStatementContext,
  ClassStatementContext,
  ClickStatementContext,
  SubgraphStatementContext,
  DirectionContext,
  AccTitleContext,
  AccDescrContext,
  CommentStatementContext,
  LinkContext,
} from './generated/FlowParser.js';
import { ParserRuleContext } from 'antlr4ng';
import type { ParseTree } from 'antlr4ng';

import type {
  FlowchartAST,
  FlowchartStatement,
  FlowchartElementMapping,
  ElementPosition,
  VertexData,
  EdgeData,
  FlowchartEdgeOccurrence,
  DefinedElements,
  SubgraphData,
  StyleData,
  LinkStyleData,
  ClassDefData,
  ClassAssignmentData,
  ClickData,
  DirectionData,
  AccTitleData,
  AccDescrData,
  FlowVertexTypeParam,
} from '../../types.js';

import { extractShapeFromVertexContext, extractTextFromCompleteToken } from './shape-utils.js';

/**
 * AST-to-Code Generator for Flowchart Diagrams
 *
 * This visitor traverses the ANTLR parse tree and reconstructs the original
 * flowchart diagram code with proper line numbers and formatting.
 *
 * Main objective: Enable UI editing of rendered diagrams with AST updates
 * that can be regenerated back to code.
 *
 * Builds a structured AST for the hybrid editor approach.
 */

/**
 * ANTLR4ng generates visitor methods as optional properties in the base class,
 * but we implement them as methods. TypeScript sees this as incompatible because
 * properties can be reassigned while methods cannot. The runtime behavior is correct
 * because methods are compatible with function properties.
 *
 * We cast to any to bypass TypeScript's strict checking for this ANTLR pattern.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class FlowchartASTBuilder extends (FlowParserVisitor as any)<string> {
  private lines: string[] = [];
  private currentIndent = 0;
  private indentSize = 2;

  // For preserving exact original segments
  private currentSourceLineNumber: number | null = null;
  private lastPhysicalLineEmitted = 0;
  private emittedLines = new Set<number>();

  // AST building properties
  private ast: FlowchartAST;
  private currentIndex = 0; // Sequential counter for originalIndex
  private dbIndex = 0; // DB index for SVG matching

  // Suppress code emission when building nested AST (e.g., visiting children inside blocks)
  private suppressEmission = false;

  // Stack for collecting nested statements within subgraphs
  private blockStack: { type: FlowchartStatement['type']; statements: FlowchartStatement[] }[] = [];

  // Position tracking for bidirectional synchronization
  private originalText = '';
  private elementMappings: FlowchartElementMapping[] = [];
  private svgIdCounter = 0;
  private elementMappingCounter = 0;
  private edgeIdCounter = 0; // Separate counter for edge IDs to ensure consecutive numbering
  private currentLine = 1;
  private currentColumn = 1;
  private currentCharIndex = 0;

  // Edge counter map for generating SVG IDs in format L_start_end_counter
  // Key is "start_end", value is the count of edges between those nodes
  private edgeCounterMap = new Map<string, number>();

  /**
   * Create a minimal valid flowchart AST
   */
  static createEmpty(): FlowchartAST {
    return {
      header: 'flowchart',
      statements: [],
      elementMappings: [],
      // Addendum: capability flags for additive AST extensions
      extensions: {
        edgeOccurrences: true,
        edgeOccurrenceMappings: true,
        statementIds: true,
        statementPositions: true,
        inlineNodeDefs: true,
        dataRef: true,
        primaryEdgeData: true,
        exactPositions: true,
        compoundMetadata: true,
      },
      metadata: {
        // Backwards-compat: consumers may use `Object.keys(metadata.nodes)` (instructions.md A1)
        nodes: Object.create(null),
        edges: [],
        subgraphs: new Map(),
        classes: new Map(),
      },
    };
  }

  constructor(originalText?: string) {
    super();

    // Initialize with empty lines array
    this.lines = [];
    // Initialize AST
    this.ast = FlowchartASTBuilder.createEmpty();
    this.currentIndex = 0;

    // Store original text for position tracking
    this.originalText = originalText ?? '';
    this.elementMappings = [];
    this.svgIdCounter = 0;
  }

  /**
   * Visit all children of a node and aggregate their results
   * Required by ParseTreeVisitor interface
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  visitChildren(node: any): string {
    let result = '';
    const n = node.getChildCount?.() ?? 0;
    for (let i = 0; i < n; i++) {
      const child = node.getChild?.(i);
      if (child) {
        const childResult = child.accept?.(this);
        if (childResult) {
          result += childResult;
        }
      }
    }
    return result;
  }

  /**
   * Reset position tracking counters
   */
  private resetPositionTracking(): void {
    this.currentLine = 1;
    this.currentColumn = 1;
    this.currentCharIndex = 0;
  }

  /**
   * Generate code from the parse tree with position tracking
   */
  generateAST(tree: ParseTree): { code: string; lines: string[]; ast: FlowchartAST } {
    this.lines = [];
    this.currentIndent = 0;
    this.ast = FlowchartASTBuilder.createEmpty();
    this.currentIndex = 0;
    this.elementMappings = [];
    this.svgIdCounter = 0;
    this.elementMappingCounter = 0;
    this.edgeIdCounter = 0;
    this.resetPositionTracking();

    // Visit the tree to generate code and build AST
    this.visit(tree);

    // Join lines and return both full code, line array, and AST
    const code = this.lines.join('\n');

    // Add element mappings to AST
    this.ast.elementMappings = [...this.elementMappings];

    // Rebuild metadata.nodes canonically (instructions.md A1)
    this.rebuildMetadataNodes();

    // Attach bidirectional synchronization methods to AST
    this.attachSyncMethodsToAST();

    return {
      code,
      lines: [...this.lines], // Return copy of lines array
      ast: this.ast, // Return the built AST with mappings
    };
  }

  /**
   * Backwards-compat (A1): ensure `ast.metadata.nodes` is a populated plain object.
   * Canonical merge in source order:
   *  1) merge inline node defs captured on statements (includes standalone vertex statements)
   *  2) ensure all node ids referenced by edges/occurrences exist (`{ id, text: id }` fallback)
   *
   * Precedence: last definition wins in source order (we merge fields; later defined fields override).
   */
  private rebuildMetadataNodes(): void {
    if (!this.ast.metadata) {
      return;
    }

    const nodes: Record<string, VertexData> = Object.create(null);

    const upsert = (incoming: VertexData | undefined): void => {
      if (!incoming?.id) {
        return;
      }
      const id = incoming.id;
      const current: VertexData | undefined = nodes[id];

      const next: VertexData = {
        id,
        text: current?.text ?? id,
      };
      if (current?.type) {
        next.type = current.type;
      }

      // Only override fields that are actually provided by the incoming definition
      if (incoming.text !== undefined) {
        next.text = incoming.text;
      }
      if (incoming.type !== undefined) {
        next.type = incoming.type;
      }

      // Always keep the minimum contract
      next.text ??= id;

      nodes[id] = next;
    };

    const ensure = (id: string | undefined): void => {
      if (!id) {
        return;
      }
      if (!nodes[id]) {
        nodes[id] = { id, text: id };
        return;
      }
      nodes[id].text ??= id;
    };

    // Source order: use statement.originalIndex (fall back to array order)
    const statements = [...(this.ast.statements ?? [])].sort(
      (a: FlowchartStatement, b: FlowchartStatement) => {
        const ai = typeof a?.originalIndex === 'number' ? a.originalIndex : 0;
        const bi = typeof b?.originalIndex === 'number' ? b.originalIndex : 0;
        return ai - bi;
      }
    );

    // 1) Merge statement inline node defs (includes standalone vertex statements)
    for (const stmt of statements) {
      const defs: Record<string, VertexData> | undefined = stmt?.definedElements?.inlineNodeDefs;
      if (!defs) {
        continue;
      }
      for (const key of Object.keys(defs)) {
        upsert(defs[key]);
      }
    }

    // 2) Ensure all referenced node ids exist
    const referenced = new Set<string>();

    // metadata.edges
    for (const e of this.ast.metadata.edges ?? []) {
      if (e?.start) {
        referenced.add(e.start);
      }
      if (e?.end) {
        referenced.add(e.end);
      }
    }

    for (const stmt of statements) {
      const nodeIds: string[] | undefined = stmt?.definedElements?.nodeIds;
      if (Array.isArray(nodeIds)) {
        for (const id of nodeIds) {
          referenced.add(id);
        }
      }

      const edgeOccurrences: FlowchartEdgeOccurrence[] | undefined = stmt?.edgeOccurrences;
      if (Array.isArray(edgeOccurrences)) {
        for (const o of edgeOccurrences) {
          referenced.add(o.start);
          referenced.add(o.end);
        }
      }

      const vertexId: string | undefined =
        stmt?.type === 'vertex' ? (stmt?.data as VertexData)?.id : undefined;
      if (vertexId) {
        referenced.add(vertexId);
      }
    }

    for (const id of referenced) {
      ensure(id);
    }

    this.ast.metadata.nodes = nodes;
  }

  /**
   * Attach bidirectional synchronization methods to the AST
   */
  private attachSyncMethodsToAST(): void {
    const mappings = this.elementMappings;

    // Sort mappings by position for efficient lookups
    const sortedByPosition = [...mappings].sort((a, b) => {
      if (a.position.startLine !== b.position.startLine) {
        return a.position.startLine - b.position.startLine;
      }
      return a.position.startColumn - b.position.startColumn;
    });

    // Create lookup maps
    const idMap = new Map(mappings.map((m) => [m.id, m]));

    // Attach methods to AST
    this.ast.getElementAtPosition = (line: number, column: number) => {
      // Find all elements that contain this position
      const matches = sortedByPosition.filter(
        (m) =>
          (line > m.position.startLine ||
            (line === m.position.startLine && column >= m.position.startColumn)) &&
          (line < m.position.endLine ||
            (line === m.position.endLine && column <= m.position.endColumn))
      );

      if (matches.length === 0) {
        return undefined;
      }

      if (matches.length === 1) {
        return matches[0];
      }

      // Return the element with the smallest range (most specific)
      return matches.reduce((smallest, current) => {
        const smallestSize =
          (smallest.position.endLine - smallest.position.startLine) * 1000 +
          (smallest.position.endColumn - smallest.position.startColumn);
        const currentSize =
          (current.position.endLine - current.position.startLine) * 1000 +
          (current.position.endColumn - current.position.startColumn);
        return currentSize < smallestSize ? current : smallest;
      });
    };

    // Get all elements on a given line (for highlighting all nodes/edges on a line)
    this.ast.getElementsOnLine = (line: number) => {
      return sortedByPosition.filter(
        (m) => m.position.startLine <= line && line <= m.position.endLine
      );
    };

    this.ast.getElementById = (id: string) => {
      return idMap.get(id);
    };

    this.ast.getElementAtIndex = (charIndex: number) => {
      return mappings.find(
        (m) => m.position.startIndex <= charIndex && charIndex <= m.position.endIndex
      );
    };

    this.ast.getVertices = () => {
      return mappings.filter((m) => m.type === 'vertex');
    };

    this.ast.getEdges = () => {
      return mappings.filter((m) => m.type === 'edge');
    };

    this.ast.getSubgraphs = () => {
      return mappings.filter((m) => m.type === 'subgraph');
    };

    this.ast.getStats = () => {
      const vertices = this.ast.getVertices?.() ?? [];
      const edges = this.ast.getEdges?.() ?? [];
      const subgraphs = this.ast.getSubgraphs?.() ?? [];
      return {
        vertices: vertices.length,
        edges: edges.length,
        subgraphs: subgraphs.length,
        totalElements: this.elementMappings.length,
      };
    };

    // getElementByDataId: Maps SVG data-id attribute to element mappings
    // For nodes: data-id is the node ID (e.g., "A", "B")
    // For edges: data-id is the svgId (e.g., "L_A_B_0" for auto-generated, or user-defined ID)
    // For subgraphs: data-id is the subgraph ID (e.g., "one", "two")
    this.ast.getElementByDataId = (dataId: string) => {
      // First, try to find a vertex with matching ID
      for (const mapping of mappings) {
        if (mapping.type === 'vertex' && 'id' in mapping.data && mapping.data.id === dataId) {
          return mapping;
        }
      }

      // Then, try to find an edge with matching svgId
      // The SVG data-id attribute is set to the svgId (L_start_end_counter or user-defined)
      for (const mapping of mappings) {
        if (mapping.type === 'edge' && 'svgId' in mapping.data && mapping.data.svgId === dataId) {
          return mapping;
        }
      }

      // Try to find a subgraph with matching ID
      for (const mapping of mappings) {
        if (mapping.type === 'subgraph' && 'id' in mapping.data && mapping.data.id === dataId) {
          return mapping;
        }
      }

      return undefined;
    };
  }

  /**
   * Helper method to add a line to the output
   */
  private addLine(text: string): void {
    const indent = ' '.repeat(this.currentIndent * this.indentSize);
    this.lines.push(indent + text);
  }

  /**
   * Helper method to create position information from context
   */
  private createPosition(ctx: ParserRuleContext): ElementPosition {
    const startToken = ctx.start;
    const stopToken = ctx.stop ?? ctx.start;

    // Handle null tokens with default values
    if (!startToken || !stopToken) {
      return {
        startLine: 1,
        startColumn: 0,
        endLine: 1,
        endColumn: 0,
        startIndex: 0,
        endIndex: 0,
      };
    }

    return {
      startLine: startToken.line,
      startColumn: startToken.column,
      endLine: stopToken.line,
      endColumn: stopToken.column + (stopToken.text?.length ?? 0),
      startIndex: startToken.start,
      endIndex: stopToken.stop,
    };
  }

  /**
   * Helper method to create position information from explicit tokens.
   * Used to compute granular spans for edge occurrences.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private createPositionFromTokens(startToken: any, stopToken: any): ElementPosition {
    const start = startToken;
    const stop = stopToken ?? startToken;

    if (!start || !stop) {
      return {
        startLine: 1,
        startColumn: 0,
        endLine: 1,
        endColumn: 0,
        startIndex: 0,
        endIndex: 0,
      };
    }

    return {
      startLine: start.line,
      startColumn: start.column,
      endLine: stop.line,
      endColumn: stop.column + (stop.text?.length ?? 0),
      startIndex: start.start,
      endIndex: stop.stop,
    };
  }

  /**
   * Attach statement position + deterministic statementId (additive-only fields).
   */
  private attachStatementMeta(statement: FlowchartStatement, ctx: ParserRuleContext): void {
    const position = this.createPosition(ctx);
    statement.position ??= position;
    statement.statementId ??= `stmt:${position.startIndex}:${position.endIndex}`;
  }

  /**
   * Get position information from a context (with null safety)
   */
  private getPositionFromContext(ctx: ParserRuleContext | ParseTree): ElementPosition | null {
    // Type guard for ParserRuleContext
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const isParserRuleContext = (obj: any): obj is ParserRuleContext => {
      return obj && 'start' in obj && 'stop' in obj;
    };

    if (!isParserRuleContext(ctx)) {
      return null;
    }

    const start = ctx.start;
    const stop = ctx.stop ?? start;

    if (!start) {
      return null;
    }

    return {
      startLine: start.line,
      startColumn: start.column,
      endLine: stop?.line ?? start.line,
      endColumn: (stop?.column ?? start.column) + (stop?.text?.length ?? start.text?.length ?? 0),
      startIndex: start.start,
      endIndex: stop?.stop ?? start.stop,
    };
  }

  /**
   * Get text content from a context
   * Preserves original whitespace by extracting from source
   */
  private getContextText(ctx: ParserRuleContext | ParseTree | undefined): string {
    if (!ctx) {
      return '';
    }

    // Try to get original source text with whitespace preserved
    if (ctx instanceof ParserRuleContext) {
      const start = ctx.start;
      const stop = ctx.stop;
      if (start && stop && this.originalText) {
        const startIndex = start.start;
        const stopIndex = stop.stop;
        if (
          startIndex !== undefined &&
          stopIndex !== undefined &&
          startIndex >= 0 &&
          stopIndex >= 0 &&
          stopIndex < this.originalText.length
        ) {
          return this.originalText.substring(startIndex, stopIndex + 1);
        }
      }
    }

    // Fallback to ANTLR's built-in getText() method (no whitespace)
    if ('getText' in ctx && typeof ctx.getText === 'function') {
      return ctx.getText();
    }

    return '';
  }

  /**
   * Get original source line from context
   */
  private getOriginalSourceFromCtx(ctx: ParserRuleContext): string {
    return this.getContextText(ctx);
  }

  /**
   * Push a statement to the AST or current block (for nested subgraphs)
   */
  private pushStatement(statement: FlowchartStatement): void {
    if (this.blockStack.length > 0) {
      // We're inside a subgraph block - add to current block's statements
      const currentBlock = this.blockStack[this.blockStack.length - 1];
      currentBlock.statements.push(statement);
    } else {
      // At top level - add to AST statements
      this.ast.statements.push(statement);
    }
  }

  /**
   * Create an element mapping for bidirectional synchronization
   */
  private createElementMapping(
    type: FlowchartStatement['type'],
    ctx: ParserRuleContext | ParseTree,
    data: FlowchartElementMapping['data'],
    dbIndex?: number
  ): FlowchartElementMapping | null {
    const position = this.getPositionFromContext(ctx);

    if (!position) {
      return null;
    }

    const elementId = `${type}-${this.elementMappingCounter++}`;
    const svgId = `flowchart-${type}-${this.svgIdCounter++}`;

    // For vertices and edges, use data-id based selectors
    // Note: SVG uses data-et="node" for vertices, not "vertex"
    let svgSelector = `[data-et="${type}"]`;
    if (type === 'vertex' && 'id' in data) {
      svgSelector = `[data-et="node"][data-id="${data.id}"]`;
    } else if (type === 'edge') {
      const index = dbIndex ?? this.elementMappings.filter((m) => m.type === 'edge').length;
      svgSelector = `[data-et="edge"][data-id="e${index}"]`;
    }

    const mapping: FlowchartElementMapping = {
      id: elementId,
      type,
      position,
      svgId,
      svgSelector,
      data,
    };

    this.elementMappings.push(mapping);
    return mapping;
  }

  /**
   * Visit start rule - entry point
   */
  visitStart(ctx: StartContext): string {
    // Visit graph config to get header and direction
    if (ctx.graphConfig()) {
      this.visit(ctx.graphConfig());
    }

    // Visit document to process statements
    if (ctx.document()) {
      this.visit(ctx.document());
    }

    return '';
  }

  /**
   * Visit graph config - extract header and direction
   */
  visitGraphConfig(ctx: GraphConfigContext): string {
    const text = this.getContextText(ctx);

    // Extract header (flowchart/graph)
    if (text.includes('flowchart')) {
      this.ast.header = 'flowchart';
    } else if (text.includes('graph')) {
      this.ast.header = 'graph';
    }

    // Extract direction if present
    const dirMatch = /(?:flowchart|graph)\s*([<>^v]|TB|TD|BT|LR|RL)/.exec(text);
    if (dirMatch) {
      const dir = dirMatch[1];
      // Normalize direction
      switch (dir) {
        case 'TD':
        case 'v':
          this.ast.direction = 'TB';
          break;
        case '<':
          this.ast.direction = 'RL';
          break;
        case '>':
          this.ast.direction = 'LR';
          break;
        case '^':
          this.ast.direction = 'BT';
          break;
        case 'TB':
          this.ast.direction = 'TB';
          break;
        case 'BT':
          this.ast.direction = 'BT';
          break;
        case 'LR':
          this.ast.direction = 'LR';
          break;
        case 'RL':
          this.ast.direction = 'RL';
          break;
        default:
          this.ast.direction = 'TB'; // Fallback to default
      }
    } else {
      this.ast.direction = 'TB'; // Default
    }

    // Generate header line
    const header = this.ast.header + (this.ast.direction ? ' ' + this.ast.direction : '');
    this.addLine(header);

    return '';
  }

  /**
   * Visit document - process all lines
   */
  visitDocument(ctx: DocumentContext): string {
    const lines = ctx.line();
    for (const line of lines) {
      this.visit(line);
    }

    return '';
  }

  /**
   * Visit line - process individual line
   */
  visitLine(ctx: LineContext): string {
    // Check if it's a statement
    if (ctx.statement()) {
      this.visit(ctx.statement());
    }
    // Check if it's a blank line
    // A blank line is a line that contains only NEWLINE (empty line)
    // NOT whitespace (WS) - whitespace is just indentation before statements
    // The grammar rule is: line -> NEWLINE | WS | SEMI | statement
    // - NEWLINE alone = blank line
    // - WS alone = indentation (not a blank line)
    // - SEMI alone = statement separator (not a blank line)
    else if (ctx.NEWLINE() && !ctx.WS() && !ctx.SEMI()) {
      // Only add blank line if it's truly a blank line (just NEWLINE, nothing else)
      const statement: FlowchartStatement = {
        type: 'blankLine',
        originalIndex: this.currentIndex++,
        data: {},
        sourceLine: '',
      };
      this.pushStatement(statement);
      this.addLine('');
    }
    // WS or SEMI without a statement - skip (don't add to AST)
    // These are just formatting/separators, not meaningful content

    return '';
  }

  /**
   * Visit statement - dispatch to specific statement type
   */
  visitStatement(ctx: StatementContext): string {
    const fullText = ctx.getText();

    // Visit the actual statement
    if (ctx.commentStatement()) {
      this.visit(ctx.commentStatement());
    } else if (ctx.vertexStatement()) {
      this.visit(ctx.vertexStatement());
    } else if (ctx.standaloneVertex()) {
      this.visit(ctx.standaloneVertex());
    } else if (ctx.styleStatement()) {
      this.visit(ctx.styleStatement());
    } else if (ctx.linkStyleStatement()) {
      this.visit(ctx.linkStyleStatement());
    } else if (ctx.classDefStatement()) {
      this.visit(ctx.classDefStatement());
    } else if (ctx.classStatement()) {
      this.visit(ctx.classStatement());
    } else if (ctx.clickStatement()) {
      this.visit(ctx.clickStatement());
    } else if (ctx.subgraphStatement()) {
      this.visit(ctx.subgraphStatement());
    } else if (ctx.direction()) {
      this.visit(ctx.direction());
    } else if (ctx.accTitle()) {
      this.visit(ctx.accTitle());
    } else if (ctx.accDescr()) {
      this.visit(ctx.accDescr());
    }

    // Check for blank lines after this statement
    // The statement grammar is: (commentStatement | vertexStatement | ...) separator
    // where separator is: NEWLINE | SEMI | EOF
    // If there are multiple newlines, the extras are blank lines
    //
    // IMPORTANT: Don't count newlines for subgraph statements!
    // Subgraphs naturally contain multiple newlines as part of their structure (inner content).
    // Blank lines inside subgraphs are handled when visiting the subgraph's document.
    if (!ctx.subgraphStatement()) {
      const newlineCount = (fullText.match(/\n/g) ?? []).length;

      // If there are 2+ newlines, the extras (after the first separator) are blank lines
      if (newlineCount >= 2) {
        const blankLineCount = newlineCount - 1; // -1 for the statement's separator
        for (let i = 0; i < blankLineCount; i++) {
          const statement: FlowchartStatement = {
            type: 'blankLine',
            originalIndex: this.currentIndex++,
            data: {},
            sourceLine: '',
          };
          this.pushStatement(statement);
          this.addLine('');
        }
      }
    }

    return '';
  }

  /**
   * Visit vertex statement - handles node definitions and edges
   */
  visitVertexStatement(ctx: VertexStatementContext): string {
    const text = this.getContextText(ctx);

    // Extract the source line for round-trip generation
    // Remove trailing newlines and separators - they're not part of the statement content
    const sourceLine = text.replace(/[\n\r;]+$/, '');

    // Check if this is an edge (has a link) or a standalone vertex
    // The vertexStatement grammar is recursive:
    // - vertexStatement link node = edge (recursive case)
    // - node = standalone vertex (base case)
    // So if ctx has a vertexStatement() child, it's an edge
    let hasLink = false;
    try {
      // Check if this context has a recursive vertexStatement child
      const childVertexStatement = ctx.vertexStatement ? ctx.vertexStatement() : null;
      hasLink = childVertexStatement !== null && childVertexStatement !== undefined;
    } catch {
      // If vertexStatement() throws or doesn't exist, it's not an edge
      hasLink = false;
    }

    if (hasLink) {
      // This is an edge statement (e.g., "A --> B" or "A --> B & C" or "A --> B --> C")
      // Extract all nodes for vertex references (all nodes on this line)
      const nodes = this.extractNodesFromVertexStatement(ctx);

      // Extract ALL edge pairs from the chained statement
      // For "A --> B --> C": returns [{A->[B]}, {B->[C]}]
      // For "A --> B & C": returns [{A->[B,C]}]
      const allEdgePairs = this.extractAllEdgePairs(ctx);

      const statementPosition = this.createPosition(ctx);
      const statementId = `stmt:${statementPosition.startIndex}:${statementPosition.endIndex}`;
      const statementOriginalIndex = this.currentIndex;

      const edgePosition = statementPosition;
      const createdEdges: EdgeData[] = [];
      const createdEdgeIds: string[] = [];
      const edgeOccurrences: FlowchartEdgeOccurrence[] = [];
      let occurrenceIndex = 0;

      const inlineNodeDefs: Record<string, VertexData> = {};

      // Process each edge pair in the chain
      for (const edgePair of allEdgePairs) {
        const { sourceNodes, targetNodes, userEdgeId, sourceStyledVertices, targetStyledVertices } =
          edgePair;

        // Track if user-defined edge ID has been used (only applies to first edge in this link)
        let userEdgeIdUsed = false;

        // Determine compound kind for occurrences at this level
        const isAndList = sourceNodes.length > 1 || targetNodes.length > 1;
        const isChain = allEdgePairs.length > 1;
        const compoundKind: FlowchartEdgeOccurrence['compoundKind'] =
          isChain && isAndList ? 'other' : isChain ? 'chain' : isAndList ? 'and_list' : 'single';

        // Create edges for each combination of source -> target
        for (const [sIdx, startNode] of sourceNodes.entries()) {
          for (const [tIdx, endNode] of targetNodes.entries()) {
            let svgId: string;
            let edgeId: string;

            // Track edge count for this node pair (matches flowDb.ts addSingleLink logic)
            // The DB uses: if existingLinks.length === 0 -> counter 0
            //              if existingLinks.length > 0 -> counter = existingLinks.length + 1
            const edgeKey = `${startNode}_${endNode}`;
            const existingEdgeCount = this.edgeCounterMap.get(edgeKey) ?? 0;

            if (userEdgeId && !userEdgeIdUsed) {
              // User-defined edge ID: use it as svgId (only for the first edge)
              svgId = userEdgeId;
              edgeId = userEdgeId;
              userEdgeIdUsed = true;
              // Increment counter for this node pair (user-defined edges count too)
              this.edgeCounterMap.set(edgeKey, existingEdgeCount + 1);
            } else {
              // Auto-generated ID: use L_start_end_counter format
              // Match DB logic: counter = 0 if first edge, else existingEdgeCount + 1
              edgeId = `edge-${this.edgeIdCounter++}`;
              const counter = existingEdgeCount === 0 ? 0 : existingEdgeCount + 1;
              svgId = `L_${startNode}_${endNode}_${counter}`;
              // Increment counter for this node pair
              this.edgeCounterMap.set(edgeKey, existingEdgeCount + 1);
            }

            const edgeData: EdgeData = {
              id: edgeId,
              start: startNode,
              end: endNode,
              text: '',
              svgId: svgId,
            };

            createdEdges.push(edgeData);
            createdEdgeIds.push(edgeId);

            // Granular position for this specific occurrence (fallback to statement span)
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const sourceSv: any = (sourceStyledVertices as any[] | undefined)?.[sIdx];
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const targetSv: any = (targetStyledVertices as any[] | undefined)?.[tIdx];
            const occurrencePosition =
              sourceSv?.start && targetSv?.stop
                ? this.createPositionFromTokens(sourceSv.start, targetSv.stop)
                : edgePosition;

            // Addendum: consistently provide a tight span field without changing `position`
            const exactPosition = occurrencePosition;

            const occurrenceId = `occ:${statementId}:${occurrenceIndex}`;

            // Capture inline node defs (if a vertex has explicit shape/text in this statement)
            const sourceInline = sourceSv
              ? this.extractVertexDataFromStyledVertex(sourceSv)
              : undefined;
            if (sourceInline && (sourceInline.type || sourceInline.text)) {
              inlineNodeDefs[sourceInline.id] = sourceInline;
            }
            const targetInline = targetSv
              ? this.extractVertexDataFromStyledVertex(targetSv)
              : undefined;
            if (targetInline && (targetInline.type || targetInline.text)) {
              inlineNodeDefs[targetInline.id] = targetInline;
            }

            edgeOccurrences.push({
              occurrenceId,
              id: edgeId,
              svgId,
              start: startNode,
              end: endNode,
              position: occurrencePosition,
              exactPosition,
              parentStatementId: statementId,
              parentOriginalIndex: statementOriginalIndex,
              occurrenceIndex,
              compoundKind,
            });

            // Create element mapping for the edge
            const edgeMapping: FlowchartElementMapping = {
              id: edgeId,
              type: 'edge',
              position: occurrencePosition,
              svgId,
              statementId,
              statementOriginalIndex,
              occurrenceId,
              occurrenceIndex,
              data: edgeData,
            };
            this.elementMappings.push(edgeMapping);

            occurrenceIndex++;

            // Add to metadata.edges
            if (this.ast.metadata?.edges) {
              this.ast.metadata.edges.push({
                id: edgeId,
                isUserDefinedId: userEdgeId !== null,
                start: startNode,
                end: endNode,
                text: edgeData.text ?? '',
                labelType: 'text',
                classes: [],
              });
            }
          }
        }
      }

      // Create a single statement for the line
      // For edge chains like "A --> B --> C", use first and last nodes (A -> C)
      // This matches the old behavior where intermediate nodes are not in the statement data
      if (createdEdges.length > 0) {
        // Get first node from first edge, last node from last edge
        const firstEdge = createdEdges[0];
        const lastEdge = createdEdges[createdEdges.length - 1];
        const statementEdgeData: EdgeData = {
          id: firstEdge.id,
          start: firstEdge.start,
          end: lastEdge.end,
          text: firstEdge.text,
          svgId: firstEdge.svgId,
        };

        // Addendum: explicit compound metadata for edge statements
        const compoundKindSet = new Set(
          edgeOccurrences.map((o) => o.compoundKind).filter(Boolean) as NonNullable<
            FlowchartEdgeOccurrence['compoundKind']
          >[]
        );
        const compoundKind: NonNullable<FlowchartEdgeOccurrence['compoundKind']> =
          compoundKindSet.size === 1
            ? (compoundKindSet.values().next().value ?? 'single')
            : edgeOccurrences.length > 1
              ? 'other'
              : 'single';

        // Addendum: normalized, unambiguous representative edge (occurrenceIndex 0)
        const primaryOccurrence = edgeOccurrences[0];
        const primaryEdgeData: EdgeData | undefined = primaryOccurrence
          ? {
              id: primaryOccurrence.id,
              start: primaryOccurrence.start,
              end: primaryOccurrence.end,
              svgId: primaryOccurrence.svgId,
              text: firstEdge.text,
              type: firstEdge.type,
              stroke: firstEdge.stroke,
              length: firstEdge.length,
            }
          : undefined;

        // Addendum: if legacy statement.data endpoints match an occurrence, explicitly anchor it
        const matchingOccurrence = edgeOccurrences.find(
          (o) => o.start === statementEdgeData.start && o.end === statementEdgeData.end
        );
        const dataRef = matchingOccurrence
          ? {
              kind: 'edgeOccurrence' as const,
              occurrenceId: matchingOccurrence.occurrenceId,
              occurrenceIndex: matchingOccurrence.occurrenceIndex,
            }
          : undefined;

        const statementFlags =
          edgeOccurrences.length > 1
            ? {
                dataIsLegacyForCompoundEdges: true,
              }
            : undefined;

        const definedElements: DefinedElements = {
          edgeIds: createdEdgeIds,
          nodeIds: [...new Set(nodes)],
          inlineNodeDefs: Object.keys(inlineNodeDefs).length > 0 ? inlineNodeDefs : undefined,
        };

        const statement: FlowchartStatement = {
          type: 'edge',
          originalIndex: this.currentIndex++,
          data: statementEdgeData,
          sourceLine: sourceLine,
          position: statementPosition,
          statementId,
          edgeOccurrences,
          dataRef,
          primaryEdgeData,
          statementFlags,
          compound: {
            kind: compoundKind,
          },
          definedElements,
        };

        this.pushStatement(statement);
        this.addLine(sourceLine);
      }

      // Create element mappings for each vertex reference in the edge statement
      // This allows cursor-to-SVG highlighting to find the vertex when cursor is on the edge line
      for (const nodeId of nodes) {
        const vertexData: VertexData = {
          id: nodeId,
          text: nodeId, // Use ID as text for references
        };
        const vertexMapping: FlowchartElementMapping = {
          id: `vertex-${this.elementMappingCounter++}`,
          type: 'vertex',
          position: edgePosition, // Use same position as the edge line
          statementId,
          statementOriginalIndex,
          data: vertexData,
        };
        this.elementMappings.push(vertexMapping);
      }
    } else {
      // This is a standalone vertex (e.g., "D" or "A[Start]")
      const nodeId = this.extractNodeIdFromVertexStatement(ctx);
      const nodeText = this.extractNodeTextFromVertexStatement(ctx);
      const nodeShape = this.extractNodeShapeFromVertexStatement(ctx);

      const vertexData: VertexData = {
        id: nodeId,
        text: nodeText,
      };
      // Only set type if we detected a shape (undefined means simple node ID reference)
      if (nodeShape) {
        vertexData.type = nodeShape;
      }

      const vertexPosition = this.createPosition(ctx);
      const vertexStatementId = `stmt:${vertexPosition.startIndex}:${vertexPosition.endIndex}`;
      const vertexStatementOriginalIndex = this.currentIndex;

      const statement: FlowchartStatement = {
        type: 'vertex',
        originalIndex: this.currentIndex++,
        data: vertexData,
        sourceLine: sourceLine,
        position: vertexPosition,
        statementId: vertexStatementId,
        definedElements: {
          nodeIds: [nodeId],
          inlineNodeDefs: { [nodeId]: vertexData },
        },
      };

      this.pushStatement(statement);
      this.addLine(sourceLine);

      // Create element mapping
      const mapping: FlowchartElementMapping = {
        id: `vertex-${this.elementMappingCounter++}`,
        type: 'vertex',
        position: vertexPosition,
        statementId: vertexStatementId,
        statementOriginalIndex: vertexStatementOriginalIndex,
        data: statement.data as VertexData,
      };
      this.elementMappings.push(mapping);
    }

    return '';
  }

  /**
   * Extract node IDs from a vertex statement
   * The grammar is: vertexStatement -\> vertexStatement link node
   * So we need to traverse recursively to get all nodes in order
   */
  private extractNodesFromVertexStatement(ctx: VertexStatementContext): string[] {
    const nodes: string[] = [];

    // Recursively traverse the vertex statement to find all nodes
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traverse = (context: any): void => {
      if (!context) {
        return;
      }

      // If this is a recursive vertexStatement, traverse it FIRST (left-to-right)
      if (context.vertexStatement && typeof context.vertexStatement === 'function') {
        traverse(context.vertexStatement());
      }

      // Then extract ALL nodes from this level (handles ampersand chains like "B & C")
      if (context.node && typeof context.node === 'function') {
        const nodeCtx = context.node();
        if (nodeCtx) {
          const nodeIds = this.extractAllNodeIdsFromNode(nodeCtx);
          nodes.push(...nodeIds);
        }
      }
    };

    traverse(ctx);
    return nodes;
  }

  /**
   * Extract source and target node groups for edge creation (single edge at current level)
   * Handles ampersand chains like "A --\> B \& C" or "A \& B --\> C"
   * For "A --\> B \& C": sourceNodes = [A], targetNodes = [B, C]
   * For "A \& B --\> C": sourceNodes = [A, B], targetNodes = [C]
   */
  private extractEdgeNodeGroups(ctx: VertexStatementContext): {
    sourceNodes: string[];
    targetNodes: string[];
  } {
    // Get the target nodes from the current level's node context (right side of link)
    const nodeCtx = ctx.node();
    const targetNodes = nodeCtx ? this.extractAllNodeIdsFromNode(nodeCtx) : [];

    // Get the source nodes from the child vertexStatement (left side of link)
    const childVertexStatement = ctx.vertexStatement ? ctx.vertexStatement() : null;
    let sourceNodes: string[] = [];

    if (childVertexStatement) {
      // Get the source nodes from the child's node context
      // This works for both simple cases (A --> B) and chains (A --> B --> C)
      // In chains, the source of the current link is the target of the previous link
      const childNodeCtx = childVertexStatement.node();
      sourceNodes = childNodeCtx ? this.extractAllNodeIdsFromNode(childNodeCtx) : [];
    }

    return { sourceNodes, targetNodes };
  }

  /**
   * Extract ALL edge pairs from a chained vertex statement
   * For "A --\> B --\> C": returns sourceNodes: [A], targetNodes: [B] and sourceNodes: [B], targetNodes: [C]
   * This handles nested chains recursively
   */
  private extractAllEdgePairs(ctx: VertexStatementContext): {
    sourceNodes: string[];
    targetNodes: string[];
    userEdgeId: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sourceStyledVertices: any[];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    targetStyledVertices: any[];
  }[] {
    const allEdges: {
      sourceNodes: string[];
      targetNodes: string[];
      userEdgeId: string | null;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sourceStyledVertices: any[];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      targetStyledVertices: any[];
    }[] = [];

    // Recursive helper to collect all edges from innermost to outermost
    const collectEdges = (vertexCtx: VertexStatementContext): void => {
      // Check if this context has a link (i.e., it's an edge, not just a node)
      const childVertexStatement = vertexCtx.vertexStatement ? vertexCtx.vertexStatement() : null;
      const hasLink = childVertexStatement !== null && childVertexStatement !== undefined;

      if (hasLink) {
        // First, recursively process the child vertex statement (inner edges)
        collectEdges(childVertexStatement);

        // Then, extract the edge at this level
        const nodeCtx = vertexCtx.node();
        const targetNodes = nodeCtx ? this.extractAllNodeIdsFromNode(nodeCtx) : [];
        const targetStyledVertices = nodeCtx ? this.extractAllStyledVerticesFromNode(nodeCtx) : [];

        // Source nodes come from the child's node context
        const childNodeCtx = childVertexStatement.node();
        const sourceNodes = childNodeCtx ? this.extractAllNodeIdsFromNode(childNodeCtx) : [];
        const sourceStyledVertices = childNodeCtx
          ? this.extractAllStyledVerticesFromNode(childNodeCtx)
          : [];

        // Extract user-defined edge ID from the link at this level
        const linkCtx = vertexCtx.link();
        const userEdgeId = this.extractEdgeIdFromLink(linkCtx);

        if (sourceNodes.length > 0 && targetNodes.length > 0) {
          allEdges.push({
            sourceNodes,
            targetNodes,
            userEdgeId,
            sourceStyledVertices,
            targetStyledVertices,
          });
        }
      }
      // If no link, this is just a node (base case) - no edge to add
    };

    collectEdges(ctx);
    return allEdges;
  }

  /**
   * Extract node ID from a vertex statement (for standalone vertices)
   */
  private extractNodeIdFromVertexStatement(ctx: VertexStatementContext): string {
    // Get the node context
    const nodeCtx = ctx.node();
    if (!nodeCtx) {
      return this.getContextText(ctx).trim();
    }

    return this.extractNodeIdFromNode(nodeCtx);
  }

  /**
   * Extract node text from a vertex statement (for standalone vertices)
   */
  private extractNodeTextFromVertexStatement(ctx: VertexStatementContext): string {
    // First check for label in shapeData context on vertexStatement level (e.g., A@{ shape: db, label: "Text" })
    const shapeDataCtx = ctx.shapeData ? ctx.shapeData() : null;
    if (shapeDataCtx) {
      const labelFromData = this.extractLabelFromShapeData(shapeDataCtx);
      if (labelFromData) {
        return labelFromData;
      }
    }

    // Get the node context
    const nodeCtx = ctx.node();
    if (!nodeCtx) {
      return '';
    }

    // Check for label in shapeData on the node's styledVertex
    const styledVertexCtx = nodeCtx.styledVertex ? nodeCtx.styledVertex() : null;
    if (styledVertexCtx) {
      const styledShapeDataCtx = styledVertexCtx.shapeData ? styledVertexCtx.shapeData() : null;
      if (styledShapeDataCtx) {
        const labelFromData = this.extractLabelFromShapeData(styledShapeDataCtx);
        if (labelFromData) {
          return labelFromData;
        }
      }
    }

    return this.extractNodeTextFromNode(nodeCtx);
  }

  /**
   * Extract label value from shapeData context (e.g., \@\{ shape: db, label: "text" \})
   * Returns the label text or undefined if not found
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractLabelFromShapeData(shapeDataCtx: any): string | undefined {
    if (!shapeDataCtx) {
      return undefined;
    }

    // Get the full text of shapeData (e.g., "{ shape: db, label: \"Database\" }")
    const text = shapeDataCtx.getText();
    if (!text) {
      return undefined;
    }

    // Extract label value using regex
    // Matches: label: "text" or label: 'text' or label: text
    const labelMatch = text.match(/label\s*:\s*"([^"]+)"|label\s*:\s*'([^']+)'/);
    if (labelMatch) {
      return labelMatch[1] ?? labelMatch[2];
    }

    // Try unquoted label (less common)
    const unquotedMatch = text.match(/label\s*:\s*([^\s"',}]+)/);
    if (unquotedMatch?.[1]) {
      return unquotedMatch[1];
    }

    return undefined;
  }

  /**
   * Extract node shape/type from a vertex statement (for standalone vertices)
   * Returns the shape type based on the vertex tokens, or undefined for simple node IDs
   */
  private extractNodeShapeFromVertexStatement(
    ctx: VertexStatementContext
  ): FlowVertexTypeParam | undefined {
    // First check for shapeData context on vertexStatement level (e.g., A@{ shape: db })
    const shapeDataCtx = ctx.shapeData ? ctx.shapeData() : null;
    if (shapeDataCtx) {
      const shapeFromData = this.extractShapeFromShapeData(shapeDataCtx);
      if (shapeFromData) {
        return shapeFromData as FlowVertexTypeParam;
      }
    }

    // Get the node context
    const nodeCtx = ctx.node();
    if (!nodeCtx) {
      return undefined;
    }

    // Check for shapeData on the node's styledVertex
    const styledVertexCtx = nodeCtx.styledVertex ? nodeCtx.styledVertex() : null;
    if (styledVertexCtx) {
      const styledShapeDataCtx = styledVertexCtx.shapeData ? styledVertexCtx.shapeData() : null;
      if (styledShapeDataCtx) {
        const shapeFromData = this.extractShapeFromShapeData(styledShapeDataCtx);
        if (shapeFromData) {
          return shapeFromData as FlowVertexTypeParam;
        }
      }
    }

    return this.extractNodeShapeFromNode(nodeCtx);
  }

  /**
   * Extract shape value from shapeData context (e.g., \@\{ shape: db, label: "text" \})
   * Returns the shape name or undefined if not found
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractShapeFromShapeData(shapeDataCtx: any): string | undefined {
    if (!shapeDataCtx) {
      return undefined;
    }

    // Get the full text of shapeData (e.g., "{ shape: db, label: \"Database\" }")
    const text = shapeDataCtx.getText();
    if (!text) {
      return undefined;
    }

    // Extract shape value using regex
    // Matches: shape: db or shape: "db" or shape: 'db'
    const shapeMatch = text.match(/shape\s*:\s*["']?([^\s"',}]+)["']?/);
    if (shapeMatch?.[1]) {
      return shapeMatch[1];
    }

    return undefined;
  }

  /**
   * Extract node shape/type from a node context
   * Delegates to the shared shape extraction utility to avoid code duplication
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractNodeShapeFromNode(nodeCtx: any): FlowVertexTypeParam | undefined {
    // Try to get styledVertex
    const styledVertexCtx = nodeCtx.styledVertex ? nodeCtx.styledVertex() : null;
    if (!styledVertexCtx) {
      return undefined;
    }

    // Try to get vertex from styledVertex
    const vertexCtx = styledVertexCtx.vertex ? styledVertexCtx.vertex() : null;
    if (!vertexCtx) {
      return undefined;
    }

    // Use the shared utility function to extract shape
    return extractShapeFromVertexContext(vertexCtx) as FlowVertexTypeParam | undefined;
  }

  /**
   * Extract node ID from a node context (returns first ID only)
   * For ampersand chains like "B & C", use extractAllNodeIdsFromNode instead
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractNodeIdFromNode(nodeCtx: any): string {
    const allIds = this.extractAllNodeIdsFromNode(nodeCtx);
    return allIds.length > 0 ? allIds[0] : '';
  }

  /**
   * Extract ALL node IDs from a node context (handles ampersand chains like "B & C")
   * The node grammar is recursive: node: styledVertex | node AMP styledVertex
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractAllNodeIdsFromNode(nodeCtx: any): string[] {
    const nodeIds: string[] = [];

    // Recursively traverse the node context to get all styled vertices
    // The grammar is left-recursive: node AMP styledVertex
    // So nodeCtx.node() returns the left side of the chain
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const traverse = (ctx: any): void => {
      if (!ctx) {
        return;
      }

      // If there's a nested node (left side of ampersand chain), traverse it first
      if (ctx.node && typeof ctx.node === 'function') {
        const nestedNode = ctx.node();
        if (nestedNode) {
          traverse(nestedNode);
        }
      }

      // Get the styledVertex at this level (right side of chain or the single vertex)
      if (ctx.styledVertex && typeof ctx.styledVertex === 'function') {
        const styledVertexCtx = ctx.styledVertex();
        if (styledVertexCtx) {
          const nodeId = this.extractNodeIdFromStyledVertex(styledVertexCtx);
          if (nodeId) {
            nodeIds.push(nodeId);
          }
        }
      }
    };

    traverse(nodeCtx);
    return nodeIds;
  }

  /**
   * Extract ALL styledVertex contexts from a node context (handles ampersand chains like "B & C").
   * The returned array is ordered left-to-right and aligns with extractAllNodeIdsFromNode().
   */
  private extractAllStyledVerticesFromNode(nodeCtx: ParserRuleContext): ParserRuleContext[] {
    const styledVertices: ParserRuleContext[] = [];

    // Interface for ANTLR-generated node context with optional children methods
    interface NodeContextShape {
      node?: () => NodeContextShape | null;
      styledVertex?: () => ParserRuleContext | null;
    }

    const traverse = (ctx: NodeContextShape | null): void => {
      if (!ctx) {
        return;
      }

      if (ctx.node && typeof ctx.node === 'function') {
        const nestedNode = ctx.node();
        if (nestedNode) {
          traverse(nestedNode);
        }
      }

      if (ctx.styledVertex && typeof ctx.styledVertex === 'function') {
        const styledVertexCtx = ctx.styledVertex();
        if (styledVertexCtx) {
          styledVertices.push(styledVertexCtx);
        }
      }
    };

    traverse(nodeCtx as NodeContextShape);
    return styledVertices;
  }

  /**
   * Extract node ID from a styledVertex context
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractNodeIdFromStyledVertex(styledVertexCtx: any): string {
    if (!styledVertexCtx) {
      return '';
    }

    // Try to get vertex from styledVertex
    const vertexCtx = styledVertexCtx.vertex ? styledVertexCtx.vertex() : null;
    if (!vertexCtx) {
      return this.getContextText(styledVertexCtx).trim();
    }

    // Try to get idString from vertex
    const idStringCtx = vertexCtx.idString ? vertexCtx.idString() : null;
    if (idStringCtx) {
      return this.getContextText(idStringCtx).trim();
    }

    // Fallback: extract first word/identifier from the text
    const text = this.getContextText(vertexCtx).trim();
    const match = /^([\w-]+)/.exec(text);
    return match ? match[1] : text;
  }

  /**
   * Extract inline VertexData from a styledVertex context (when the source actually defines
   * text/shape for the vertex inline, e.g. A[Start]).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractVertexDataFromStyledVertex(styledVertexCtx: any): VertexData | undefined {
    if (!styledVertexCtx) {
      return undefined;
    }

    const id = this.extractNodeIdFromStyledVertex(styledVertexCtx);
    if (!id) {
      return undefined;
    }

    const data: VertexData = { id };

    // Prefer shapeData (A@{ shape:..., label:... }) if present
    const shapeDataCtx = styledVertexCtx.shapeData ? styledVertexCtx.shapeData() : null;
    if (shapeDataCtx) {
      const labelFromData = this.extractLabelFromShapeData(shapeDataCtx);
      if (labelFromData) {
        data.text = labelFromData;
      }
      const shapeFromData = this.extractShapeFromShapeData(shapeDataCtx);
      if (shapeFromData) {
        data.type = shapeFromData as FlowVertexTypeParam;
      }
    }

    const vertexCtx = styledVertexCtx.vertex ? styledVertexCtx.vertex() : null;
    if (vertexCtx) {
      if (!data.type) {
        const shapeFromTokens = extractShapeFromVertexContext(vertexCtx) as
          | FlowVertexTypeParam
          | undefined;
        if (shapeFromTokens) {
          data.type = shapeFromTokens;
        }
      }

      if (!data.text) {
        // After left-factoring optimization, text is in vertexShape child
        const vertexShapeCtx = vertexCtx.vertexShape ? vertexCtx.vertexShape() : null;
        const textCtx = vertexShapeCtx?.text ? vertexShapeCtx.text() : null;
        if (textCtx) {
          let text = this.getContextText(textCtx).trim();
          if (text.startsWith('"') && text.endsWith('"')) {
            text = text.substring(1, text.length - 1);
          }
          if (text) {
            data.text = text;
          }
        } else if (vertexShapeCtx) {
          // Handle complete tokens that contain embedded text
          const extractedText = extractTextFromCompleteToken(vertexShapeCtx);
          if (extractedText) {
            data.text = extractedText;
          }
        }
      }
    }

    // Only treat as an inline def if there is explicit shape/text.
    if (!data.type && !data.text) {
      return { id };
    }

    return data;
  }

  /**
   * Extract node text from a node context (text inside shape)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractNodeTextFromNode(nodeCtx: any): string {
    // Try to get styledVertex
    const styledVertexCtx = nodeCtx.styledVertex ? nodeCtx.styledVertex() : null;
    if (!styledVertexCtx) {
      return '';
    }

    // Try to get vertex from styledVertex
    const vertexCtx = styledVertexCtx.vertex ? styledVertexCtx.vertex() : null;
    if (!vertexCtx) {
      return '';
    }

    // Try to get text from vertex - after left-factoring, text is in vertexShape child
    const vertexShapeCtx = vertexCtx.vertexShape ? vertexCtx.vertexShape() : null;
    const textCtx = vertexShapeCtx?.text ? vertexShapeCtx.text() : null;
    if (textCtx) {
      let text = this.getContextText(textCtx).trim();
      // Strip quotes if string starts and ends with a quote (matches flowDb.ts behavior)
      if (text.startsWith('"') && text.endsWith('"')) {
        text = text.substring(1, text.length - 1);
      }
      return text;
    }

    // Try to extract from complete tokens
    if (vertexShapeCtx) {
      const extractedText = extractTextFromCompleteToken(vertexShapeCtx);
      if (extractedText) {
        return extractedText;
      }
    }

    // No text found (simple node ID without shape)
    return '';
  }

  /**
   * Extract user-defined edge ID from a link context
   * Returns the LINK_ID text (with trailing `@` removed) if present, otherwise null
   */
  private extractEdgeIdFromLink(linkCtx: LinkContext | null): string | null {
    if (!linkCtx) {
      return null;
    }

    // Check if link context has a LINK_ID token
    const linkIdToken = linkCtx.LINK_ID();
    if (linkIdToken) {
      // LINK_ID format is "edgeId@" - strip the trailing @
      const linkIdText = linkIdToken.getText();
      return linkIdText.endsWith('@') ? linkIdText.slice(0, -1) : linkIdText;
    }

    // Also check the linkStatement context which can contain LINK_ID
    const linkStatement = linkCtx.linkStatement();
    if (linkStatement) {
      const linkIdInStatement = linkStatement.LINK_ID();
      if (linkIdInStatement) {
        const linkIdText = linkIdInStatement.getText();
        return linkIdText.endsWith('@') ? linkIdText.slice(0, -1) : linkIdText;
      }
    }

    return null;
  }

  /**
   * Visit standalone vertex
   */
  visitStandaloneVertex(ctx: StandaloneVertexContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const position = this.createPosition(ctx);
    const statementId = `stmt:${position.startIndex}:${position.endIndex}`;
    const statementOriginalIndex = this.currentIndex++;

    const statement: FlowchartStatement = {
      type: 'vertex',
      originalIndex: statementOriginalIndex,
      data: {
        id: text,
        text: text,
      } as VertexData,
      sourceLine: sourceLine,
      position,
      statementId,
      definedElements: {
        nodeIds: [text],
        inlineNodeDefs: { [text]: { id: text, text } },
      },
    };

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit style statement
   */
  visitStyleStatement(ctx: StyleStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'style',
      originalIndex: this.currentIndex++,
      data: {
        id: '',
        styles: [],
      } as StyleData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit link style statement
   */
  visitLinkStyleStatement(ctx: LinkStyleStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'linkStyle',
      originalIndex: this.currentIndex++,
      data: {
        indices: [],
        styles: [],
      } as LinkStyleData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit class definition statement
   */
  visitClassDefStatement(ctx: ClassDefStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'classDef',
      originalIndex: this.currentIndex++,
      data: {
        id: '',
        styles: [],
      } as ClassDefData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit class statement
   */
  visitClassStatement(ctx: ClassStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'class',
      originalIndex: this.currentIndex++,
      data: {
        ids: [],
        className: '',
      } as ClassAssignmentData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit click statement
   */
  visitClickStatement(ctx: ClickStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'click',
      originalIndex: this.currentIndex++,
      data: {
        nodeId: '',
      } as ClickData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit subgraph statement
   */
  visitSubgraphStatement(ctx: SubgraphStatementContext): string {
    const text = this.getContextText(ctx);

    // Extract subgraph ID and title from context
    const { id, title } = this.extractSubgraphIdAndTitle(ctx);

    // Get position for the subgraph declaration line (just the first line)
    const subgraphPosition = this.createSubgraphDeclarationPosition(ctx);

    // Start subgraph block
    this.addLine('subgraph ' + text.split('\n')[0].replace('subgraph', '').trim());
    this.currentIndent++;

    // Push a new block onto the stack
    this.blockStack.push({
      type: 'subgraph',
      statements: [],
    });

    // Visit document inside subgraph
    if (ctx.document()) {
      this.visit(ctx.document());
    }

    // Pop the block
    const block = this.blockStack.pop();

    // Create subgraph data
    const subgraphData: SubgraphData = {
      id: id,
      title: title,
      statements: block?.statements ?? [],
    };

    const statementPosition = this.createPosition(ctx);
    const statementId = `stmt:${statementPosition.startIndex}:${statementPosition.endIndex}`;
    const statementOriginalIndex = this.currentIndex;

    // Create subgraph statement
    const statement: FlowchartStatement = {
      type: 'subgraph',
      originalIndex: this.currentIndex++,
      data: subgraphData,
      sourceLine: text,
      position: statementPosition,
      statementId,
    };

    this.pushStatement(statement);

    // Create element mapping for the subgraph (for bidirectional sync)
    // SVG subgraphs use data-id="<id>" and data-et="cluster"
    const subgraphMapping: FlowchartElementMapping = {
      id: `subgraph-${this.elementMappingCounter++}`,
      type: 'subgraph',
      position: subgraphPosition,
      svgId: id, // The subgraph ID is used as the SVG element ID
      svgSelector: `[data-id="${id}"][data-et="cluster"]`,
      statementId,
      statementOriginalIndex,
      data: subgraphData,
    };
    this.elementMappings.push(subgraphMapping);

    // Add to metadata.subgraphs
    if (this.ast.metadata?.subgraphs) {
      this.ast.metadata.subgraphs.set(id, subgraphData);
    }

    // End subgraph
    this.currentIndent--;
    this.addLine('end');

    return '';
  }

  /**
   * Create position for subgraph declaration line only (not the entire block)
   * This makes highlighting work correctly when cursor is on the "subgraph xxx" line
   */
  private createSubgraphDeclarationPosition(ctx: SubgraphStatementContext): ElementPosition {
    const startToken = ctx.start;
    const text = this.getContextText(ctx);

    // Get the first line only (the declaration line)
    const firstLineEnd = text.indexOf('\n');
    const firstLineLength = firstLineEnd > 0 ? firstLineEnd : text.length;

    return {
      startLine: startToken?.line ?? 1,
      startColumn: (startToken?.column ?? 0) + 1,
      endLine: startToken?.line ?? 1, // Same line for declaration only
      endColumn: (startToken?.column ?? 0) + 1 + firstLineLength,
      startIndex: startToken?.start ?? 0,
      endIndex: (startToken?.start ?? 0) + firstLineLength,
    };
  }

  /**
   * Extract subgraph ID and title from context
   * Follows grammar patterns:
   * - SUBGRAPH WS textNoTags SQS text SQE - textNoTags is ID, text is title
   * - SUBGRAPH WS textNoTags - textNoTags is both ID and title
   * - SUBGRAPH - no ID or title (auto-generate)
   */
  private extractSubgraphIdAndTitle(ctx: SubgraphStatementContext): { id: string; title: string } {
    // Check if we have the pattern with square brackets (ID + title)
    const hasSQS = ctx.SQS() !== null;
    // Check if we have SQUARE_COMPLETE token (e.g., subgraph s1[Title])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const squareComplete = (ctx as any).SQUARE_COMPLETE?.();

    if (hasSQS) {
      // Pattern: SUBGRAPH WS textNoTags SQS text SQE
      // textNoTags is the ID, text is the title
      const textNoTags = ctx.textNoTags();
      const textCtx = ctx.text();

      const id = textNoTags ? textNoTags.getText().trim() : `subGraph${this.currentIndex}`;
      let title = textCtx ? textCtx.getText().trim() : id;
      // Remove surrounding quotes if present
      if (
        (title.startsWith('"') && title.endsWith('"')) ||
        (title.startsWith("'") && title.endsWith("'"))
      ) {
        title = title.slice(1, -1);
      }

      return { id, title };
    } else if (squareComplete) {
      // Pattern: SUBGRAPH WS textNoTags SQUARE_COMPLETE
      // textNoTags is the ID, SQUARE_COMPLETE contains the title in [Title] format
      const textNoTags = ctx.textNoTags();
      const id = textNoTags ? textNoTags.getText().trim() : `subGraph${this.currentIndex}`;

      // Extract title from SQUARE_COMPLETE token: [Title] -> Title
      const squareText = squareComplete.getText();
      let title = squareText.slice(1, -1); // Remove [ and ]
      // Remove surrounding quotes if present
      if (
        (title.startsWith('"') && title.endsWith('"')) ||
        (title.startsWith("'") && title.endsWith("'"))
      ) {
        title = title.slice(1, -1);
      }

      return { id, title };
    } else {
      // Pattern: SUBGRAPH WS textNoTags - textNoTags is both ID and title
      const textNoTags = ctx.textNoTags();

      if (textNoTags) {
        const rawText = textNoTags.getText().trim();

        // If the text is quoted, treat it as a title-only subgraph (auto-generate ID)
        if (
          (rawText.startsWith('"') && rawText.endsWith('"')) ||
          (rawText.startsWith("'") && rawText.endsWith("'"))
        ) {
          // Remove quotes for title
          const title = rawText.slice(1, -1);
          return { id: `subGraph${this.currentIndex}`, title };
        }

        // Otherwise, treat it as both ID and title
        return { id: rawText, title: rawText };
      }
    }

    // Pattern: SUBGRAPH - generate a unique ID
    return { id: `subGraph${this.currentIndex}`, title: '' };
  }

  /**
   * Visit direction statement
   */
  visitDirection(ctx: DirectionContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    // Extract direction
    let direction: 'TB' | 'TD' | 'BT' | 'RL' | 'LR' = 'TB';
    if (text.includes('TB')) {
      direction = 'TB';
    } else if (text.includes('TD')) {
      direction = 'TD';
    } else if (text.includes('BT')) {
      direction = 'BT';
    } else if (text.includes('RL')) {
      direction = 'RL';
    } else if (text.includes('LR')) {
      direction = 'LR';
    }

    const statement: FlowchartStatement = {
      type: 'direction',
      originalIndex: this.currentIndex++,
      data: {
        direction: direction,
      } as DirectionData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit accessibility title statement
   */
  visitAccTitle(ctx: AccTitleContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'accTitle',
      originalIndex: this.currentIndex++,
      data: {
        title: text.replace('accTitle:', '').trim(),
      } as AccTitleData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit accessibility description statement
   */
  visitAccDescr(ctx: AccDescrContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'accDescr',
      originalIndex: this.currentIndex++,
      data: {
        description: text.replace('accDescr:', '').trim(),
      } as AccDescrData,
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }

  /**
   * Visit comment statement - preserves comments for round-trip code generation
   * Comments MUST increment originalIndex to maintain exact source order
   */
  visitCommentStatement(ctx: CommentStatementContext): string {
    const text = this.getContextText(ctx);
    const sourceLine = text;

    const statement: FlowchartStatement = {
      type: 'comment',
      originalIndex: this.currentIndex++, // MUST increment for exact source preservation
      data: {
        text: sourceLine,
      },
      sourceLine: sourceLine,
    };

    this.attachStatementMeta(statement, ctx);

    this.pushStatement(statement);
    this.addLine(sourceLine);

    return '';
  }
}
