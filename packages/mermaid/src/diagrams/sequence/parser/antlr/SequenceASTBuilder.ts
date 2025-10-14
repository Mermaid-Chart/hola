import { SequenceParserVisitor } from './generated/SequenceParserVisitor.js';
import type {
  StartContext,
  HeaderContext,
  DocumentContext,
  LineContext,
  StatementContext,
  CommentStatementContext,
  CreateStatementContext,
  DestroyStatementContext,
  ParticipantStatementContext,
  SignalStatementContext,
  NoteStatementContext,
  LinksStatementContext,
  LinkStatementContext,
  PropertiesStatementContext,
  DetailsStatementContext,
  AutonumberStatementContext,
  ActivationStatementContext,
  TitleStatementContext,
  AccTitleStatementContext,
  AccDescrStatementContext,
  AccDescrMultilineStatementContext,
  LegacyTitleStatementContext,
  LoopBlockContext,
  RectBlockContext,
  BoxBlockContext,
  OptBlockContext,
  AltBlockContext,
  ParBlockContext,
  ParOverBlockContext,
  AltSectionsContext,
  ElseSectionContext,
  ParSectionsContext,
  AndSectionContext,
  OptionSectionsContext,
  OptionSectionContext,
  ActorWithConfigContext,
  ConfigObjectContext,
  SignaltypeContext,
  RestOfLineContext,
  Text2Context,
  ActorContext,
} from './generated/SequenceParser.js';
import type { ParserRuleContext, TerminalNode, ParseTree, ErrorNode } from 'antlr4ng';

import type {
  SequenceAST,
  ParticipantData,
  MessageData,
  NoteData,
  ElementMapping,
  ElementPosition,
  SequenceStatement,
  SequenceStatementType,
} from '../../types.ts';

import { ElementMappingUtils } from './SequenceElementMapper.js';

import { log } from '../../../../logger.js';
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
export class SequenceASTBuilder extends SequenceParserVisitor<string> {
  private lines: string[] = [];
  private currentIndent = 0;
  private indentSize = 2;

  // For preserving exact original segments and semicolon-joined lines
  private currentSourceLineNumber: number | null = null;
  private currentJoinedLineText = '';
  private lineSeparator = ';';
  private lastPhysicalLineEmitted = 0;
  private emittedLines = new Set<number>();

  // AST building properties
  private ast: SequenceAST;
  private currentIndex = 0;

  // Suppress code emission when building nested AST (e.g., visiting children inside blocks)
  private suppressEmission = false;

  // Stack for collecting nested statements within control structures
  private blockStack: { type: SequenceStatement['type']; statements: SequenceStatement[] }[] = [];

  // Position tracking for bidirectional synchronization
  private originalText = '';
  private elementMappings: ElementMapping[] = [];
  private svgIdCounter = 0;
  private elementMappingCounter = 0; // Separate counter for element mapping IDs
  private currentLine = 1;
  private currentColumn = 1;
  private currentCharIndex = 0;
  // Track the actual rendered message index (accounts for activation/deactivation messages)
  private renderedMessageIndex = 0;

  /**
   * Create a minimal valid sequence AST
   */
  static createEmpty(): SequenceAST {
    return {
      header: 'sequenceDiagram',
      statements: [],
      metadata: {
        participants: new Map(),
      },
    };
  }

