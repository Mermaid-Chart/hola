/**
 * JisonFlowchartASTBuilder
 *
 * Builds a FlowchartAST (with element mappings and sync methods) from the
 * source text + populated FlowDB after Jison parsing.
 *
 * The resulting AST is structurally equivalent to what the ANTLR
 * FlowchartASTBuilder produces, so bidirectional sync works identically
 * regardless of which parser is used.
 */

import type { FlowDB } from '../../flowDb.js';
import type {
  FlowchartAST,
  FlowchartStatement,
  FlowchartElementMapping,
  ElementPosition,
  VertexData,
  EdgeData,
  SubgraphData,
  FlowchartEdgeOccurrence,
  DefinedElements,
  StyleData,
  LinkStyleData,
  ClassDefData,
  ClassAssignmentData,
  ClickData,
  DirectionData,
  AccTitleData,
  AccDescrData,
  FlowEdge,
  FlowVertex,
  FlowSubGraph,
} from '../../types.js';
import { attachSyncMethodsToAST } from '../FlowchartSyncMethods.js';

/** Lightweight representation of a parsed source line. */
interface SourceLine {
  /** 1-based line number */
  lineNumber: number;
  /** The raw text of the line (trimmed of leading/trailing whitespace for matching) */
  raw: string;
  /** The trimmed text */
  trimmed: string;
  /** Character offset (0-based) of the first character on this line in the full source */
  startIndex: number;
  /** Character offset (0-based) of the last character on this line in the full source */
  endIndex: number;
  /** Number of leading whitespace characters */
  indent: number;
}

export class JisonFlowchartASTBuilder {
  private elementMappings: FlowchartElementMapping[] = [];
  private elementMappingCounter = 0;
  private edgeIdCounter = 0;
  private svgIdCounter = 0;
  private currentIndex = 0;

  // Edge counter map for generating SVG IDs in format L_start_end_counter
  private edgeCounterMap = new Map<string, number>();

  /**
   * Build a FlowchartAST from the source text and a populated FlowDB.
   *
   * @param cleanedText - The text that was actually parsed by Jison (comments stripped)
   * @param db - The populated FlowDB after Jison parsing
   * @param originalText - Optional original text (before comment cleanup) for correct
   *   line number mapping. If not provided, cleanedText is used (positions will be
   *   relative to the cleaned text, which is fine for tests without comments).
   */
  buildAST(cleanedText: string, db: FlowDB, originalText?: string): FlowchartAST {
    this.reset();

    const ast = this.createEmptyAST();

    // Use original text for line numbering if available, otherwise fall back to cleaned text
    const positionSourceText = originalText ?? cleanedText;

    // Parse ORIGINAL source into lines (for correct line numbers)
    const sourceLines = this.splitSourceLines(positionSourceText);

    // Get DB data
    const vertices = db.getVertices();
    const edges = db.getEdges();
    const subGraphs = db.getSubGraphs();
    const direction = db.getDirection();

    // Detect header
    const headerLine = sourceLines.length > 0 ? sourceLines[0] : undefined;
    if (headerLine) {
      const headerInfo = this.parseHeaderLine(headerLine);
      ast.header = headerInfo.header;
      ast.direction = headerInfo.direction;
    } else {
      ast.header = 'flowchart';
      ast.direction = (direction as FlowchartAST['direction']) ?? 'TB';
    }

    // Process each source line (skip header)
    // Comment lines are included as comment statements but skipped for FlowDB matching
    const contentLines = sourceLines.slice(1);
    this.processContentLines(contentLines, ast, vertices, edges, subGraphs);

    // Rebuild metadata
    this.rebuildMetadata(ast, vertices, edges, subGraphs);

    // Add element mappings and sync methods
    ast.elementMappings = [...this.elementMappings];
    attachSyncMethodsToAST(ast, this.elementMappings);

    return ast;
  }

