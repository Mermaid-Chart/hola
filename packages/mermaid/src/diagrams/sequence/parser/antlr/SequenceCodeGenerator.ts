import type { SequenceParserVisitor } from './generated/SequenceParserVisitor.js';
import type {
  SequenceAST,
  ParticipantData,
  MessageData,
  NoteData,
  ElementMapping,
  ElementPosition,
} from './SequenceAST.js';
import { SequenceStatement, SequenceASTHelper } from './SequenceAST.js';
import { ElementMappingUtils } from './SequenceElementMapper.js';

/**
 * AST-to-Code Generator for Sequence Diagrams
 *
 * This visitor traverses the ANTLR parse tree and reconstructs the original
 * sequence diagram code with proper line numbers and formatting.
 *
 * Main objective: Enable UI editing of rendered diagrams with AST updates
 * that can be regenerated back to code.
 *
 * Now also builds a structured AST for the hybrid editor approach.
 */
export class SequenceCodeGenerator implements SequenceParserVisitor<string> {
  private lines: string[] = [];
  private currentIndent = 0;
  private indentSize = 2;

  // For preserving exact original segments and semicolon-joined lines
  private currentSourceLineNumber: number | null = null;
  private currentJoinedLineText = '';
  private lineSeparator = ';';
  private lastPhysicalLineEmitted = 0;

  // AST building properties
  private ast: SequenceAST;
  private currentIndex = 0;

  // Position tracking for bidirectional synchronization
  private originalText = '';
  private elementMappings: ElementMapping[] = [];
  private svgIdCounter = 0;
  private currentLine = 1;
  private currentColumn = 1;
  private currentCharIndex = 0;
  // Track the actual rendered message index (accounts for activation/deactivation messages)
  private renderedMessageIndex = 0;

