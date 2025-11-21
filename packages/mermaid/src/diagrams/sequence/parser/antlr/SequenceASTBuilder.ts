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
  BreakBlockContext,
  CriticalBlockContext,
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
  LoopData,
  OptData,
  AltData,
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

/**
 * ANTLR4ng generates visitor methods as optional properties in the base class,
 * but we implement them as methods. TypeScript sees this as incompatible because
 * properties can be reassigned while methods cannot. The runtime behavior is correct
 * because methods are compatible with function properties.
 *
 * We cast to any to bypass TypeScript's strict checking for this ANTLR pattern.
 */

export class SequenceASTBuilder extends (SequenceParserVisitor as any)<string> {
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
  private currentIndex = 0; // Logical order for code regeneration (sequential)
  private dbIndex = 0; // DB message array index (includes control structure markers for SVG matching)

  // Suppress code emission when building nested AST (e.g., visiting children inside blocks)
  private suppressEmission = false;

  // Stack for collecting nested statements within control structures
  private blockStack: { type: SequenceStatement['type']; statements: SequenceStatement[] }[] = [];

  // Stack for collecting sections in multi-section blocks (par, critical)
  private sectionStack: SequenceStatement[][][] = [];

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
  }

  /**
   * Visit all children of a node and aggregate their results
   * Required by ParseTreeVisitor interface
   */
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
    tree: ParseTree
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

      // Special handling for message lines: prefer message mapping over participant mappings
      // This ensures that when cursor is anywhere on a message line (including on participant names),
      // we highlight the entire message arrow in the SVG
      const messageMatch = matches.find((m) => m.type === 'message');
      if (messageMatch) {
        // Check if there are participant mappings on the same line
        const participantMatches = matches.filter(
          (m) =>
            (m.type === 'participant' || m.type === 'actor') &&
            m.position.startLine === messageMatch.position.startLine
        );

        // If we have both message and participant mappings on the same line,
        // prefer the message mapping for code-to-SVG highlighting
        if (participantMatches.length > 0) {
          return messageMatch;
        }
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
      // Match against the svgSelector which contains the correct data-id
      if (dataId.startsWith('i')) {
        const expectedSelector = `[data-et="message"][data-id="${dataId}"]`;
        const expectedNoteSelector = `[data-et="note"][data-id="${dataId}"]`;

        for (const mapping of mappings) {
          if (
            (mapping.type === 'message' && mapping.svgSelector === expectedSelector) ||
            (mapping.type === 'note' && mapping.svgSelector === expectedNoteSelector)
          ) {
            return mapping;
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
   * Create element mapping for the entire line based on line number from ANTLR context
   * This is used for actor/participant declaration statements where we want
   * the cursor anywhere on the line to highlight the element
   */
  private createFullLineElementMapping(
    type: SequenceStatementType,
    ctx: ParserRuleContext,
    data: ElementMapping['data'],
    dbIndex?: number
  ): ElementMapping | null {
    if (!ctx?.start) {
      return null;
    }

    const lineNumber = ctx.start.line;
    const lineText = this.getOriginalLine(lineNumber);

    if (!lineText) {
      return null;
    }

    // Map the entire line: from column 0 to end of line
    const startColumn = 0;
    const endColumn = lineText.length;

    // Calculate absolute character indices in the original text
    // Find the start of this line in the original text
    const lines = this.originalText.split('\n');
    let startIndex = 0;
    for (let i = 0; i < lineNumber - 1; i++) {
      startIndex += lines[i].length + 1; // +1 for newline character
    }
    const endIndex = startIndex + lineText.length;

    const position: ElementPosition = {
      startLine: lineNumber,
      startColumn,
      endLine: lineNumber,
      endColumn,
      startIndex,
      endIndex,
    };

    const elementId = ElementMappingUtils.generateElementId(type, this.elementMappingCounter++);

    // For messages and notes, use dbIndex in the svgId to match the DB's message index
    // For participants/actors, use the elementId
    let svgId: string;
    if ((type === 'message' || type === 'note') && dbIndex !== undefined) {
      svgId = ElementMappingUtils.generateSvgId(`${type}_${dbIndex}`);
    } else {
      svgId = ElementMappingUtils.generateSvgId(elementId);
    }

    // Generate SVG selector based on data-et attribute
    let svgSelector = `[data-et="${type}"]`;

    // Add data-id for more specific selection
    if ((type === 'participant' || type === 'actor') && 'id' in data) {
      svgSelector = `[data-et="${type}"][data-id="${data.id}"]`;
    } else if (type === 'message' || type === 'note') {
      const index =
        dbIndex ??
        this.elementMappings.filter((m) => m.type === 'message' || m.type === 'note').length;
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

    log.debug('✅ Created FULL-LINE element mapping:', mapping);
    this.elementMappings.push(mapping);
    return mapping;
  }

  /**
   * Create element mapping for bidirectional synchronization
   */
  private createElementMapping(
    type: SequenceStatementType,
    ctx: ParserRuleContext,
    data: ElementMapping['data'],
    dbIndex?: number
  ): ElementMapping | null {
    log.debug('🔧 createElementMapping called:', { type, hasCtx: !!ctx, data, dbIndex });

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
      // Use the DB index which matches how the renderer sets data-id attributes
      // The DB assigns IDs based on the total count of ALL items in the messages array,
      // including control structures (alt, opt, loop, etc.)
      const index =
        dbIndex ??
        this.elementMappings.filter((m) => m.type === 'message' || m.type === 'note').length;
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
   * Create an element mapping with a specific SVG ID and selector
   * This is used for participant aliases to ensure both the ID and alias mappings
   * have the same SVG ID so they highlight the same element in the diagram
   */
  private createElementMappingWithSvgId(
    type: SequenceStatementType,
    ctx: ParserRuleContext,
    data: ElementMapping['data'],
    svgId: string,
    svgSelector: string
  ): ElementMapping | null {
    log.debug('🔧 createElementMappingWithSvgId called:', {
      type,
      hasCtx: !!ctx,
      data,
      svgId,
      svgSelector,
    });

    const position = this.getPositionFromContext(ctx);
    log.debug('🔧 Position from context:', position);

    if (!position) {
      log.debug('⚠️ No position from context, skipping element mapping');
      return null;
    }

    const elementId = ElementMappingUtils.generateElementId(type, this.elementMappingCounter++);

    const mapping: ElementMapping = {
      id: elementId,
      type,
      position,
      svgId, // Use the provided SVG ID instead of generating a new one
      svgSelector, // Use the provided SVG selector
      data,
    };

    log.debug('✅ Created element mapping with specific SVG ID:', mapping);
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
    ctx: SignalStatementContext,
    from: string,
    arrow: string,
    to: string,
    message: string,
    messageData: MessageData,
    dbIndex: number
  ): void {
    log.debug('🔧 createFineGrainedMessageMappingsFromTokens called with dbIndex:', dbIndex);

    // Use the DB index which matches how the renderer sets data-id attributes
    const messageIndex = dbIndex;

    log.debug(
      `📊 [MessageIndex] arrow="${arrow}", dbIndex=${dbIndex}, messageIndex=${messageIndex}`
    );

    // Grammar: signalStatement: actor signaltype (PLUS actor | MINUS actor | actor) text2
    // ctx.children should contain: [fromActorCtx, signaltypeCtx, toActorCtx (or PLUS/MINUS + toActorCtx), text2Ctx]

    try {
      // First, create a full-line message mapping that spans the entire line (from column 0 to end)
      // This is used for code-to-SVG highlighting (cursor anywhere on line highlights the message)
      // Use createFullLineElementMapping to ensure the mapping covers the entire line including leading/trailing spaces
      const fullLineMessageMapping = this.createFullLineElementMapping(
        'message',
        ctx,
        messageData,
        messageIndex
      );
      if (fullLineMessageMapping) {
        log.debug(
          '✅ Created FULL-LINE message mapping covering entire line:',
          fullLineMessageMapping
        );
      }

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
            data: { id: from } as ParticipantData,
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
            data: { id: to } as ParticipantData,
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
      let nextLineNum = sdLine + 1;
      const maybeWrap = this.getOriginalLine(nextLineNum);
      if (maybeWrap && maybeWrap.trim() === '%%{wrap}%%') {
        this.addOriginalLine(nextLineNum);
        nextLineNum++;
      }

      // Preserve ALL consecutive comment lines immediately after SD (or after wrap directive)
      // These comments are not parsed as commentStatement nodes by the grammar, so we handle them here.
      // We emit them for initial code generation AND add them to the AST for regeneration.
      try {
        const totalLines = this.originalText
          ? this.originalText.replace(/\r\n?/g, '\n').split('\n').length
          : 0;

        while (nextLineNum <= totalLines) {
          const lineText = this.getOriginalLine(nextLineNum);
          const trimmed = lineText.trimStart();

          if (trimmed.startsWith('%%') || trimmed.startsWith('#')) {
            // Emit for initial code generation
            this.addOriginalLine(nextLineNum);

            // Add to AST for regeneration
            // Store just the comment text (trimmed) in data.text for consistent regeneration
            // Store the full line (with original indentation) in sourceLine for preservation
            this.pushStatement({
              type: 'comment',
              originalIndex: this.currentIndex++,
              data: { text: trimmed },
              sourceTokens: { start: undefined, stop: undefined },
              sourceLine: lineText,
            });

            nextLineNum++;
          } else if (trimmed === '') {
            // Skip blank lines and continue checking for more comments
            nextLineNum++;
          } else {
            // Stop when we hit a non-comment, non-blank line
            break;
          }
        }
      } catch {}
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
    const newlineCount = (newlineText.match(/\n/g) ?? []).length;

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
    // Check if this comment was already emitted in visitStart (comments immediately after sequenceDiagram)
    let alreadyEmitted = false;
    try {
      const ln = ctx?.start?.line ?? 0;
      if (ln && this.emittedLines.has(ln)) {
        // Already emitted in visitStart; skip both code emission and AST addition to avoid duplication
        alreadyEmitted = true;
      }
    } catch {}

    if (!alreadyEmitted) {
      this.emitOriginalSegmentFromCtx(ctx);

      const commentText = this.getOriginalSourceFromCtx(ctx);
      this.pushStatement({
        type: 'comment',
        originalIndex: this.currentIndex++,
        data: { text: commentText },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: commentText,
      });
    }

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
      // Check for extended participant syntax: participant <ACTOR>@{...}
      const awc = ctx.actorWithConfig?.();
      if (awc) {
        // Handle participant with config object (e.g., participant API@{ "type": "boundary" })
        const actorToken = awc.ACTOR?.();
        const id = actorToken?.getText().trim() ?? '';

        if (id) {
          // Extract config content to parse type metadata
          const cfgObj = awc.configObject?.();
          const cfgTok = cfgObj?.CONFIG_CONTENT?.();
          const configContent = cfgTok?.getText?.() ?? '';

          // Parse the config content to extract type metadata
          let participantType: ParticipantData['type'] = undefined;
          if (configContent) {
            try {
              // The config content is in JSON format like: "type": "boundary"
              // We need to wrap it in braces to make it valid JSON
              const jsonStr = configContent.includes('\n') ? configContent : `{${configContent}}`;
              const config = JSON.parse(jsonStr);
              if (config.type) {
                participantType = config.type as ParticipantData['type'];
              }
            } catch (e) {
              // If JSON parsing fails, log but continue without type metadata
              log.debug('Failed to parse participant config:', e);
            }
          }

          // Check for alias (AS restOfLine)
          let alias = '';
          const hasAS = !!(ctx.AS && typeof ctx.AS === 'function' && ctx.AS());
          if (hasAS && ctx.restOfLine && typeof ctx.restOfLine === 'function' && ctx.restOfLine()) {
            const rol = ctx.restOfLine();
            alias = rol ? this.getContextText(rol).trim() : '';
          }

          // Log detailed position information for debugging
          log.debug('🔍 [PARTICIPANT-WITH-CONFIG] Processing:', {
            id,
            type: participantType,
            alias,
            configContent,
            awcStart: awc.start,
            awcStop: awc.stop,
            awcText: this.getContextText(awc),
            ctxStart: ctx.start,
            ctxStop: ctx.stop,
            ctxText: this.getContextText(ctx),
          });

          // Emit exact original text segment for output (preserves spaces and inline config)
          this.emitOriginalSegmentFromCtx(ctx);

          // Build AST entry with type metadata and alias
          const participantData: ParticipantData = {
            id,
            type: participantType,
            alias: alias || undefined,
          };
          this.pushStatement({
            type: 'participant',
            originalIndex: this.currentIndex++,
            data: participantData,
            sourceTokens: { start: ctx.start, stop: ctx.stop },
            sourceLine: this.getOriginalSourceFromCtx(ctx),
          });

          // Create element mapping for bidirectional synchronization
          // Use full line mapping so cursor anywhere on the line highlights the participant
          // No need to create separate alias mapping since full-line mapping covers the entire line
          const participantMapping = this.createFullLineElementMapping(
            'participant',
            ctx,
            participantData
          );

          log.debug('📝 Added participant with config to AST:', {
            participantData,
            mapping: participantMapping,
          });
          return '';
        }
      }

      // Handle standard participant/actor syntax
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
        const statementType: SequenceStatementType = hasActor ? 'actor' : 'participant';
        this.pushStatement({
          type: statementType,
          originalIndex: this.currentIndex++,
          data: participantData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: this.getOriginalSourceFromCtx(ctx),
        });

        // Create element mapping for bidirectional synchronization
        // Use full line mapping so cursor anywhere on the line highlights the participant
        // Note: Always use 'participant' for element mapping type because the SVG renderer
        // sets data-et="participant" for all participant types (actor, participant, boundary, etc.)
        // No need to create separate alias mapping since full-line mapping covers the entire line
        this.createFullLineElementMapping('participant', ctx, participantData);

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

    // Determine if this is create participant or create actor
    const hasActor = !!(
      ctx.PARTICIPANT_ACTOR &&
      typeof ctx.PARTICIPANT_ACTOR === 'function' &&
      ctx.PARTICIPANT_ACTOR()
    );
    const type = hasActor ? 'actor' : 'participant';

    // Extract the actor/participant id
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    // Extract alias if present (AS restOfLine)
    let alias = '';
    const hasAS = !!(ctx.AS && typeof ctx.AS === 'function' && ctx.AS());
    if (hasAS && ctx.restOfLine && typeof ctx.restOfLine === 'function' && ctx.restOfLine()) {
      const rol = ctx.restOfLine();
      alias = rol ? this.getContextText(rol).trim() : '';
    }

    if (participant) {
      // Build AST entry
      this.pushStatement({
        type: 'create',
        originalIndex: this.currentIndex++,
        data: { participant, alias: alias || undefined, type },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });

      // Create element mapping for bidirectional synchronization
      // Use full line mapping so cursor anywhere on the line highlights the participant
      // Note: Always use 'participant' for element mapping type because the SVG renderer
      // sets data-et="participant" for all participant types
      // No need to create separate alias mapping since full-line mapping covers the entire line
      const participantData: ParticipantData = { id: participant, alias: alias || undefined };
      this.createFullLineElementMapping('participant', ctx, participantData);
    }
    return '';
  }

  // Destroy statement
  visitDestroyStatement(ctx: DestroyStatementContext): string {
    log.debug('🎯 visitDestroyStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract the actor/participant id
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    if (participant) {
      // Build AST entry
      this.pushStatement({
        type: 'destroy',
        originalIndex: this.currentIndex++,
        data: { participant },
        sourceTokens: { start: ctx.start, stop: ctx.stop },
        sourceLine: this.getOriginalSourceFromCtx(ctx),
      });

      // Create element mapping for bidirectional synchronization
      // Use full line mapping so cursor anywhere on the line highlights the participant
      const participantData: ParticipantData = { id: participant };
      this.createFullLineElementMapping('participant', ctx, participantData);
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
      // Updated regex to handle:
      // 1. activation/deactivation markers (+ and -)
      // 2. central connection patterns: (), ()->, ->(), ()->()
      // 3. half-arrow types: -|\, -|/, -\\, -//, /|-, \|-, //-, \\-
      // Arrow types: ->, ->>, -->, -->>, -), --), -x, --x, <<->>, <<-->>

      // Define comprehensive arrow pattern including half-arrows
      // Order matters: longer patterns first to avoid partial matches
      const arrowPattern =
        '(<<-->>|<<->>|-->>|-->>|->>|-->|->|' + // Standard arrows
        '--x|--\\)|--\\\\\\\\|--\\/\\/|--\\|\\/|--\\|\\\\|' + // Dotted variants
        '-x|-\\)|-\\\\\\\\|-\\/\\/|-\\|\\/|-\\|\\\\|' + // Solid variants
        '\\/\\|--|\\\\\\|--|\\\\\\\\--|\\\\\\\\-|\\/\\/--|\\/\\/\\-|\\\\\\|-|\\/\\|-)'; // Reverse variants

      // Try central connection patterns first
      // Pattern 1: actor () signaltype () actor (CENTRAL_CONNECTION_DUAL)
      let signalMatch = new RegExp(`^(\\w+)\\(\\)${arrowPattern}\\(\\)(\\w+):(.*)$`).exec(fullText);
      let centralPattern: 'dual' | 'reverse' | 'forward' | null = null;

      if (signalMatch) {
        centralPattern = 'dual';
      } else {
        // Pattern 2: actor () signaltype actor (CENTRAL_CONNECTION_REVERSE)
        signalMatch = new RegExp(`^(\\w+)\\(\\)${arrowPattern}(\\w+):(.*)$`).exec(fullText);
        if (signalMatch) {
          centralPattern = 'reverse';
        } else {
          // Pattern 3: actor signaltype () actor (CENTRAL_CONNECTION)
          signalMatch = new RegExp(`^(\\w+)${arrowPattern}\\(\\)(\\w+):(.*)$`).exec(fullText);
          if (signalMatch) {
            centralPattern = 'forward';
          } else {
            // Standard pattern: actor signaltype [+-]? actor
            signalMatch = new RegExp(`^(\\w+)${arrowPattern}([+-]?)(\\w+):(.*)$`).exec(fullText);
          }
        }
      }

      log.debug('  - Regex match result:', signalMatch);
      log.debug('  - Central pattern:', centralPattern);

      if (signalMatch) {
        let from: string,
          arrow: string,
          to: string,
          message: string,
          activationMarker = '';

        if (centralPattern === 'dual') {
          // Pattern: actor () arrow () actor
          [, from, arrow, to, message] = signalMatch;
          arrow = `()${arrow}()`;
        } else if (centralPattern === 'reverse') {
          // Pattern: actor () arrow actor
          [, from, arrow, to, message] = signalMatch;
          arrow = `()${arrow}`;
        } else if (centralPattern === 'forward') {
          // Pattern: actor arrow () actor
          [, from, arrow, to, message] = signalMatch;
          arrow = `${arrow}()`;
        } else {
          // Standard pattern
          [, from, arrow, activationMarker, to, message] = signalMatch;
        }

        const cleanMessage = message.trim();
        const fullArrow = centralPattern ? arrow : arrow + activationMarker;

        // Emit exact original text (preserves spaces and colon spacing)
        this.emitOriginalSegmentFromCtx(ctx);

        // Build AST entry
        const messageData: MessageData = { from, arrow: fullArrow, to, message: cleanMessage };
        // Capture the DB index before incrementing dbIndex
        const currentDbIndex = this.dbIndex;
        this.pushStatement({
          type: 'message',
          originalIndex: this.currentIndex++,
          dbIndex: this.dbIndex++,
          data: messageData,
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: this.getOriginalSourceFromCtx(ctx),
        });

        // Create fine-grained element mappings for each component
        log.debug('  - Creating fine-grained element mappings with DB index:', currentDbIndex);
        this.createFineGrainedMessageMappingsFromTokens(
          ctx,
          from,
          fullArrow,
          to,
          cleanMessage,
          messageData,
          currentDbIndex
        );

        // Handle activation/deactivation markers
        // When a message has + or -, the DB creates TWO entries:
        // 1. The message itself
        // 2. An ACTIVE_START or ACTIVE_END signal
        // So we need to increment dbIndex again to stay in sync with the DB
        if (activationMarker === '+') {
          log.debug('  - Message has activation marker (+), incrementing dbIndex for ACTIVE_START');
          this.dbIndex++;
        } else if (activationMarker === '-') {
          log.debug('  - Message has deactivation marker (-), incrementing dbIndex for ACTIVE_END');
          this.dbIndex++;
        }

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

    // Capture the DB index before incrementing dbIndex
    const currentDbIndex = this.dbIndex;
    this.pushStatement({
      type: 'note',
      originalIndex: this.currentIndex++,
      dbIndex: this.dbIndex++,
      data: noteData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('note', ctx, noteData, currentDbIndex);

    return '';
  }

  // Loop block
  visitLoopBlock(ctx: LoopBlockContext): string {
    // 1) Build AST for the loop (condition + nested statements)
    const condition =
      typeof ctx.restOfLine === 'function' && ctx.restOfLine()
        ? this.getContextText(ctx.restOfLine() ?? undefined).trim()
        : '';

    // Increment dbIndex for LOOP_START marker (matches DB behavior)
    this.dbIndex++;

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

    const loopData: LoopData = { condition, statements: nested };
    this.pushStatement({
      type: 'loop',
      originalIndex: this.currentIndex++,
      data: loopData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('loop', ctx, loopData);

    // Increment dbIndex for LOOP_END marker
    this.dbIndex++;

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
    // 1) Build AST for the opt block (condition + nested statements)
    const condition =
      typeof ctx.restOfLine === 'function' && ctx.restOfLine()
        ? this.getContextText(ctx.restOfLine() ?? undefined).trim()
        : '';

    // Increment dbIndex for OPT_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect nested statements while suppressing emission
    const nested: SequenceStatement[] = [];
    this.blockStack.push({ type: 'opt', statements: nested });
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

    const optData: OptData = { condition, statements: nested };
    this.pushStatement({
      type: 'opt',
      originalIndex: this.currentIndex++,
      data: optData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('opt', ctx, optData);

    // Increment dbIndex for OPT_END marker
    this.dbIndex++;

    // 2) Emit the entire opt block exactly as in the source for code reproduction
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

  // Alt block
  visitAltBlock(ctx: AltBlockContext): string {
    // 1) Build AST for the alt block (condition + nested statements + else sections)
    const condition =
      typeof ctx.restOfLine === 'function' && ctx.restOfLine()
        ? this.getContextText(ctx.restOfLine() ?? undefined).trim()
        : '';

    // Increment dbIndex for ALT_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect nested statements for the main alt branch
    const nested: SequenceStatement[] = [];
    this.blockStack.push({ type: 'alt', statements: nested });
    const prevSuppress = this.suppressEmission;
    this.suppressEmission = true;

    try {
      // Visit the altSections which contains the main document and else sections
      if (typeof ctx.altSections === 'function' && ctx.altSections()) {
        this.visit(ctx.altSections());
      } else {
        this.visitChildren(ctx);
      }
    } finally {
      this.suppressEmission = prevSuppress;
      this.blockStack.pop();
    }

    const altData: AltData = { condition, statements: [...nested], elseStatements: [] };
    this.pushStatement({
      type: 'alt',
      originalIndex: this.currentIndex++,
      data: altData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('alt', ctx, altData);

    // Increment dbIndex for ALT_END marker
    this.dbIndex++;

    // 2) Emit the entire alt block exactly as in the source for code reproduction
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

  // Else section within alt block
  visitElseSection(ctx: ElseSectionContext): string {
    // Increment dbIndex for ALT_ELSE marker (matches DB behavior)
    this.dbIndex++;

    // Visit the document inside the else section to process nested statements
    // The emission is suppressed by the parent alt block, so we just need to
    // ensure the nested statements are visited for element mapping creation
    if (typeof ctx.document === 'function' && ctx.document()) {
      this.visit(ctx.document());
    } else {
      this.visitChildren(ctx);
    }
    return '';
  }

  // Par block
  visitParBlock(ctx: ParBlockContext): string {
    // 1) Build AST for the par block (sections with nested statements)
    const fullText = ctx.getText ? ctx.getText() : '';
    const parMatch = /^par\s+(.+?)(?:\n|$)/s.exec(fullText);
    const condition = parMatch?.[1]?.trim() ?? '';

    // Increment dbIndex for PAR_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect sections (par has multiple sections separated by 'and')
    const sections: SequenceStatement[][] = [];

    // Collect nested statements for the first section while suppressing emission
    const firstSection: SequenceStatement[] = [];
    sections.push(firstSection);
    this.sectionStack.push(sections);
    this.blockStack.push({ type: 'par', statements: firstSection });
    const prevSuppress = this.suppressEmission;
    this.suppressEmission = true;

    try {
      // Visit parSections which contains the main document and 'and' sections
      if (typeof ctx.parSections === 'function' && ctx.parSections()) {
        this.visit(ctx.parSections());
      } else {
        this.visitChildren(ctx);
      }
    } finally {
      this.suppressEmission = prevSuppress;
      this.blockStack.pop();
      this.sectionStack.pop();
    }

    const parData = { condition, statements: sections };
    this.pushStatement({
      type: 'par',
      originalIndex: this.currentIndex++,
      data: parData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('par', ctx, parData);

    // Increment dbIndex for PAR_END marker
    this.dbIndex++;

    // 2) Emit the entire par block exactly as in the source for code reproduction
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

  // And section within par block
  visitAndSection(ctx: AndSectionContext): string {
    // Increment dbIndex for PAR_AND marker (matches DB behavior)
    this.dbIndex++;

    // Create a new section for the 'and' branch
    const newSection: SequenceStatement[] = [];

    // Add the new section to the current sections array
    const currentSections = this.sectionStack[this.sectionStack.length - 1];
    if (currentSections) {
      currentSections.push(newSection);

      // Switch to collecting statements for the new section
      this.blockStack.pop();
      this.blockStack.push({ type: 'par', statements: newSection });

      // Visit the document inside the 'and' section
      if (typeof ctx.document === 'function' && ctx.document()) {
        this.visit(ctx.document());
      } else {
        this.visitChildren(ctx);
      }
    }

    return '';
  }

  // Rect block
  visitRectBlock(ctx: RectBlockContext): string {
    // 1) Build AST for the rect block (color + nested statements)
    const fullText = ctx.getText ? ctx.getText() : '';
    const rectMatch = /^rect\s+(?:rgb\(([^)]+)\))?/.exec(fullText);
    const color = rectMatch?.[1]?.trim();

    // Increment dbIndex for RECT_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect nested statements while suppressing emission
    const nested: SequenceStatement[] = [];
    this.blockStack.push({ type: 'rect', statements: nested });
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

    const rectData = { color, statements: nested };
    this.pushStatement({
      type: 'rect',
      originalIndex: this.currentIndex++,
      data: rectData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('rect', ctx, rectData);

    // Increment dbIndex for RECT_END marker
    this.dbIndex++;

    // 2) Emit the entire rect block exactly as in the source for code reproduction
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
  visitBreakBlock(ctx: BreakBlockContext): string {
    // 1) Build AST for the break block (condition + nested statements)
    const restOfLineCtx = ctx.restOfLine();
    const condition = restOfLineCtx ? this.getContextText(restOfLineCtx).trim() : '';

    // Increment dbIndex for BREAK_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect nested statements while suppressing emission
    const nested: SequenceStatement[] = [];
    this.blockStack.push({ type: 'break', statements: nested });
    const prevSuppress = this.suppressEmission;
    this.suppressEmission = true;
    try {
      // Break block has a document child with nested statements
      const docCtx = ctx.document();
      if (docCtx) {
        this.visit(docCtx);
      } else {
        this.visitChildren(ctx);
      }
    } finally {
      this.suppressEmission = prevSuppress;
      this.blockStack.pop();
    }

    const breakData = { condition, statements: nested };
    this.pushStatement({
      type: 'break',
      originalIndex: this.currentIndex++,
      data: breakData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('break', ctx, breakData);

    // Increment dbIndex for BREAK_END marker
    this.dbIndex++;

    // 2) Emit the entire break block exactly as in the source for code reproduction
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

  // Critical block
  visitCriticalBlock(ctx: CriticalBlockContext): string {
    // 1) Build AST for the critical block (sections with nested statements)
    const restOfLineCtx = ctx.restOfLine();
    const condition = restOfLineCtx ? this.getContextText(restOfLineCtx).trim() : '';

    // Increment dbIndex for CRITICAL_START marker (matches DB behavior)
    this.dbIndex++;

    // Collect sections (critical has multiple sections separated by 'option')
    const sections: SequenceStatement[][] = [];

    // Collect nested statements for the first section while suppressing emission
    const firstSection: SequenceStatement[] = [];
    sections.push(firstSection);
    this.sectionStack.push(sections);
    this.blockStack.push({ type: 'critical', statements: firstSection });
    const prevSuppress = this.suppressEmission;
    this.suppressEmission = true;

    try {
      // Visit optionSections which contains the main document and 'option' sections
      const optionSectionsCtx = ctx.optionSections();
      if (optionSectionsCtx) {
        this.visit(optionSectionsCtx);
      } else {
        this.visitChildren(ctx);
      }
    } finally {
      this.suppressEmission = prevSuppress;
      this.blockStack.pop();
      this.sectionStack.pop();
    }

    const criticalData = { condition, statements: sections };
    this.pushStatement({
      type: 'critical',
      originalIndex: this.currentIndex++,
      data: criticalData,
      sourceTokens: { start: ctx.start, stop: ctx.stop },
      sourceLine: this.getOriginalSourceFromCtx(ctx),
    });
    this.createElementMapping('critical', ctx, criticalData);

    // Increment dbIndex for CRITICAL_END marker
    this.dbIndex++;

    // 2) Emit the entire critical block exactly as in the source for code reproduction
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

  // Option section within critical block
  visitOptionSection(ctx: OptionSectionContext): string {
    // Increment dbIndex for CRITICAL_OPTION marker (matches DB behavior)
    this.dbIndex++;

    // Create a new section for the 'option' branch
    const newSection: SequenceStatement[] = [];

    // Add the new section to the current sections array
    const currentSections = this.sectionStack[this.sectionStack.length - 1];
    if (currentSections) {
      currentSections.push(newSection);

      // Switch to collecting statements for the new section
      this.blockStack.pop();
      this.blockStack.push({ type: 'critical', statements: newSection });

      // Visit the document inside the 'option' section
      if (typeof ctx.document === 'function' && ctx.document()) {
        this.visit(ctx.document());
      } else {
        this.visitChildren(ctx);
      }
    }

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
    log.debug('🎯 visitLinksStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract the actor/participant
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    // Extract the links text (text2 includes the leading ':' so we need to strip it)
    const text2Ctx = typeof ctx.text2 === 'function' ? ctx.text2() : undefined;
    let linksStr = text2Ctx ? this.getContextText(text2Ctx).trim() : '';
    // Remove leading ':' if present
    if (linksStr.startsWith(':')) {
      linksStr = linksStr.substring(1).trim();
    }

    if (participant && linksStr) {
      // Parse links as key-value pairs separated by commas
      // Format: "key1: value1, key2: value2"
      const links: Record<string, string> = {};
      const linkPairs = linksStr.split(',');
      for (const pair of linkPairs) {
        // Split only on the first colon to handle URLs with ://
        const colonIndex = pair.indexOf(':');
        if (colonIndex > 0) {
          const key = pair.substring(0, colonIndex).trim();
          const value = pair.substring(colonIndex + 1).trim();
          if (key && value) {
            links[key] = value;
          }
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
    log.debug('🎯 visitLinkStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract the actor/participant
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    // Extract the link text (text2 includes the leading ':' so we need to strip it)
    const text2Ctx = typeof ctx.text2 === 'function' ? ctx.text2() : undefined;
    let linkText = text2Ctx ? this.getContextText(text2Ctx).trim() : '';
    // Remove leading ':' if present
    if (linkText.startsWith(':')) {
      linkText = linkText.substring(1).trim();
    }

    if (participant && linkText) {
      // Parse link format: "linkName @ linkUrl"
      const linkMatch = /^(.+?)\s*@\s*(.+)$/.exec(linkText);
      if (linkMatch) {
        const [, linkName, linkUrl] = linkMatch;
        this.pushStatement({
          type: 'link',
          originalIndex: this.currentIndex++,
          data: { participant, linkName: linkName.trim(), linkUrl: linkUrl.trim() },
          sourceTokens: { start: ctx.start, stop: ctx.stop },
          sourceLine: this.getOriginalSourceFromCtx(ctx),
        });
      }
    }
    return '';
  }

  // Properties statement
  visitPropertiesStatement(ctx: PropertiesStatementContext): string {
    log.debug('🎯 visitPropertiesStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract the actor/participant
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    // Extract the properties text (text2 includes the leading ':' so we need to strip it)
    const text2Ctx = typeof ctx.text2 === 'function' ? ctx.text2() : undefined;
    let propertiesStr = text2Ctx ? this.getContextText(text2Ctx).trim() : '';
    // Remove leading ':' if present
    if (propertiesStr.startsWith(':')) {
      propertiesStr = propertiesStr.substring(1).trim();
    }

    if (participant && propertiesStr) {
      // Parse properties as key-value pairs separated by commas
      // Format: "key1: value1, key2: value2"
      const properties: Record<string, string> = {};
      const propPairs = propertiesStr.split(',');
      for (const pair of propPairs) {
        // Split only on the first colon to handle values with colons
        const colonIndex = pair.indexOf(':');
        if (colonIndex > 0) {
          const key = pair.substring(0, colonIndex).trim();
          const value = pair.substring(colonIndex + 1).trim();
          if (key && value) {
            properties[key] = value;
          }
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
    log.debug('🎯 visitDetailsStatement:', ctx);
    this.emitOriginalSegmentFromCtx(ctx);

    // Extract the actor/participant
    const actorCtx = typeof ctx.actor === 'function' ? ctx.actor() : undefined;
    const participant = actorCtx ? this.getContextText(actorCtx).trim() : '';

    // Extract the details text (text2 includes the leading ':' so we need to strip it)
    const text2Ctx = typeof ctx.text2 === 'function' ? ctx.text2() : undefined;
    let details = text2Ctx ? this.getContextText(text2Ctx).trim() : '';
    // Remove leading ':' if present
    if (details.startsWith(':')) {
      details = details.substring(1).trim();
    }

    if (participant && details) {
      this.pushStatement({
        type: 'details',
        originalIndex: this.currentIndex++,
        data: { participant, details },
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

    // Create element mapping for bidirectional synchronization
    // Use full line mapping so cursor anywhere on the line highlights the participant
    if (participant) {
      const participantData: ParticipantData = { id: participant };
      this.createFullLineElementMapping('participant', ctx, participantData);
    }

    // Increment dbIndex for ACTIVE_START or ACTIVE_END marker (matches DB behavior)
    // The DB adds an entry to the messages array for both activate and deactivate
    this.dbIndex++;

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

      // Increment dbIndex because the DB adds an entry to the messages array for autonumber
      // This ensures subsequent messages have the correct dbIndex that matches the renderer's data-id
      log.debug('  - Autonumber statement increments dbIndex');
      this.dbIndex++;
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
    return this.visitChildren(ctx) ?? '';
  }

  visitConfigObject(ctx: ConfigObjectContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitSignaltype(ctx: SignaltypeContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitText2(ctx: Text2Context): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitRestOfLine(ctx: RestOfLineContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitAltSections(ctx: AltSectionsContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitParSections(ctx: ParSectionsContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitOptionSections(ctx: OptionSectionsContext): string {
    return this.visitChildren(ctx) ?? '';
  }

  visitActor(ctx: ActorContext): string {
    return this.visitChildren(ctx) ?? '';
  }
}