  private reset(): void {
    this.elementMappings = [];
    this.elementMappingCounter = 0;
    this.edgeIdCounter = 0;
    this.svgIdCounter = 0;
    this.currentIndex = 0;
    this.edgeCounterMap = new Map();
  }

  private createEmptyAST(): FlowchartAST {
    return {
      header: 'flowchart',
      statements: [],
      elementMappings: [],
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
        nodes: Object.create(null) as Record<string, VertexData>,
        edges: [],
        subgraphs: new Map(),
        classes: new Map(),
      },
    };
  }

  /** Split source text into SourceLine objects. */
  private splitSourceLines(source: string): SourceLine[] {
    const rawLines = source.split('\n');
    const result: SourceLine[] = [];
    let offset = 0;
    for (const [i, raw] of rawLines.entries()) {
      const trimmed = raw.trim();
      const indent = raw.length - raw.trimStart().length;
      result.push({
        lineNumber: i + 1,
        raw,
        trimmed,
        startIndex: offset,
        endIndex: offset + raw.length - 1,
        indent,
      });
      offset += raw.length + 1; // +1 for the newline
    }
    return result;
  }

  /** Parse the header line (e.g. "flowchart TD") */
  private parseHeaderLine(line: SourceLine): {
    header: 'flowchart' | 'graph';
    direction: FlowchartAST['direction'];
  } {
    const text = line.trimmed;
    const header: 'flowchart' | 'graph' = text.startsWith('graph') ? 'graph' : 'flowchart';
    const dirMatch = /(?:flowchart|graph)\s+([A-Z]{2}|[<>^v])/.exec(text);
    let direction: FlowchartAST['direction'] = 'TB';
    if (dirMatch) {
      const dir = dirMatch[1];
      switch (dir) {
        case 'TD':
        case 'v':
          direction = 'TB';
          break;
        case 'TB':
          direction = 'TB';
          break;
        case 'BT':
        case '^':
          direction = 'BT';
          break;
        case 'LR':
        case '>':
          direction = 'LR';
          break;
        case 'RL':
        case '<':
          direction = 'RL';
          break;
        default:
          direction = 'TB';
      }
    }
    return { header, direction };
  }

  /**
   * Classify a trimmed source line into a statement type.
   * Returns null if the line is empty, a comment, or unrecognised.
   */
  private classifyLine(
    trimmed: string
  ): FlowchartStatement['type'] | 'blankLine' | 'comment' | null {
    if (trimmed.length === 0) {
      return 'blankLine';
    }
    if (trimmed.startsWith('%%')) {
      return 'comment';
    }
    if (trimmed.startsWith('style ')) {
      return 'style';
    }
    if (trimmed.startsWith('linkStyle ')) {
      return 'linkStyle';
    }
    if (trimmed.startsWith('classDef ')) {
      return 'classDef';
    }
    if (trimmed.startsWith('class ')) {
      return 'class';
    }
    if (trimmed.startsWith('click ')) {
      return 'click';
    }
    if (trimmed === 'subgraph' || trimmed.startsWith('subgraph ')) {
      return 'subgraph';
    }
    if (trimmed === 'end') {
      return null;
    } // subgraph end marker
    if (/^direction\s+(TB|TD|BT|LR|RL)$/.test(trimmed)) {
      return 'direction';
    }
    if (trimmed.startsWith('accTitle')) {
      return 'accTitle';
    }
    if (trimmed.startsWith('accDescr')) {
      return 'accDescr';
    }
    // Check for edge patterns (contains arrow-like tokens)
    if (this.looksLikeEdge(trimmed)) {
      return 'edge';
    }
    // Otherwise it's a standalone vertex
    return 'vertex';
  }

  /** Heuristic: does the line contain an edge arrow? */
  private looksLikeEdge(text: string): boolean {
    // Match common edge patterns: -->, --->, -.->  ==>  ~~~  --text-->  etc.
    return (
      /-->|==>|-.->|-\.->|~~~|--[^>]*-->|==+>|--+>|\.\.-\.?>|<-->|<-\.->|o--|x--|--o|--x|--+\|/.test(
        text
      ) ||
      /\s+---+\s+/.test(text) || // long dashes
      /\s+===+\s+/.test(text)
    ); // thick edges
  }

  /**
   * Process content lines, building statements and element mappings.
   * Handles subgraph blocks via a simple stack.
   */
  private processContentLines(
    lines: SourceLine[],
    ast: FlowchartAST,
    vertices: Map<string, FlowVertex>,
    edges: FlowEdge[],
    subGraphs: FlowSubGraph[]
  ): void {
    // Track which edges have been consumed (in order)
    let edgeIndex = 0;

    // Stack for subgraph nesting: each entry collects statements for that subgraph
    const blockStack: {
      type: 'subgraph';
      statements: FlowchartStatement[];
      id: string;
      title: string;
      startLine: SourceLine;
    }[] = [];

    const pushStatement = (stmt: FlowchartStatement): void => {
      if (blockStack.length > 0) {
        blockStack[blockStack.length - 1].statements.push(stmt);
      } else {
        ast.statements.push(stmt);
      }
    };

    for (const line of lines) {
      const kind = this.classifyLine(line.trimmed);

      if (kind === null) {
        // 'end' token – pop subgraph block
        if (line.trimmed === 'end' && blockStack.length > 0) {
          const block = blockStack.pop()!;
          const subgraphData: SubgraphData = {
            id: block.id,
            title: block.title,
            statements: block.statements,
          };
          const position = this.makePosition(block.startLine, line);
          const statementId = `stmt:${position.startIndex}:${position.endIndex}`;
          const statementOriginalIndex = this.currentIndex;
          const statement: FlowchartStatement = {
            type: 'subgraph',
            originalIndex: this.currentIndex++,
            data: subgraphData,
            sourceLine: block.startLine.raw,
            position,
            statementId,
          };
          pushStatement(statement);

          // Element mapping for subgraph – use declaration line only for position
          const declPosition = this.makePosition(block.startLine, block.startLine);
          const subgraphMapping: FlowchartElementMapping = {
            id: `subgraph-${this.elementMappingCounter++}`,
            type: 'subgraph',
            position: declPosition,
            svgId: block.id,
            svgSelector: `[data-id="${block.id}"][data-et="cluster"]`,
            statementId,
            statementOriginalIndex,
            data: subgraphData,
          };
          this.elementMappings.push(subgraphMapping);
        }
        continue;
      }

      if (kind === 'blankLine') {
        pushStatement({
          type: 'blankLine',
          originalIndex: this.currentIndex++,
          data: {},
          sourceLine: '',
        });
        continue;
      }

      if (kind === 'comment') {
        pushStatement({
          type: 'comment',
          originalIndex: this.currentIndex++,
          data: { text: line.trimmed },
          sourceLine: line.trimmed,
          ...this.makeStatementMeta(line),
        });
        continue;
      }

      if (kind === 'subgraph') {
        // Parse subgraph ID / title from the line
        const { id, title } = this.parseSubgraphHeader(line.trimmed, subGraphs);
        blockStack.push({ type: 'subgraph', statements: [], id, title, startLine: line });
        continue;
      }

      const position = this.makePosition(line, line);
      const statementId = `stmt:${position.startIndex}:${position.endIndex}`;
      const statementOriginalIndex = this.currentIndex;

      if (kind === 'edge') {
        // Consume matching edges from DB in order
        const edgeResult = this.buildEdgeStatement(
          line,
          edges,
          edgeIndex,
          statementId,
          statementOriginalIndex,
          vertices
        );
        edgeIndex = edgeResult.newEdgeIndex;
        pushStatement(edgeResult.statement);
      } else if (kind === 'vertex') {
        const vertexResult = this.buildVertexStatement(
          line,
          vertices,
          statementId,
          statementOriginalIndex
        );
        pushStatement(vertexResult.statement);
      } else {
        // style, linkStyle, classDef, class, click, direction, accTitle, accDescr
        const stmt = this.buildSimpleStatement(kind, line);
        pushStatement(stmt);
      }
    }
  }

  /** Build an edge statement from a source line, consuming edges from the DB edge list. */
  private buildEdgeStatement(
    line: SourceLine,
    edges: FlowEdge[],
    edgeIndex: number,
    statementId: string,
    statementOriginalIndex: number,
    vertices: Map<string, FlowVertex>
  ): { statement: FlowchartStatement; newEdgeIndex: number } {
    const position = this.makePosition(line, line);

    // Extract all node IDs referenced on this line
    const nodeIds = this.extractNodeIdsFromEdgeLine(line.trimmed, vertices);

    // Count how many edges this line produces by checking DB edges starting from edgeIndex
    // We consume edges whose start/end match nodes on this line
    const lineEdges: FlowEdge[] = [];
    let idx = edgeIndex;

    // Determine how many edges this line should produce
    // Each arrow on the line produces edges: for chained A-->B-->C, 2 edges; for A & B --> C & D, 4 edges
    const expectedEdgeCount = this.countEdgesOnLine(line.trimmed, nodeIds);

    for (let i = 0; i < expectedEdgeCount && idx < edges.length; i++) {
      lineEdges.push(edges[idx]);
      idx++;
    }

    const createdEdges: EdgeData[] = [];
    const createdEdgeIds: string[] = [];
    const edgeOccurrences: FlowchartEdgeOccurrence[] = [];
    const inlineNodeDefs: Record<string, VertexData> = {};

    for (let oi = 0; oi < lineEdges.length; oi++) {
      const dbEdge = lineEdges[oi];
      const edgeKey = `${dbEdge.start}_${dbEdge.end}`;
      const existingCount = this.edgeCounterMap.get(edgeKey) ?? 0;

      let svgId: string;
      let edgeId: string;

      if (dbEdge.isUserDefinedId && dbEdge.id) {
        svgId = dbEdge.id;
        edgeId = dbEdge.id;
      } else {
        edgeId = `edge-${this.edgeIdCounter++}`;
        const counter = existingCount === 0 ? 0 : existingCount + 1;
        svgId = `L_${dbEdge.start}_${dbEdge.end}_${counter}`;
      }
      this.edgeCounterMap.set(edgeKey, existingCount + 1);

      const edgeData: EdgeData = {
        id: edgeId,
        start: dbEdge.start,
        end: dbEdge.end,
        text: dbEdge.text ?? '',
        svgId,
      };

      createdEdges.push(edgeData);
      createdEdgeIds.push(edgeId);

      const occurrenceId = `occ:${statementId}:${oi}`;
      const isAndList = lineEdges.length > 1 && this.lineHasAmpersand(line.trimmed);
      const isChain = this.lineIsChain(line.trimmed);
      const compoundKind: FlowchartEdgeOccurrence['compoundKind'] =
        isChain && isAndList ? 'other' : isChain ? 'chain' : isAndList ? 'and_list' : 'single';

      edgeOccurrences.push({
        occurrenceId,
        id: edgeId,
        svgId,
        start: dbEdge.start,
        end: dbEdge.end,
        position,
        exactPosition: position,
        parentStatementId: statementId,
        parentOriginalIndex: statementOriginalIndex,
        occurrenceIndex: oi,
        compoundKind,
      });

      // Edge element mapping
      const edgeMapping: FlowchartElementMapping = {
        id: edgeId,
        type: 'edge',
        position,
        svgId,
        statementId,
        statementOriginalIndex,
        occurrenceId,
        occurrenceIndex: oi,
        data: edgeData,
      };
      this.elementMappings.push(edgeMapping);
    }

    // Collect inline node defs from vertices DB
    for (const nid of nodeIds) {
      const v = vertices.get(nid);
      if (v && (v.type || (v.text && v.text !== nid))) {
        inlineNodeDefs[nid] = { id: nid, text: v.text, type: v.type as VertexData['type'] };
      }
    }

    // Build the statement
    const firstEdge = createdEdges[0];
    const lastEdge = createdEdges[createdEdges.length - 1];
    const statementEdgeData: EdgeData = firstEdge
      ? {
          id: firstEdge.id,
          start: firstEdge.start,
          end: lastEdge?.end ?? firstEdge.end,
          text: firstEdge.text,
          svgId: firstEdge.svgId,
        }
      : { id: '', start: '', end: '', text: '' };

    const primaryOccurrence = edgeOccurrences[0];
    const primaryEdgeData: EdgeData | undefined = primaryOccurrence
      ? {
          id: primaryOccurrence.id,
          start: primaryOccurrence.start,
          end: primaryOccurrence.end,
          svgId: primaryOccurrence.svgId,
          text: firstEdge?.text,
        }
      : undefined;

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

    const compoundKindSet = new Set(edgeOccurrences.map((o) => o.compoundKind).filter(Boolean));
    const compoundKind =
      compoundKindSet.size === 1
        ? (compoundKindSet.values().next().value ?? 'single')
        : edgeOccurrences.length > 1
          ? 'other'
          : 'single';

    const definedElements: DefinedElements = {
      edgeIds: createdEdgeIds,
      nodeIds: [...new Set(nodeIds)],
      inlineNodeDefs: Object.keys(inlineNodeDefs).length > 0 ? inlineNodeDefs : undefined,
    };

    const statement: FlowchartStatement = {
      type: 'edge',
      originalIndex: this.currentIndex++,
      data: statementEdgeData,
      sourceLine: line.trimmed,
      position,
      statementId,
      edgeOccurrences,
      dataRef,
      primaryEdgeData,
      statementFlags:
        edgeOccurrences.length > 1 ? { dataIsLegacyForCompoundEdges: true } : undefined,
      compound: { kind: compoundKind },
      definedElements,
    };

    // Create vertex reference mappings for each node on this edge line
    // Use the edge data to get ALL node references (including duplicates for chains)
    // This ensures the same count as the ANTLR builder which traverses the parse tree
    const allNodeRefs = this.collectNodeRefsFromEdges(lineEdges);
    for (const nodeId of allNodeRefs) {
      const vertexData: VertexData = { id: nodeId, text: nodeId };
      const vertexMapping: FlowchartElementMapping = {
        id: `vertex-${this.elementMappingCounter++}`,
        type: 'vertex',
        position,
        statementId,
        statementOriginalIndex,
        data: vertexData,
      };
      this.elementMappings.push(vertexMapping);
    }

    return { statement, newEdgeIndex: idx };
  }

  /** Build a standalone vertex statement. */
  private buildVertexStatement(
    line: SourceLine,
    vertices: Map<string, FlowVertex>,
    statementId: string,
    statementOriginalIndex: number
  ): { statement: FlowchartStatement } {
    const position = this.makePosition(line, line);
    const nodeId = this.extractNodeIdFromVertexLine(line.trimmed);
    const v = vertices.get(nodeId);

    const vertexData: VertexData = {
      id: nodeId,
      text: v?.text ?? nodeId,
    };
    if (v?.type) {
      vertexData.type = v.type as VertexData['type'];
    }

    const statement: FlowchartStatement = {
      type: 'vertex',
      originalIndex: this.currentIndex++,
      data: vertexData,
      sourceLine: line.trimmed,
      position,
      statementId,
      definedElements: {
        nodeIds: [nodeId],
        inlineNodeDefs: { [nodeId]: vertexData },
      },
    };

    // Element mapping
    const mapping: FlowchartElementMapping = {
      id: `vertex-${this.elementMappingCounter++}`,
      type: 'vertex',
      position,
      statementId,
      statementOriginalIndex,
      data: vertexData,
    };
    this.elementMappings.push(mapping);

    return { statement };
  }

  /** Build a simple statement (style, classDef, class, click, direction, accTitle, accDescr). */
  private buildSimpleStatement(
    kind: FlowchartStatement['type'],
    line: SourceLine
  ): FlowchartStatement {
    const position = this.makePosition(line, line);
    const statementId = `stmt:${position.startIndex}:${position.endIndex}`;

    let data: FlowchartStatement['data'];
    switch (kind) {
      case 'style':
        data = { id: '', styles: [] } as StyleData;
        break;
      case 'linkStyle':
        data = { indices: [], styles: [] } as LinkStyleData;
        break;
      case 'classDef':
        data = { id: '', styles: [] } as ClassDefData;
        break;
      case 'class':
        data = { ids: [], className: '' } as ClassAssignmentData;
        break;
      case 'click':
        data = { nodeId: '' } as ClickData;
        break;
      case 'direction': {
        const dirMatch = /direction\s+(TB|TD|BT|LR|RL)/.exec(line.trimmed);
        data = { direction: dirMatch?.[1] ?? 'TB' } as DirectionData;
        break;
      }
      case 'accTitle':
        data = { title: line.trimmed.replace(/^accTitle\s*:\s*/, '') } as AccTitleData;
        break;
      case 'accDescr':
        data = { description: line.trimmed.replace(/^accDescr\s*:\s*/, '') } as AccDescrData;
        break;
      default:
        data = {};
    }

    return {
      type: kind,
      originalIndex: this.currentIndex++,
      data,
      sourceLine: line.trimmed,
      position,
      statementId,
    };
  }

  // ─── Position helpers ──────────────────────────────────────────────

  private makePosition(startLine: SourceLine, endLine: SourceLine): ElementPosition {
    return {
      startLine: startLine.lineNumber,
      startColumn: startLine.indent,
      endLine: endLine.lineNumber,
      endColumn: endLine.indent + endLine.trimmed.length,
      startIndex: startLine.startIndex + startLine.indent,
      endIndex: endLine.startIndex + endLine.indent + endLine.trimmed.length - 1,
    };
  }

  private makeStatementMeta(line: SourceLine): { position: ElementPosition; statementId: string } {
    const position = this.makePosition(line, line);
    return { position, statementId: `stmt:${position.startIndex}:${position.endIndex}` };
  }

  // ─── Node extraction helpers ──────────────────────────────────────

  /** Extract node ID from a standalone vertex line like "A[text]" or "A" */
  private extractNodeIdFromVertexLine(text: string): string {
    // Handle @{ shape data } syntax: "A@{ shape: db }" -> "A"
    const atMatch = /^([\w-]+)\s*@{/.exec(text);
    if (atMatch) {
      return atMatch[1];
    }

    // Handle bracket shapes: "A[text]" -> "A", "B(text)" -> "B", etc.
    const bracketMatch = /^([\w-]+)\s*[(<>[{]/.exec(text);
    if (bracketMatch) {
      return bracketMatch[1];
    }

    // Handle double shapes: "A((text))" -> "A"
    const doubleMatch = /^([\w-]+)\s*\(\(/.exec(text);
    if (doubleMatch) {
      return doubleMatch[1];
    }

    // Just a plain ID
    const idMatch = /^([\w-]+)/.exec(text);
    return idMatch ? idMatch[1] : text;
  }

  /** Extract all node IDs from an edge line like "A[Start]--\>B" */
  private extractNodeIdsFromEdgeLine(text: string, vertices: Map<string, FlowVertex>): string[] {
    // Strategy: extract all identifiers that match known vertex IDs in the DB
    const ids: string[] = [];
    // Match identifiers that are potential node IDs (before/after arrows, with/without shapes)
    const tokenRegex = /(?:^|[\s&])([\w-]+)\s*(?:[(<>[{]|@{|-->|==>|---|~~~|\.->|--\||$)/g;
    let match;
    while ((match = tokenRegex.exec(text)) !== null) {
      const candidate = match[1];
      if (candidate && vertices.has(candidate) && !ids.includes(candidate)) {
        ids.push(candidate);
      }
    }
    // Fallback: if we didn't find any, try a broader approach
    if (ids.length === 0) {
      for (const [vid] of vertices) {
        if (text.includes(vid) && !ids.includes(vid)) {
          // Make sure it's a whole word match
          // eslint-disable-next-line unicorn/better-regex
          const escaped = vid.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const wordRe = new RegExp(String.raw`\b${escaped}\b`);
          if (wordRe.test(text)) {
            ids.push(vid);
          }
        }
      }
    }
    return ids;
  }

  // ─── Edge counting helpers ──────────────────────────────────────

  /** Count how many arrows appear on a line (for chain detection). */
  private countArrowsOnLine(text: string): number {
    // Match arrow patterns: -->, ===>, -.->, ~~~, etc.

    const arrows = text.match(/--+>|==+>|-\.+->|~~~|<--+>|<-\.+->|--+\||x--+|o--+|--+x|--+o/g);
    return arrows ? arrows.length : 0;
  }

  /** Count expected edges for a line, considering ampersand groups and chains. */
  private countEdgesOnLine(text: string, _nodeIds: string[]): number {
    const arrowCount = this.countArrowsOnLine(text);
    if (arrowCount === 0) {
      return 0;
    }

    // For chains like A --> B --> C: arrowCount = 2
    // For ampersand like A & B --> C & D: arrowCount = 1, but edges = sourceCount * targetCount
    // We need to figure out source/target groups per arrow

    if (arrowCount === 1 && this.lineHasAmpersand(text)) {
      // Split by the arrow to get source and target sides
      const parts = text.split(/--+>|==+>|-\.+->|~~~|<--+>|<-\.+->/).map((s) => s.trim());
      if (parts.length === 2) {
        const sourceCount = (parts[0].match(/&/g)?.length ?? 0) + 1;
        const targetCount = (parts[1].match(/&/g)?.length ?? 0) + 1;
        return sourceCount * targetCount;
      }
    }

    if (arrowCount > 1) {
      // Chain: each arrow produces edges based on ampersand groups at each step
      // For simplicity, split by arrows and count
      const segments = text.split(/--+>|==+>|-\.+->|~~~|<--+>|<-\.+->/);
      let total = 0;
      for (let i = 0; i < segments.length - 1; i++) {
        const srcCount = (segments[i].match(/&/g)?.length ?? 0) + 1;
        const tgtCount = (segments[i + 1].match(/&/g)?.length ?? 0) + 1;
        total += srcCount * tgtCount;
      }
      return total > 0 ? total : arrowCount;
    }

    return arrowCount;
  }

  private lineHasAmpersand(text: string): boolean {
    return /\s+&\s+/.test(text);
  }

  private lineIsChain(text: string): boolean {
    return this.countArrowsOnLine(text) > 1;
  }

  /**
   * Collect ALL node references (including duplicates) from a set of edges.
   * For chain "A--\>B--\>C" with edges [start:A end:B, start:B end:C],
   * produces [A, B, C]. This matches the ANTLR builder's parse-tree traversal order.
   */
  private collectNodeRefsFromEdges(edges: FlowEdge[]): string[] {
    if (edges.length === 0) {
      return [];
    }

    // For a chain A-->B-->C, the edges are [{start:A, end:B}, {start:B, end:C}]
    // The ANTLR builder collects all nodes in order from the parse tree: [A, B, C]
    // So: first edge's start, then each edge's end
    const refs: string[] = [];
    const seen = new Set<string>();

    // Add first edge's start
    if (edges[0].start && !seen.has(edges[0].start)) {
      refs.push(edges[0].start);
      seen.add(edges[0].start);
    }

    // For each edge, add the end (and any ampersand-expanded starts not yet seen)
    for (const edge of edges) {
      if (edge.start && !seen.has(edge.start)) {
        refs.push(edge.start);
        seen.add(edge.start);
      }
      if (edge.end && !seen.has(edge.end)) {
        refs.push(edge.end);
        seen.add(edge.end);
      }
    }

    return refs;
  }

  // ─── Subgraph helpers ──────────────────────────────────────────

  /** Parse subgraph header line to extract ID and title. */
  private parseSubgraphHeader(
    text: string,
    subGraphs: FlowSubGraph[]
  ): { id: string; title: string } {
    // "subgraph id [title]" or "subgraph id" or "subgraph"
    const withBrackets = /^subgraph\s+([\w-]+)\s*\[(.+?)]/.exec(text);
    if (withBrackets) {
      let title = withBrackets[2].trim();
      if (
        (title.startsWith('"') && title.endsWith('"')) ||
        (title.startsWith("'") && title.endsWith("'"))
      ) {
        title = title.slice(1, -1);
      }
      return { id: withBrackets[1], title };
    }

    const withId = /^subgraph\s+(\S+)/.exec(text);
    if (withId) {
      let idCandidate = withId[1];

      // Strip surrounding quotes if present (e.g. subgraph "Ash" → Ash)
      // FlowDB.addSubGraph sanitizes the text and strips quotes,
      // so the DB ID is the unquoted version.
      if (
        (idCandidate.startsWith('"') && idCandidate.endsWith('"')) ||
        (idCandidate.startsWith("'") && idCandidate.endsWith("'"))
      ) {
        idCandidate = idCandidate.slice(1, -1);
      }

      // Strip surrounding backticks if present (markdown string syntax)
      // e.g. subgraph "`**Two**`" → after quote strip: `**Two**` → after backtick strip: **Two**
      // FlowDB.sanitizeText also strips backticks.
      if (idCandidate.startsWith('`') && idCandidate.endsWith('`')) {
        idCandidate = idCandidate.slice(1, -1);
      }

      // Check if the DB has a subgraph matching this
      const dbMatch = subGraphs.find((sg) => sg.id === idCandidate);
      if (dbMatch) {
        return { id: dbMatch.id, title: dbMatch.title };
      }
      return { id: idCandidate, title: idCandidate };
    }

    // Bare "subgraph" – auto-generate ID
    const autoId = `subGraph${this.currentIndex}`;
    return { id: autoId, title: '' };
  }

  // ─── Metadata rebuild ──────────────────────────────────────────

  private rebuildMetadata(
    ast: FlowchartAST,
    vertices: Map<string, FlowVertex>,
    edges: FlowEdge[],
    subGraphs: FlowSubGraph[]
  ): void {
    if (!ast.metadata) {
      return;
    }

    // Nodes
    const nodes: Record<string, VertexData> = Object.create(null);
    for (const [id, v] of vertices) {
      nodes[id] = { id, text: v.text ?? id };
      if (v.type) {
        nodes[id].type = v.type as VertexData['type'];
      }
    }
    ast.metadata.nodes = nodes;

    // Edges
    ast.metadata.edges = edges.map((e) => ({
      id: e.id,
      start: e.start,
      end: e.end,
      type: e.type,
      text: e.text,
      stroke: e.stroke,
      length: e.length,
      interpolate: e.interpolate,
      isUserDefinedId: e.isUserDefinedId,
      labelType: e.labelType ?? 'text',
      classes: e.classes ?? [],
    }));

    // Subgraphs
    const subgraphMap = new Map<string, SubgraphData>();
    for (const sg of subGraphs) {
      subgraphMap.set(sg.id, { id: sg.id, title: sg.title, statements: [] });
    }
    ast.metadata.subgraphs = subgraphMap;
  }
}