  constructor(originalText?: string) {
    // Initialize with empty lines array
    this.lines = [];
    // Initialize AST
    this.ast = SequenceASTHelper.createEmpty();
    this.currentIndex = 0;

    // Store original text for position tracking
    this.originalText = originalText || '';
    this.elementMappings = [];
    this.svgIdCounter = 0;
    this.resetPositionTracking();
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
  generateCode(tree: any): { code: string; lines: string[]; ast: SequenceAST } {
    this.lines = [];
    this.currentIndent = 0;
    this.ast = SequenceASTHelper.createEmpty();
    this.currentIndex = 0;
    this.elementMappings = [];
    this.svgIdCounter = 0;
    this.resetPositionTracking();

    console.log('🎯 Starting code generation with AST building and position tracking');
    try {
      console.log('🔎 Root ctx type:', tree?.constructor?.name);
    } catch {}

    // Visit the tree to generate code and build AST
    this.visit(tree);

    // Join lines and return both full code, line array, and AST
    const code = this.lines.join('\n');

    // Add element mappings to AST
    this.ast.elementMappings = [...this.elementMappings];

    // Attach bidirectional synchronization methods to AST
    this.attachSyncMethodsToAST();

    console.log('✅ Code generation complete:', {
      lines: this.lines.length,
      statements: this.ast.statements.length,
      mappings: this.elementMappings.length,
    });

    return {
      code,
      lines: [...this.lines], // Return copy of lines array
      ast: this.ast, // Return the built AST with mappings
    };
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

    const sortedByIndex = [...mappings].sort(
      (a, b) => a.position.startIndex - b.position.startIndex
    );

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

      // If multiple matches, return the most specific (smallest) element
      // This prioritizes messages/notes inside control structures over the control structure itself
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

    this.ast.getElementByDataId = (dataId: string) => {
      // For participants, data-id is the participant id
      // First, look for explicit participant declarations (without 'role' property)
      for (const mapping of mappings) {
        if (
          mapping.type === 'participant' &&
          'id' in mapping.data &&
          mapping.data.id === dataId &&
          !('role' in mapping.data)
        ) {
          return mapping;
        }
      }

      // If no explicit declaration found, look for implicit participant references in messages
      // (these have 'role' property set to 'from' or 'to')
      for (const mapping of mappings) {
        if (mapping.type === 'participant' && 'id' in mapping.data && mapping.data.id === dataId) {
          return mapping;
        }
      }

      // For messages and notes, data-id is 'i' + index (i0, i1, i2, etc.)
      // The index is shared across messages and notes in order of appearance
      if (dataId.startsWith('i')) {
        const requestedIndex = parseInt(dataId.substring(1), 10);

        // Count messages and notes together in order of appearance
        let currentIndex = 0;

        for (const mapping of mappings) {
          if (mapping.type === 'message' || mapping.type === 'note') {
            if (currentIndex === requestedIndex) {
              return mapping;
            }
            currentIndex++;
          }
        }
      }

      return undefined;
    };

    this.ast.getElementById = (id: string) => idMap.get(id);

    this.ast.getElementAtIndex = (index: number) => {
      return sortedByIndex.find(
        (m) => index >= m.position.startIndex && index <= m.position.endIndex
      );
    };

    this.ast.getParticipants = () => mappings.filter((m) => m.type === 'participant');

    this.ast.getMessages = () => mappings.filter((m) => m.type === 'message');

    this.ast.getNotes = () => mappings.filter((m) => m.type === 'note');

    this.ast.getControlStructures = () =>
      mappings.filter((m) =>
        ['loop', 'alt', 'opt', 'par', 'rect', 'break', 'critical', 'controlStructure'].includes(
          m.type
        )
      );

    this.ast.getStats = () => {
      const participants = mappings.filter((m) => m.type === 'participant').length;
      const messages = mappings.filter((m) => m.type === 'message').length;
      const notes = mappings.filter((m) => m.type === 'note').length;
      const controlStructures = mappings.filter((m) =>
        ['loop', 'alt', 'opt', 'par', 'rect', 'break', 'critical', 'controlStructure'].includes(
          m.type
        )
      ).length;

      return {
        participants,
        messages,
        notes,
        controlStructures,
        totalElements: mappings.length,
      };
    };
  }

  /**
   * Get the current AST (for external access)
   */
  getAST(): SequenceAST {
    return this.ast;
  }

  /**
   * Add a line with current indentation
   */
  private addLine(text: string): void {
    const indent = ' '.repeat(this.currentIndent);
    this.lines.push(indent + text);
  }

  /**
   * Add a line using indentation inferred from the original source position (ctx.start.column)
   * Falls back to currentIndent when no context is available.
   */
  private addLineWithCtxIndent(text: string, ctx?: any): void {
    const extra = ctx?.start?.column ?? 0;
    const indent = ' '.repeat(this.currentIndent + extra);
    this.lines.push(indent + text);
  }

  /**
   * Add a line without indentation
   */
  private addRawLine(text: string): void {
    this.lines.push(text);
  }

  /** Add an original source line by line number and update lastPhysicalLineEmitted */
  private addOriginalLine(lineNumber: number): void {
    this.addRawLine(this.getOriginalLine(lineNumber));
    this.lastPhysicalLineEmitted = lineNumber;
  }

  /**
   * Increase indentation level
   */
  private indent(): void {
    this.currentIndent += this.indentSize;
  }

  /**
   * Decrease indentation level
   */
  private unindent(): void {
    this.currentIndent = Math.max(0, this.currentIndent - this.indentSize);
  }

  /**
   * Get the exact original line text from the input, 1-based line number.
   * Used to faithfully reproduce lines like "box ..." and "end" with
   * original spacing and labels.
   */
  private getOriginalLine(lineNumber: number): string {
    if (!this.originalText) {
      return '';
    }
    const lines = this.originalText.replace(/\r\n?/g, '\n').split('\n');
    return lines[lineNumber - 1] ?? '';
  }

  /**
   * Emit a segment of original source that belongs to a single logical statement on a single line.
   * Supports semicolon-joined lines by appending with ';' when multiple segments share the same source line.
   */
  private emitOriginalSegmentFromCtx(ctx: any): void {
    if (!ctx?.start || !ctx?.stop || !this.originalText) {
      const txt = this.getContextText(ctx);
      this.addLineWithCtxIndent(txt, ctx);
      return;
    }
    const startLine = ctx.start.line;
    const endLine = ctx.stop.line;

    // If the context spans multiple lines, flush any joined buffer and emit exact original lines
    if (startLine !== endLine) {
      this.flushJoinedLine();
      for (let ln = startLine; ln <= endLine; ln++) {
        this.addOriginalLine(ln);
      }
      return;
    }

    const startIdx = ctx.start.start;
    const stopIdx = ctx.stop.stop;
    let segment = this.originalText.slice(startIdx, stopIdx + 1);

    if (this.currentSourceLineNumber === startLine) {
      // Continue same physical line: join with ';'
      this.currentJoinedLineText += this.lineSeparator + segment;
    } else {
      // Start a new physical line; flush previous first
      this.flushJoinedLine();

      // Emit any intervening blank lines from the source
      for (let ln = this.lastPhysicalLineEmitted + 1; ln < startLine; ln++) {
        const lineTextBetween = this.getOriginalLine(ln);
        if (lineTextBetween.trim() === '') {
          this.addOriginalLine(ln);
        }
      }

      // Prepend original leading indentation for the first segment on the line
      try {
        const lineText = this.getOriginalLine(startLine);
        const leading = lineText.slice(0, ctx.start.column ?? 0);
        segment = leading + segment;
      } catch {
        // ignore
      }
      this.currentSourceLineNumber = startLine;
      this.currentJoinedLineText = segment;
    }
  }

  /** Flush any pending semicolon-joined line into the output */
  private flushJoinedLine(): void {
    if (this.currentSourceLineNumber !== null) {
      // If the original line ends with a semicolon, mirror that in output
      const origLine = this.getOriginalLine(this.currentSourceLineNumber);
      let out = this.currentJoinedLineText;
      if (origLine && origLine.trim().endsWith(';') && !out.trim().endsWith(';')) {
        out += ';';
      }
      this.lines.push(out);
      this.lastPhysicalLineEmitted = this.currentSourceLineNumber;
      this.currentSourceLineNumber = null;
      this.currentJoinedLineText = '';
    }
  }

  /**
   * Track position from ANTLR context
   */
  private getPositionFromContext(ctx: any): ElementPosition | null {
    if (!ctx?.start || !ctx.stop) {
      return null;
    }

    const startLine = ctx.start.line;
    const startColumn = ctx.start.column;
    const endLine = ctx.stop.line;
    const endColumn = ctx.stop.column + (ctx.stop.text?.length || 1);
    const startIndex = ctx.start.start;
    const endIndex = ctx.stop.stop;

    return ElementMappingUtils.createPosition(
      startLine,
      startColumn,
      endLine,
      endColumn,
      startIndex,
      endIndex
    );
  }

  /**
   * Create element mapping for bidirectional synchronization
   */
  private createElementMapping(type: string, ctx: any, data: any): ElementMapping | null {
    console.log('🔧 createElementMapping called:', { type, hasCtx: !!ctx, data });

    const position = this.getPositionFromContext(ctx);
    console.log('🔧 Position from context:', position);

    if (!position) {
      console.warn('⚠️ No position from context, skipping element mapping');
      return null;
    }

    const elementId = ElementMappingUtils.generateElementId(type, this.currentIndex++);
    const svgId = ElementMappingUtils.generateSvgId(elementId);

    // Generate SVG selector based on data-et attribute (used by sequence renderer)
    // For participants: [data-et="participant"][data-id="participantId"]
    // For messages: [data-et="message"][data-id="i0"]
    // For notes: [data-et="note"][data-id="i0"]
    let svgSelector = `[data-et="${type}"]`;

    // Add data-id for more specific selection
    if (type === 'participant' && 'id' in data) {
      svgSelector = `[data-et="participant"][data-id="${data.id}"]`;
    } else if (type === 'message' || type === 'note') {
      // Messages and notes share the same index counter (i0, i1, i2, etc.)
      // Count how many messages and notes we already have
      const index = this.elementMappings.filter(
        (m) => m.type === 'message' || m.type === 'note'
      ).length;
      svgSelector = `[data-et="${type}"][data-id="i${index}"]`;
    }

    const mapping: ElementMapping = {
      id: elementId,
      type: type as any,
      position,
      svgId,
      svgSelector,
      data,
    };

    console.log('✅ Created element mapping:', mapping);
    this.elementMappings.push(mapping);
    console.log('📊 Total mappings now:', this.elementMappings.length);
    return mapping;
  }

  /**
   * Create fine-grained element mappings for message components
   * This allows highlighting specific parts: from participant, to participant, or message text
   */
  private createFineGrainedMessageMappings(
    ctx: any,
    from: string,
    arrow: string,
    to: string,
    message: string,
    messageData: MessageData
  ): void {
    const basePosition = this.getPositionFromContext(ctx);
    if (!basePosition) {
      console.warn('⚠️ No position from context, skipping fine-grained mappings');
      return;
    }

    // Use the renderedMessageIndex which accounts for activation/deactivation messages
    const messageIndex = this.renderedMessageIndex;

    // Check if this message has an activation or deactivation marker
    // Note: We need to check for '+' or '-' at the END of the arrow, not just anywhere in it
    // because arrows like '->>' and '-->>' contain dashes but are not activation markers
    const hasActivationMarker = arrow.endsWith('+') || arrow.endsWith('-');

    console.log(
      `📊 [MessageIndex] Line ${basePosition.startLine}: arrow="${arrow}", hasActivationMarker=${hasActivationMarker}, messageIndex=${messageIndex}`
    );

    // Increment the rendered message index
    // If there's an activation marker, the DB creates 2 messages (the message + activation/deactivation)
    // So we increment by 2, otherwise by 1
    this.renderedMessageIndex += hasActivationMarker ? 2 : 1;

    console.log(
      `📊 [MessageIndex] After increment: renderedMessageIndex=${this.renderedMessageIndex}`
    );

    // Calculate positions for each component
    // Format: "Alice->>+John: Hello John, how are you?"
    const startCol = basePosition.startColumn;
    const startIdx = basePosition.startIndex;
    const line = basePosition.startLine;

    // 1. From participant (e.g., "Alice")
    const fromEndCol = startCol + from.length;
    const fromEndIdx = startIdx + from.length;
    const fromMapping: ElementMapping = {
      id: ElementMappingUtils.generateElementId('participant', this.currentIndex++),
      type: 'participant',
      position: {
        startLine: line,
        startColumn: startCol,
        endLine: line,
        endColumn: fromEndCol,
        startIndex: startIdx,
        endIndex: fromEndIdx,
      },
      svgId: ElementMappingUtils.generateSvgId(`participant_${from}`),
      svgSelector: `[data-et="participant"][data-id="${from}"]`,
      data: { id: from, role: 'from' },
    };
    this.elementMappings.push(fromMapping);
    console.log('✅ Created FROM participant mapping:', fromMapping);

    // 2. To participant (e.g., "John")
    const toStartCol = fromEndCol + arrow.length;
    const toStartIdx = fromEndIdx + arrow.length;
    const toEndCol = toStartCol + to.length;
    const toEndIdx = toStartIdx + to.length;
    const toMapping: ElementMapping = {
      id: ElementMappingUtils.generateElementId('participant', this.currentIndex++),
      type: 'participant',
      position: {
        startLine: line,
        startColumn: toStartCol,
        endLine: line,
        endColumn: toEndCol,
        startIndex: toStartIdx,
        endIndex: toEndIdx,
      },
      svgId: ElementMappingUtils.generateSvgId(`participant_${to}`),
      svgSelector: `[data-et="participant"][data-id="${to}"]`,
      data: { id: to, role: 'to' },
    };
    this.elementMappings.push(toMapping);
    console.log('✅ Created TO participant mapping:', toMapping);

    // 3. Message text (after the colon and space)
    const colonPos = toEndCol + 1; // +1 for the colon
    const messageStartCol = colonPos + 1; // +1 for the space after colon
    const messageStartIdx = toEndIdx + 2; // +2 for ": "
    const messageEndCol = messageStartCol + message.length;
    const messageEndIdx = messageStartIdx + message.length;
    const messageMapping: ElementMapping = {
      id: ElementMappingUtils.generateElementId('message', this.currentIndex++),
      type: 'message',
      position: {
        startLine: line,
        startColumn: messageStartCol,
        endLine: line,
        endColumn: messageEndCol,
        startIndex: messageStartIdx,
        endIndex: messageEndIdx,
      },
      svgId: ElementMappingUtils.generateSvgId(`message_${messageIndex}`),
      svgSelector: `[data-et="message"][data-id="i${messageIndex}"]`,
      data: messageData,
    };
    this.elementMappings.push(messageMapping);
    console.log('✅ Created MESSAGE text mapping:', messageMapping);

    console.log('📊 Total mappings now:', this.elementMappings.length);
  }

  /**
   * Generate next SVG ID
   */
  private generateSvgId(): string {
    return `seq_element_${this.svgIdCounter++}`;
  }

  /**
   * Extract text from terminal nodes
   */
  private getTerminalText(ctx: any): string {
    if (!ctx) {
      return '';
    }

    // If it's a terminal node, return its text
    if (ctx.symbol?.text) {
      return ctx.symbol.text;
    }

    // If it has children, collect text from all terminal children
    if (ctx.children) {
      return ctx.children
        .map((child: any) => this.getTerminalText(child))
        .filter((text: string) => text.trim() !== '')
        .join(' ');
    }

    return '';
  }

  /**
   * Get text content from a context, handling both terminal and non-terminal nodes
   */
  private getContextText(ctx: any): string {
    if (!ctx) {
      return '';
    }

    // Use ANTLR's built-in getText() method which is most reliable
    if (ctx.getText) {
      return ctx.getText();
    }

    return this.getTerminalText(ctx);
  }

  /**
   * Simple approach: extract all text from the parse tree and reconstruct line by line
   * This is more reliable than trying to handle each rule type individually
   */
  private extractAllText(ctx: any): string[] {
    const lines: string[] = [];

    if (!ctx) {
      return lines;
    }

    // Get the full text content
    const fullText = ctx.getText ? ctx.getText() : '';

    if (fullText) {
      // Split by common sequence diagram patterns and clean up
      const rawLines = fullText.split(/\n+/);

      for (const line of rawLines) {
        const trimmed = line.trim();
        if (trimmed && trimmed !== 'sequenceDiagram') {
          lines.push(trimmed);
        }
      }
    }

    return lines;
  }

  // Default visit method
  visit(tree: any): string {
    if (!tree) {
      return '';
    }

    try {
      return tree.accept(this) || '';
    } catch (error) {
      console.error('Error visiting node:', error);
      return '';
    }
  }

  // Default visit methods
  visitChildren(node: any): string {
    if (!node?.children) {
      return '';
    }

    const results: string[] = [];
    for (const child of node.children) {
      const result = child.accept(this);
      if (result) {
        results.push(result);
      }
    }
    return results.join(' ');
  }

  visitTerminal(node: any): string {
    return node.symbol?.text || '';
  }

  visitErrorNode(_node: any): string {
    return '';
  }

  // Start rule - the root of the parse tree
  visitStart(ctx: any): string {
    // Proper visitor approach: use the AST structure
    console.log('🎯 visitStart: Starting AST traversal');

    // 1) Emit any header lines verbatim before sequenceDiagram, then seed the semicolon-join buffer
    try {
      const sdNode = ctx.SD?.();
      const sdTok = sdNode?.symbol ?? sdNode;
      let sdLine: number = sdTok?.line ?? 1;
      const sdText: string = sdTok?.text ?? 'sequenceDiagram';

      // Fallback: detect the actual SD line from original text if token line seems wrong
      try {
        const total = this.originalText
          ? this.originalText.replace(/\r\n?/g, '\n').split('\n').length
          : 0;
        if (total > 0) {
          for (let ln = 1; ln <= total; ln++) {
            const lt = this.getOriginalLine(ln);
            if (lt.includes('sequenceDiagram')) {
              sdLine = ln;
              break;
            }
          }
        }
      } catch {}

      // Emit header lines (1..sdLine-1) exactly as in the source
      if (sdLine > 1) {
        for (let ln = 1; ln < sdLine; ln++) {
          this.flushJoinedLine();
          this.addOriginalLine(ln);
        }
      }

      // Seed buffer with original indentation + token text
      const lineText = this.getOriginalLine(sdLine);
      const leading = lineText.slice(0, sdTok?.column ?? 0);
      this.flushJoinedLine();
      this.currentSourceLineNumber = sdLine;
      const sdSafeText = sdText && sdText.startsWith('<missing') ? 'sequenceDiagram' : sdText;
      this.currentJoinedLineText = leading + sdSafeText;
      // If the original SD line does not contain a semicolon, flush immediately so SD appears before following lines
      if (!lineText.includes(';')) {
        this.flushJoinedLine();
      }
      // Preserve wrap directive line immediately after SD if present and not captured by the parser
      const maybeWrap = this.getOriginalLine(sdLine + 1);
      if (maybeWrap && maybeWrap.trim() === '%%{wrap}%%') {
        this.addOriginalLine(sdLine + 1);
      }
    } catch {
      // Fallback: put bare sequenceDiagram at top
      this.flushJoinedLine();
      this.addRawLine('sequenceDiagram');
    }

    // 3) Visit the document (statements and blocks)
    if (ctx.document?.()) {
      this.visit(ctx.document());
    }

    // 4) Flush any pending semicolon-joined line
    this.flushJoinedLine();
    return '';
  }

  // Header - handle front matter, comments, etc.
  visitHeader(_ctx: any): string {
    // Header lines are emitted in visitStart from the original source.
    // Do nothing here to avoid duplication.
    return '';
  }

  // Document - main content
  visitDocument(ctx: any): string {
    if (ctx?.children && Array.isArray(ctx.children)) {
      const kids = [...ctx.children];
      kids.sort((a: any, b: any) => {
        const la = a?.start?.line ?? 0;
        const lb = b?.start?.line ?? 0;
        if (la !== lb) {
          return la - lb;
        }
        const ia = a?.start?.start ?? 0;
        const ib = b?.start?.start ?? 0;
        return ia - ib;
      });
      for (const child of kids) {
        child.accept(this);
      }
    } else {
      this.visitChildren(ctx);
    }
    return '';
  }

  // Line - individual lines in the document
  visitLine(ctx: any): string {
    this.visitChildren(ctx);
    return '';
  }
  // Comment statement (%% ...)
  visitCommentStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Statement - individual statements
  visitStatement(ctx: any): string {
    this.visitChildren(ctx);
    return '';
  }

  // Participant statement
  visitParticipantStatement(ctx: any): string {
    console.log('🎯 visitParticipantStatement:', ctx);

    // Prefer structured reconstruction using tokens/children to preserve whitespace semantics
    try {
      const hasActor = !!(
        ctx.PARTICIPANT_ACTOR &&
        typeof ctx.PARTICIPANT_ACTOR === 'function' &&
        ctx.PARTICIPANT_ACTOR()
      );
      const hasParticipant = !!(
        ctx.PARTICIPANT &&
        typeof ctx.PARTICIPANT === 'function' &&
        ctx.PARTICIPANT()
      );
      // Determine keyword to build AST, output uses original segment
      const keyword = hasActor ? 'actor' : 'participant';

      const actorCtx = typeof ctx.actor === 'function' ? (ctx.actor(0) ?? ctx.actor()) : undefined;
      const id = actorCtx ? this.getContextText(actorCtx).trim() : '';

      let alias = '';
      const hasAS = !!(ctx.AS && typeof ctx.AS === 'function' && ctx.AS());
      if (hasAS && ctx.restOfLine && typeof ctx.restOfLine === 'function' && ctx.restOfLine()) {
        // For aliases, the grammar uses: (AS restOfLine)?
        // restOfLine should already be the alias text without a leading colon
        alias = this.getContextText(ctx.restOfLine()).trim();
      }

      if ((hasActor || hasParticipant) && id) {
        // Emit exact original text segment for output (preserves spaces and inline config)
        this.emitOriginalSegmentFromCtx(ctx);

        // Build AST entry
        const participantData: ParticipantData = { id, alias: alias || undefined };
        this.ast.statements.push({
          type: 'participant',
          originalIndex: this.currentIndex,
          data: participantData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
        });

        // Create element mapping for bidirectional synchronization
        this.createElementMapping('participant', ctx, participantData);
        console.log('📝 Added participant to AST:', participantData);
        return '';
      }
    } catch (e) {
      console.warn('visitParticipantStatement fallback path due to error:', e);
    }

    // Fallback: emit the exact original segment to preserve spaces/config
    const fullText = ctx.getText ? ctx.getText() : '';
    console.log('  - Full participant text (fallback):', fullText);
    if (fullText) {
      this.emitOriginalSegmentFromCtx(ctx);
    }

    return '';
  }

  // Create statement
  visitCreateStatement(ctx: any): string {
    console.log('🎯 visitCreateStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Destroy statement
  visitDestroyStatement(ctx: any): string {
    console.log('🎯 visitDestroyStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Signal statement (messages between participants)
  visitSignalStatement(ctx: any): string {
    console.log('🎯 visitSignalStatement:', ctx);

    // Use the simpler approach: get the full text and clean it up
    const fullText = ctx.getText ? ctx.getText() : '';
    console.log('  - Full signal text:', fullText);

    if (fullText) {
      // Parse the signal pattern: from + arrow + to + : + message
      // Updated regex to handle activation/deactivation markers (+ and -)
      const signalMatch = fullText.match(/^(\w+)(->|-->>|->>|-->)([+-]?)(\w+):(.+)$/);
      console.log('  - Regex match result:', signalMatch);

      if (signalMatch) {
        const [, from, arrow, activationMarker, to, message] = signalMatch;
        const cleanMessage = message.trim();
        const fullArrow = arrow + activationMarker;
        // Emit exact original text (preserves spaces and colon spacing)
        this.emitOriginalSegmentFromCtx(ctx);

        // Build AST entry
        const messageData: MessageData = { from, arrow: fullArrow, to, message: cleanMessage };
        this.ast.statements.push({
          type: 'message',
          originalIndex: this.currentIndex,
          data: messageData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
        });

        // Create fine-grained element mappings for each component
        console.log('  - Creating fine-grained element mappings');
        this.createFineGrainedMessageMappings(ctx, from, fullArrow, to, cleanMessage, messageData);

        console.log('📝 Added message to AST:', messageData);
      } else {
        console.warn('  - ⚠️ Regex did not match, using fallback');
        // Fallback: emit the exact original segment so ordering and semicolons are preserved
        this.emitOriginalSegmentFromCtx(ctx);
      }
    }

    return '';
  }

  // Note statement
  visitNoteStatement(ctx: any): string {
    // Emit exact original segment for output
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST mapping info using a permissive regex on ctx.getText
    const fullText = ctx.getText ? ctx.getText() : '';
    if (fullText) {
      const noteMatch = fullText.match(/^note\s*(left|right|over)\s*of\s*(\w+)\s*:\s*(.+)$/i);
      if (noteMatch) {
        const [, position, participant, message] = noteMatch;
        const noteData: NoteData = {
          position: position as 'left' | 'right' | 'over',
          participant,
          message: message.trim(),
        };
        this.ast.statements.push({
          type: 'note',
          originalIndex: this.currentIndex,
          data: noteData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
        });
        this.createElementMapping('note', ctx, noteData);
      }
    }

    return '';
  }

  // Loop block
  visitLoopBlock(ctx: any): string {
    // Emit the entire loop block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Opt block
  visitOptBlock(ctx: any): string {
    // Emit the entire opt block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Alt block
  visitAltBlock(ctx: any): string {
    // Emit the entire alt block exactly as in the source (including else sections)
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Else section within alt block
  visitElseSection(_ctx: any): string {
    // Handled by parent alt block emission
    return '';
  }

  // Par block
  visitParBlock(ctx: any): string {
    // Emit the entire par block exactly as in the source (including 'and' sections)
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // And section within par block
  visitAndSection(_ctx: any): string {
    // Handled by parent par block emission
    return '';
  }

  // Rect block
  visitRectBlock(ctx: any): string {
    // Emit the entire rect block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Box block
  visitBoxBlock(ctx: any): string {
    // Emit the entire box block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Break block
  visitBreakBlock(ctx: any): string {
    // Emit the entire break block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Critical block
  visitCriticalBlock(ctx: any): string {
    // Emit the entire critical block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Option section within critical block
  visitOptionSection(_ctx: any): string {
    // Handled by parent critical block emission
    return '';
  }

  // ParOver block
  visitParOverBlock(ctx: any): string {
    // Emit the entire par_over block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start.line; ln <= ctx.stop.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Links statement
  visitLinksStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Link statement
  visitLinkStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Properties statement
  visitPropertiesStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Details statement
  visitDetailsStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Activation statement (activate/deactivate)
  visitActivationStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Autonumber statement
  visitAutonumberStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Title statement
  visitTitleStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Legacy title statement
  visitLegacyTitleStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Accessibility title statement
  visitAccTitleStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Accessibility description statement
  visitAccDescrStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Accessibility multiline description statement
  visitAccDescrMultilineStatement(ctx: any): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Additional visitor methods for completeness
  visitActorWithConfig(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitConfigObject(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitSignaltype(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitText2(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitRestOfLine(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitAltSections(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitParSections(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitOptionSections(ctx: any): string {
    return this.visitChildren(ctx);
  }

  visitActor(ctx: any): string {
    return this.visitChildren(ctx);
  }
}