  constructor(originalText?: string) {
    super();

    // Initialize with empty lines array
    this.lines = [];
    // Initialize AST
    this.ast = SequenceASTBuilder.createEmpty();
    this.currentIndex = 0;

    // Store original text for position tracking
    this.originalText = originalText ?? '';
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
  generateAST(
    tree: any
    // visitor: SequenceParserVisitor
  ): { code: string; lines: string[]; ast: SequenceAST } {
    log.info('🌳 Generating code from parse tree with position tracking', tree);

    this.lines = [];
    this.currentIndent = 0;
    this.ast = SequenceASTBuilder.createEmpty();
    this.currentIndex = 0;
    this.elementMappings = [];
    this.svgIdCounter = 0;
    this.elementMappingCounter = 0;
    this.resetPositionTracking();

    log.debug('🎯 Starting code generation with AST building and position tracking');
    try {
      log.debug('🔎 Root ctx type:', tree?.constructor?.name);
    } catch {}

    // Visit the tree to generate code and build AST
    this.visit(tree);

    // Join lines and return both full code, line array, and AST
    const code = this.lines.join('\n');

    // Add element mappings to AST
    this.ast.elementMappings = [...this.elementMappings];

    // Attach bidirectional synchronization methods to AST
    this.attachSyncMethodsToAST();

    log.debug('✅ Code generation complete:', {
      lines: this.lines.length,
      statements: this.ast.statements.length,
      mappings: this.elementMappings.length,
    });

    // Manipulate ast

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
  /**
   * Push a statement into the current container (top-level or current block).
   */
  private pushStatement(statement: SequenceStatement): void {
    if (this.blockStack.length > 0) {
      this.blockStack[this.blockStack.length - 1].statements.push(statement);
    } else {
      this.ast.statements.push(statement);
    }
  }

  /**
   * Add a line using indentation inferred from the original source position (ctx.start.column)
   * Falls back to currentIndent when no context is available.
   */
  private addLineWithCtxIndent(text: string, ctx?: ParserRuleContext): void {
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
    if (this.suppressEmission) {
      return;
    }
    this.addRawLine(this.getOriginalLine(lineNumber));
    this.lastPhysicalLineEmitted = lineNumber;
    this.emittedLines.add(lineNumber);
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
   * Extract the original source text for a statement from the context.
   * This allows regenerating the code using the original text when there are no changes.
   */
  private getOriginalSourceFromCtx(ctx: ParserRuleContext): string {
    if (!ctx?.start || !ctx?.stop || !this.originalText) {
      return '';
    }
    const startIdx = ctx.start.start;
    const stopIdx = ctx.stop.stop;
    return this.originalText.slice(startIdx, stopIdx + 1);
  }

  /**
   * Emit a segment of original source that belongs to a single logical statement on a single line.
   * Supports semicolon-joined lines by appending with ';' when multiple segments share the same source line.
   */
  private emitOriginalSegmentFromCtx(ctx: ParserRuleContext): void {
    if (this.suppressEmission) {
      return;
    }
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
    if (this.suppressEmission) {
      // Still reset the buffer to avoid leaking state
      this.currentSourceLineNumber = null;
      this.currentJoinedLineText = '';
      return;
    }
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
  private getPositionFromContext(ctx: ParserRuleContext): ElementPosition | null {
    if (!ctx?.start || !ctx.stop) {
      return null;
    }

    const startLine = ctx.start.line;
    const startColumn = ctx.start.column;
    const endLine = ctx.stop.line;
    const endColumn = ctx.stop.column + (ctx.stop.text?.length ?? 1);
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
  private createElementMapping(
    type: SequenceStatementType,
    ctx: ParserRuleContext,
    data: ElementMapping['data']
  ): ElementMapping | null {
    log.debug('🔧 createElementMapping called:', { type, hasCtx: !!ctx, data });

    const position = this.getPositionFromContext(ctx);
    log.debug('🔧 Position from context:', position);

    if (!position) {
      log.debug('⚠️ No position from context, skipping element mapping');
      return null;
    }

    const elementId = ElementMappingUtils.generateElementId(type, this.elementMappingCounter++);
    const svgId = ElementMappingUtils.generateSvgId(elementId);

    // Generate SVG selector based on data-et attribute (used by sequence renderer)
    // For participants/actors: [data-et="participant"][data-id="participantId"] or [data-et="actor"][data-id="actorId"]
    // For messages: [data-et="message"][data-id="i0"]
    // For notes: [data-et="note"][data-id="i0"]
    let svgSelector = `[data-et="${type}"]`;

    // Add data-id for more specific selection
    if ((type === 'participant' || type === 'actor') && 'id' in data) {
      svgSelector = `[data-et="${type}"][data-id="${data.id}"]`;
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
      type,
      position,
      svgId,
      svgSelector,
      data,
    };

    log.debug('✅ Created element mapping:', mapping);
    this.elementMappings.push(mapping);
    log.debug('📊 Total mappings now:', this.elementMappings.length);
    return mapping;
  }

  /**
   * Create fine-grained element mappings for message components using actual ANTLR token positions
   * This allows highlighting specific parts: from participant, to participant, or message text
   * This version uses the actual token positions from the parse tree to handle extra whitespace correctly
   */
  private createFineGrainedMessageMappingsFromTokens(
    ctx: any,
    from: string,
    arrow: string,
    to: string,
    message: string,
    messageData: MessageData
  ): void {
    log.debug('🔧 createFineGrainedMessageMappingsFromTokens called');

    // Use the renderedMessageIndex which accounts for activation/deactivation messages
    const messageIndex = this.renderedMessageIndex;

    // Check if this message has an activation or deactivation marker
    const hasActivationMarker = arrow.endsWith('+') || arrow.endsWith('-');

    log.debug(
      `📊 [MessageIndex] arrow="${arrow}", hasActivationMarker=${hasActivationMarker}, messageIndex=${messageIndex}`
    );

    // Increment the rendered message index
    this.renderedMessageIndex += hasActivationMarker ? 2 : 1;

    log.debug(
      `📊 [MessageIndex] After increment: renderedMessageIndex=${this.renderedMessageIndex}`
    );

    // Grammar: signalStatement: actor signaltype (PLUS actor | MINUS actor | actor) text2
    // ctx.children should contain: [fromActorCtx, signaltypeCtx, toActorCtx (or PLUS/MINUS + toActorCtx), text2Ctx]

    try {
      // Get the FROM actor context (first child)
      const fromActorCtx = ctx.actor && typeof ctx.actor === 'function' ? ctx.actor(0) : null;
      if (fromActorCtx) {
        const fromPosition = this.getPositionFromContext(fromActorCtx);
        if (fromPosition) {
          const fromMapping: ElementMapping = {
            id: ElementMappingUtils.generateElementId('participant', this.elementMappingCounter++),
            type: 'participant',
            position: fromPosition,
            svgId: ElementMappingUtils.generateSvgId(`participant_${from}`),
            svgSelector: `[data-et="participant"][data-id="${from}"]`,
            data: { id: from, role: 'from' },
          };
          this.elementMappings.push(fromMapping);
          log.debug('✅ Created FROM participant mapping from token:', fromMapping);
        }
      }

      // Get the TO actor context (second actor call)
      const toActorCtx = ctx.actor && typeof ctx.actor === 'function' ? ctx.actor(1) : null;
      if (toActorCtx) {
        const toPosition = this.getPositionFromContext(toActorCtx);
        if (toPosition) {
          const toMapping: ElementMapping = {
            id: ElementMappingUtils.generateElementId('participant', this.elementMappingCounter++),
            type: 'participant',
            position: toPosition,
            svgId: ElementMappingUtils.generateSvgId(`participant_${to}`),
            svgSelector: `[data-et="participant"][data-id="${to}"]`,
            data: { id: to, role: 'to' },
          };
          this.elementMappings.push(toMapping);
          log.debug('✅ Created TO participant mapping from token:', toMapping);
        }
      }

      // Get the text2 context (message text)
      const text2Ctx = ctx.text2 && typeof ctx.text2 === 'function' ? ctx.text2() : null;
      if (text2Ctx) {
        const messagePosition = this.getPositionFromContext(text2Ctx);
        if (messagePosition) {
          // The text2 token includes the colon and any leading/trailing whitespace
          // We need to find where the actual message text starts
          const text2Text = this.getContextText(text2Ctx);
          log.debug('🔍 text2 raw text:', JSON.stringify(text2Text));

          // Find the colon position
          const colonIndex = text2Text.indexOf(':');
          if (colonIndex >= 0) {
            // Find where the actual message starts (after colon and whitespace)
            const afterColon = text2Text.substring(colonIndex + 1);
            const leadingWhitespace = afterColon.length - afterColon.trimStart().length;

            // Calculate the actual message start position
            const messageStartOffset = colonIndex + 1 + leadingWhitespace;
            const messageStartColumn = messagePosition.startColumn + messageStartOffset;
            const messageStartIndex = messagePosition.startIndex + messageStartOffset;
            const messageEndColumn = messageStartColumn + message.length;
            const messageEndIndex = messageStartIndex + message.length;

            const messageMapping: ElementMapping = {
              id: ElementMappingUtils.generateElementId('message', this.elementMappingCounter++),
              type: 'message',
              position: {
                startLine: messagePosition.startLine,
                startColumn: messageStartColumn,
                endLine: messagePosition.endLine,
                endColumn: messageEndColumn,
                startIndex: messageStartIndex,
                endIndex: messageEndIndex,
              },
              svgId: ElementMappingUtils.generateSvgId(`message_${messageIndex}`),
              svgSelector: `[data-et="message"][data-id="i${messageIndex}"]`,
              data: messageData,
            };
            this.elementMappings.push(messageMapping);
            log.debug('✅ Created MESSAGE text mapping from token:', messageMapping);
          }
        }
      }
    } catch (error) {
      log.error('❌ Error creating fine-grained mappings from tokens:', error);
    }
  }

  /**
   * Extract text from terminal nodes
   */
  private getTerminalText(ctx: ParseTree | undefined): string {
    if (!ctx) {
      return '';
    }

    // If it's a terminal node, return its text (type guard for TerminalNode)
    const maybeTerminal = ctx as unknown as TerminalNode;
    if ('symbol' in (maybeTerminal as object) && maybeTerminal.symbol?.text) {
      return maybeTerminal.symbol.text;
    }

    // If it has children, collect text from all terminal children
    const anyCtx = ctx as unknown as { children?: ParseTree[] };
    if (anyCtx.children && Array.isArray(anyCtx.children)) {
      return anyCtx.children
        .map((child: ParseTree) => this.getTerminalText(child))
        .filter((text: string) => text.trim() !== '')
        .join(' ');
    }

    return '';
  }

  /**
   * Get text content from a context, handling both terminal and non-terminal nodes
   */
  private getContextText(ctx: ParserRuleContext | ParseTree | undefined): string {
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
  private extractAllText(ctx: ParseTree | undefined): string[] {
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
  visit(tree: ParseTree | undefined): string {
    if (!tree) {
      return '';
    }

    try {
      // @ts-expect-error antlr4ng typing for accept is not strict here
      return tree.accept(this) ?? '';
    } catch (error) {
      log.debug('Error visiting node:', error);
      return '';
    }
  }

  visitTerminal(node: TerminalNode): string {
    return node.symbol?.text ?? '';
  }

  visitErrorNode(_node: ErrorNode): string {
    return '';
  }

  // Start rule - the root of the parse tree
  visitStart(ctx: StartContext): string {
    // Proper visitor approach: use the AST structure
    log.debug('🎯 visitStart: Starting AST traversal');

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
      const sdSafeText = sdText?.startsWith('<missing') ? 'sequenceDiagram' : sdText;
      this.currentJoinedLineText = leading + sdSafeText;
      // If the original SD line does not contain a semicolon, flush immediately so SD appears before following lines
      if (!lineText.includes(';')) {
        this.flushJoinedLine();
      }
      // Preserve wrap directive line immediately after SD if present and not captured by the parser
      const nextLineNum = sdLine + 1;
      const maybeWrap = this.getOriginalLine(nextLineNum);
      if (maybeWrap && maybeWrap.trim() === '%%{wrap}%%') {
        this.addOriginalLine(nextLineNum);
      } else {
        // If the very next line is a top-level comment (%% ... or # ...), ensure it is preserved.
        // We proactively emit it here and guard against duplication in visitCommentStatement.
        try {
          const lineText = this.getOriginalLine(nextLineNum);
          const trimmed = lineText.trimStart();
          if (trimmed.startsWith('%%') || trimmed.startsWith('#')) {
            this.addOriginalLine(nextLineNum);
          }
        } catch {}
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
  visitHeader(_ctx: HeaderContext): string {
    // Header lines are emitted in visitStart from the original source.
    // Do nothing here to avoid duplication.
    return '';
  }

  // Document - main content
  visitDocument(ctx: DocumentContext): string {
    if (ctx?.children && Array.isArray(ctx.children)) {
      const kids = [...ctx.children];
      kids.sort((a: ParseTree, b: ParseTree) => {
        const la = (a as unknown as ParserRuleContext)?.start?.line ?? 0;
        const lb = (b as unknown as ParserRuleContext)?.start?.line ?? 0;
        if (la !== lb) {
          return la - lb;
        }
        const ia = (a as unknown as ParserRuleContext)?.start?.start ?? 0;
        const ib = (b as unknown as ParserRuleContext)?.start?.start ?? 0;
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
  visitLine(ctx: LineContext): string {
    const statementCtx = ctx.statement();

    // First, visit the statement if it exists (this will add it to the AST)
    if (statementCtx) {
      this.visitChildren(ctx);
    }

    // Now check the NEWLINE token to see if there are blank lines after this line
    // The NEWLINE token might contain multiple \n characters (e.g., "\n\n" for a blank line)
    const newlineText = this.getOriginalSourceFromCtx(ctx);
    const newlineCount = (newlineText.match(/\n/g) || []).length;

    // The first newline ends the current line
    // Each additional newline represents a blank line
    // For example: "\n\n" means 1 blank line, "\n\n\n" means 2 blank lines
    const blankLineCount = Math.max(0, newlineCount - 1);

    if (blankLineCount > 0) {
      // Create blank line statements for the extra newlines
      for (let i = 0; i < blankLineCount; i++) {
        this.pushStatement({
          type: 'blankLine',
          originalIndex: this.currentIndex++, // Increment index for each blank line
          data: {},
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: '\n', // Each blank line is represented by a single newline
        });
      }
    }

    return '';
  }
  // Comment statement (%% ...)
  visitCommentStatement(ctx: CommentStatementContext): string {
    let alreadyEmitted = false;
    try {
      const ln = ctx?.start?.line ?? 0;
      if (ln && this.emittedLines.has(ln)) {
        // Already emitted verbatim (e.g., immediately after SD); skip code emission to avoid duplication
        alreadyEmitted = true;
      }
    } catch {}

    if (!alreadyEmitted) {
      this.emitOriginalSegmentFromCtx(ctx);
    }

    // Always add comment to AST (even if already emitted for code generation)
    const commentText = this.getOriginalSourceFromCtx(ctx);
    this.pushStatement({
      type: 'comment',
      originalIndex: this.currentIndex++,
      data: { text: commentText },
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: commentText,
    });

    return '';
  }

  // Statement - individual statements
  visitStatement(ctx: StatementContext): string {
    this.visitChildren(ctx);
    return '';
  }

  // Participant statement
  visitParticipantStatement(ctx: ParticipantStatementContext): string {
    log.debug('🎯 visitParticipantStatement');

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
      const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
      const id = actorCtx ? this.getContextText(actorCtx).trim() : '';

      let alias = '';
      const hasAS = !!(ctx.AS && typeof ctx.AS === 'function' && ctx.AS());
      if (hasAS && ctx.restOfLine && typeof ctx.restOfLine === 'function' && ctx.restOfLine()) {
        // For aliases, the grammar uses: (AS restOfLine)?
        // restOfLine should already be the alias text without a leading colon
        const rol = ctx.restOfLine();
        alias = rol ? this.getContextText(rol).trim() : '';
      }

      if ((hasActor || hasParticipant) && id) {
        // Emit exact original text segment for output (preserves spaces and inline config)
        this.emitOriginalSegmentFromCtx(ctx);

        // Build AST entry
        const participantData: ParticipantData = { id, alias: alias || undefined };
        const statementType = hasActor ? 'actor' : 'participant';
        this.pushStatement({
          type: statementType as any,
          originalIndex: this.currentIndex++,
          data: participantData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: this.getOriginalSourceFromCtx(ctx),
        });

        // Create element mapping for bidirectional synchronization
        // Use actorCtx instead of ctx to highlight only the participant name, not the keyword
        this.createElementMapping('participant', actorCtx || ctx, participantData);
        log.debug('📝 Added participant to AST:', participantData);
        return '';
      }
    } catch (e) {
      log.debug('visitParticipantStatement fallback path due to error:', e);
    }

    // Fallback: emit the exact original segment to preserve spaces/config
    const fullText = ctx.getText ? ctx.getText() : '';
    log.debug('  - Full participant text (fallback):', fullText);
    if (fullText) {
      this.emitOriginalSegmentFromCtx(ctx);
    }

    return '';
  }

  // Create statement
  visitCreateStatement(ctx: CreateStatementContext): string {
    log.debug('🎯 visitCreateStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const createMatch = /^create\s+participant\s+(\w+)/.exec(fullText);
    if (createMatch) {
      const [, participant] = createMatch;
      this.pushStatement({
        type: 'create',
        originalIndex: this.currentIndex++,
        data: { participant },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Destroy statement
  visitDestroyStatement(ctx: DestroyStatementContext): string {
    log.debug('🎯 visitDestroyStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const destroyMatch = /^destroy\s+(\w+)/.exec(fullText);
    if (destroyMatch) {
      const [, participant] = destroyMatch;
      this.pushStatement({
        type: 'destroy',
        originalIndex: this.currentIndex++,
        data: { participant },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Signal statement (messages between participants)
  visitSignalStatement(ctx: SignalStatementContext): string {
    log.debug('🎯 visitSignalStatement:', ctx);

    // Use the simpler approach: get the full text and clean it up
    const fullText = ctx.getText ? ctx.getText() : '';
    log.debug('  - Full signal text:', fullText);

    if (fullText) {
      // Parse the signal pattern: from + arrow + to + : + message
      // Updated regex to handle activation/deactivation markers (+ and -)
      const signalMatch = /^(\w+)(->|-->>|->>|-->)([+-]?)(\w+):(.+)$/.exec(fullText);
      log.debug('  - Regex match result:', signalMatch);

      if (signalMatch) {
        const [, from, arrow, activationMarker, to, message] = signalMatch;
        const cleanMessage = message.trim();
        const fullArrow = arrow + activationMarker;
        // Emit exact original text (preserves spaces and colon spacing)
        this.emitOriginalSegmentFromCtx(ctx);

        // Build AST entry
        const messageData: MessageData = { from, arrow: fullArrow, to, message: cleanMessage };
        this.pushStatement({
          type: 'message',
          originalIndex: this.currentIndex++,
          data: messageData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: this.getOriginalSourceFromCtx(ctx),
        });

        // Create fine-grained element mappings for each component
        log.debug('  - Creating fine-grained element mappings');
        this.createFineGrainedMessageMappingsFromTokens(
          ctx,
          from,
          fullArrow,
          to,
          cleanMessage,
          messageData
        );

        log.debug('📝 Added message to AST:', messageData);
      } else {
        log.debug('  - ⚠️ Regex did not match, using fallback');
        // Fallback: emit the exact original segment so ordering and semicolons are preserved
        this.emitOriginalSegmentFromCtx(ctx);
      }
    }

    return '';
  }

  // Note statement
  visitNoteStatement(ctx: NoteStatementContext): string {
    // Emit exact original segment for output
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract position (left, right, or over)
    let position: 'left' | 'right' | 'over' = 'left';
    if (ctx.RIGHT_OF()) {
      position = 'right';
    } else if (ctx.LEFT_OF()) {
      position = 'left';
    } else if (ctx.OVER()) {
      position = 'over';
    }

    // Extract actor(s)
    const actors = ctx.actor();
    const participants = actors.map((actor) => this.getContextText(actor));

    // Extract message text (text2 includes the leading ':' so we need to strip it)
    const text2Ctx = ctx.text2();
    let message = text2Ctx ? this.getContextText(text2Ctx).trim() : '';
    // Remove leading ':' if present
    if (message.startsWith(':')) {
      message = message.substring(1).trim();
    }

    const noteData: NoteData = {
      position,
      participant: participants[0] || '', // Keep for backward compatibility
      participants, // Array of all participants
      message,
    };

    this.pushStatement({
      type: 'note',
      originalIndex: this.currentIndex++,
      data: noteData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('note', ctx, noteData);

    return '';
  }

  // Loop block
  visitLoopBlock(ctx: LoopBlockContext): string {
    // 1) Build AST for the loop (condition + nested statements)
    const condition =
      typeof ctx.restOfLine === 'function' && ctx.restOfLine()
        ? this.getContextText(ctx.restOfLine() ?? undefined).trim()
        : '';

    // Collect nested statements while suppressing emission
    const nested: SequenceStatement[] = [];
    this.blockStack.push({ type: 'loop', statements: nested });
    const prevSuppress = this.suppressEmission;
    this.suppressEmission = true;
    try {
      if (typeof ctx.document === 'function' && ctx.document()) {
        this.visit(ctx.document());
      } else {
        this.visitChildren(ctx);
      }
    } finally {
      this.suppressEmission = prevSuppress;
      this.blockStack.pop();
    }

    const loopData = { condition, statements: nested } as any;
    this.pushStatement({
      type: 'loop',
      originalIndex: this.currentIndex++,
      data: loopData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('loop', ctx, loopData);

    // 2) Emit the entire loop block exactly as in the source for code reproduction
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Opt block
  visitOptBlock(ctx: OptBlockContext): string {
    // Emit the entire opt block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const optMatch = /^opt\s+(.+?)(?:end|$)/s.exec(fullText);
    if (optMatch) {
      const [, content] = optMatch;
      this.pushStatement({
        type: 'opt',
        originalIndex: this.currentIndex++,
        data: { condition: content.trim(), statements: [] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Alt block
  visitAltBlock(ctx: AltBlockContext): string {
    // Emit the entire alt block exactly as in the source (including else sections)
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const altMatch = /^alt\s+(.+?)(?:else|end)/s.exec(fullText);
    if (altMatch) {
      const [, condition] = altMatch;
      this.pushStatement({
        type: 'alt',
        originalIndex: this.currentIndex++,
        data: { condition: condition.trim(), statements: [[]], elseStatements: [] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Else section within alt block
  visitElseSection(_ctx: ElseSectionContext): string {
    // Handled by parent alt block emission
    return '';
  }

  // Par block
  visitParBlock(ctx: ParBlockContext): string {
    // Emit the entire par block exactly as in the source (including 'and' sections)
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    this.pushStatement({
      type: 'par',
      originalIndex: this.currentIndex++,
      data: { statements: [[]] },
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    return '';
  }

  // And section within par block
  visitAndSection(_ctx: AndSectionContext): string {
    // Handled by parent par block emission
    return '';
  }

  // Rect block
  visitRectBlock(ctx: RectBlockContext): string {
    // Emit the entire rect block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const rectMatch = /^rect\s+(?:rgb\(([^)]+)\)\s*)?(.*)end$/s.exec(fullText);
    if (rectMatch) {
      const [, color] = rectMatch;
      this.pushStatement({
        type: 'rect',
        originalIndex: this.currentIndex++,
        data: { color: color?.trim(), statements: [] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Box block
  visitBoxBlock(ctx: BoxBlockContext): string {
    // Emit the entire box block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const boxMatch = /^box\s+(?:"([^"]+)"\s*)?(.*)end$/s.exec(fullText);
    if (boxMatch) {
      const [, name] = boxMatch;
      this.pushStatement({
        type: 'box',
        originalIndex: this.currentIndex++,
        data: { name: name?.trim(), participants: [] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Break block
  visitBreakBlock(ctx: ParserRuleContext): string {
    // Emit the entire break block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const breakMatch = /^break\s+(.+?)(?:end|$)/s.exec(fullText);
    if (breakMatch) {
      const [, condition] = breakMatch;
      this.pushStatement({
        type: 'break',
        originalIndex: this.currentIndex++,
        data: { condition: condition.trim(), statements: [] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Critical block
  visitCriticalBlock(ctx: ParserRuleContext): string {
    // Emit the entire critical block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const criticalMatch = /^critical\s+(.+?)(?:option|end)/s.exec(fullText);
    if (criticalMatch) {
      const [, condition] = criticalMatch;
      this.pushStatement({
        type: 'critical',
        originalIndex: this.currentIndex++,
        data: { condition: condition.trim(), statements: [[]] },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Option section within critical block
  visitOptionSection(_ctx: OptionSectionContext): string {
    // Handled by parent critical block emission
    return '';
  }

  // ParOver block
  visitParOverBlock(ctx: ParOverBlockContext): string {
    // Emit the entire par_over block exactly as in the source
    this.flushJoinedLine();
    // Emit any intervening blank lines before the block
    for (let ln = this.lastPhysicalLineEmitted + 1; ln < ctx.start!.line; ln++) {
      const between = this.getOriginalLine(ln);
      if (between.trim() === '') {
        this.addOriginalLine(ln);
      }
    }
    for (let ln = ctx.start!.line; ln <= ctx.stop!.line; ln++) {
      this.addOriginalLine(ln);
    }
    return '';
  }

  // Links statement
  visitLinksStatement(ctx: LinksStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const linksMatch = /^links\s+(\w+)\s*:\s*(.+)$/.exec(fullText);
    if (linksMatch) {
      const [, participant, linksStr] = linksMatch;
      // Parse links as key-value pairs
      const links: Record<string, string> = {};
      const linkPairs = linksStr.split(',');
      for (const pair of linkPairs) {
        const [key, value] = pair.split(':').map((s) => s.trim());
        if (key && value) {
          links[key] = value;
        }
      }
      this.pushStatement({
        type: 'links',
        originalIndex: this.currentIndex++,
        data: { participant, links },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Link statement
  visitLinkStatement(ctx: LinkStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const linkMatch = /^link\s+(\w+)\s*:\s*(\w+)\s*@\s*(.+)$/.exec(fullText);
    if (linkMatch) {
      const [, participant, linkName, linkUrl] = linkMatch;
      this.pushStatement({
        type: 'link',
        originalIndex: this.currentIndex++,
        data: { participant, linkName: linkName.trim(), linkUrl: linkUrl.trim() },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Properties statement
  visitPropertiesStatement(ctx: PropertiesStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const propertiesMatch = /^properties\s+(\w+)\s*:\s*(.+)$/.exec(fullText);
    if (propertiesMatch) {
      const [, participant, propertiesStr] = propertiesMatch;
      // Parse properties as key-value pairs
      const properties: Record<string, string> = {};
      const propPairs = propertiesStr.split(',');
      for (const pair of propPairs) {
        const [key, value] = pair.split(':').map((s) => s.trim());
        if (key && value) {
          properties[key] = value;
        }
      }
      this.pushStatement({
        type: 'properties',
        originalIndex: this.currentIndex++,
        data: { participant, properties },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Details statement
  visitDetailsStatement(ctx: DetailsStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const detailsMatch = /^details\s+(\w+)\s*:\s*(.+)$/.exec(fullText);
    if (detailsMatch) {
      const [, participant, details] = detailsMatch;
      this.pushStatement({
        type: 'details',
        originalIndex: this.currentIndex++,
        data: { participant, details: details.trim() },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Activation statement (activate/deactivate)
  visitActivationStatement(ctx: ActivationStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Determine if this is activate or deactivate
    const isActivate = ctx.ACTIVATE() !== null;
    const action = isActivate ? 'activate' : 'deactivate';

    // Extract the actor
    const actorCtx = ctx.actor();
    const participant = actorCtx ? this.getContextText(actorCtx) : '';

    this.pushStatement({
      type: action,
      originalIndex: this.currentIndex++,
      data: { participant },
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });

    return '';
  }

  // Autonumber statement
  visitAutonumberStatement(ctx: AutonumberStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const autonumberMatch = /^autonumber(?:\s+(\d+))?(?:\s+(\d+))?/.exec(fullText);
    if (autonumberMatch) {
      const [, start, step] = autonumberMatch;
      this.pushStatement({
        type: 'autonumber',
        originalIndex: this.currentIndex++,
        data: {
          start: start ? parseInt(start, 10) : undefined,
          step: step ? parseInt(step, 10) : undefined,
        },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Title statement
  visitTitleStatement(ctx: TitleStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const titleMatch = /^title\s+(.+)$/.exec(fullText);
    if (titleMatch) {
      const [, title] = titleMatch;
      this.pushStatement({
        type: 'title',
        originalIndex: this.currentIndex++,
        data: { title: title.trim() },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Legacy title statement
  visitLegacyTitleStatement(ctx: LegacyTitleStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Accessibility title statement
  visitAccTitleStatement(ctx: AccTitleStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const accTitleMatch = /^accTitle\s*:\s*(.+)$/.exec(fullText);
    if (accTitleMatch) {
      const [, title] = accTitleMatch;
      this.pushStatement({
        type: 'accTitle',
        originalIndex: this.currentIndex++,
        data: { title: title.trim() },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Accessibility description statement
  visitAccDescrStatement(ctx: AccDescrStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);

    // Build AST entry
    const fullText = ctx.getText ? ctx.getText() : '';
    const accDescrMatch = /^accDescr\s*:\s*(.+)$/.exec(fullText);
    if (accDescrMatch) {
      const [, description] = accDescrMatch;
      this.pushStatement({
        type: 'accDescr',
        originalIndex: this.currentIndex++,
        data: { description: description.trim() },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });
    }
    return '';
  }

  // Accessibility multiline description statement
  visitAccDescrMultilineStatement(ctx: AccDescrMultilineStatementContext): string {
    this.emitOriginalSegmentFromCtx(ctx);
    return '';
  }

  // Additional visitor methods for completeness
  visitActorWithConfig(ctx: ActorWithConfigContext): string {
    return this.visitChildren(ctx);
  }

  visitConfigObject(ctx: ConfigObjectContext): string {
    return this.visitChildren(ctx);
  }

  visitSignaltype(ctx: SignaltypeContext): string {
    return this.visitChildren(ctx);
  }

  visitText2(ctx: Text2Context): string {
    return this.visitChildren(ctx);
  }

  visitRestOfLine(ctx: RestOfLineContext): string {
    return this.visitChildren(ctx);
  }

  visitAltSections(ctx: AltSectionsContext): string {
    return this.visitChildren(ctx);
  }

  visitParSections(ctx: ParSectionsContext): string {
    return this.visitChildren(ctx);
  }

  visitOptionSections(ctx: OptionSectionsContext): string {
    return this.visitChildren(ctx);
  }

  visitActor(ctx: ActorContext): string {
    return this.visitChildren(ctx);
  }
}
