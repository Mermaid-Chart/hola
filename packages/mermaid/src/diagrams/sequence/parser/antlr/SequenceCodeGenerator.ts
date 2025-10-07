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

    // Add the header
    this.addRawLine('sequenceDiagram');

    // Visit header first (if any)
    if (ctx.header?.()) {
      this.visit(ctx.header());
    }

    // Visit document content
    if (ctx.document?.()) {
      this.visit(ctx.document());
    }

    console.log('📋 Final generated lines:', this.lines);
    return '';
  }

  // Header - handle front matter, comments, etc.
  visitHeader(ctx: any): string {
    // Process header directives, front matter, etc.
    if (ctx.children) {
      for (const child of ctx.children) {
        const text = this.getContextText(child);
        if (text && text.trim() !== '' && text !== '\n') {
          this.addRawLine(text);
        }
      }
    }
    return '';
  }

  // Document - main content
  visitDocument(ctx: any): string {
    this.visitChildren(ctx);
    return '';
  }

  // Line - individual lines in the document
  visitLine(ctx: any): string {
    this.visitChildren(ctx);
    return '';
  }
  // Comment statement (%% ...)
  visitCommentStatement(ctx: any): string {
    const text = ctx.getText ? ctx.getText() : '%%';
    this.addLineWithCtxIndent(text, ctx);
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
        const line = alias ? `${keyword} ${id} as ${alias}` : `${keyword} ${id}`;
        this.addLineWithCtxIndent(line, ctx);

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

    // Fallback: parse compacted text (e.g., 'actorAlice' or 'participantBob') from ctx.getText()
    const fullText = ctx.getText ? ctx.getText() : '';
    console.log('  - Full participant text (fallback):', fullText);
    if (fullText) {
      let id = '';
      let alias = '';
      let keyword = 'participant';

      const aliasMatch = fullText.match(/^(participant|actor)(\w+)as(.+)$/);
      if (aliasMatch) {
        [, keyword, id, alias] = aliasMatch;
        alias = alias.trim();
        this.addLineWithCtxIndent(`${keyword} ${id} as ${alias}`, ctx);
      } else {
        const simpleMatch = fullText.match(/^(participant|actor)(\w+)$/);
        if (simpleMatch) {
          [, keyword, id] = simpleMatch;
          this.addLineWithCtxIndent(`${keyword} ${id}`, ctx);
        } else {
          // Final fallback: add as-is with inferred indentation
          this.addLineWithCtxIndent(fullText, ctx);
          return '';
        }
      }

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
      console.log('📝 Added participant to AST (fallback):', participantData);
    }

    return '';
  }

  // Create statement
  visitCreateStatement(ctx: any): string {
    console.log('🎯 visitCreateStatement:', ctx);
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Destroy statement
  visitDestroyStatement(ctx: any): string {
    console.log('🎯 visitDestroyStatement:', ctx);
    const text = this.getContextText(ctx);
    this.addLine(text);
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
        this.addLineWithCtxIndent(`${from}${fullArrow}${to}: ${cleanMessage}`, ctx);

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
        // Fallback: just use the text as-is with proper indentation
        this.addLineWithCtxIndent(fullText, ctx);
      }
    }

    return '';
  }

  // Note statement
  visitNoteStatement(ctx: any): string {
    console.log('🎯 visitNoteStatement:', ctx);

    // Use the simpler approach: get the full text and clean it up
    const fullText = ctx.getText ? ctx.getText() : '';
    console.log('  - Full note text:', fullText);

    if (fullText) {
      // Parse the note pattern: Note + position + of + participant + : + message
      // Handle both with and without spaces: "Noteright ofBob:" or "Note right of Bob:"
      const noteMatch = fullText.match(/^note\s*(left|right|over)\s*of\s*(\w+)\s*:\s*(.+)$/i);
      if (noteMatch) {
        const [, position, participant, message] = noteMatch;
        this.addLine(`Note ${position} of ${participant}: ${message.trim()}`);

        // Build AST entry and create mapping
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

        // Create element mapping for bidirectional synchronization
        this.createElementMapping('note', ctx, noteData);
        console.log('📝 Added note to AST and created mapping:', noteData);
      } else {
        console.log('⚠️ Note pattern did not match, using fallback');
        // Fallback: just use the text as-is with proper indentation
        this.addLineWithCtxIndent(fullText, ctx);
      }
    }

    return '';
  }

  // Loop block
  visitLoopBlock(ctx: any): string {
    console.log('🎯 visitLoopBlock:', ctx);

    // Use the simpler approach: get the full text and extract loop condition
    const fullText = ctx.getText ? ctx.getText() : '';
    console.log('  - Full loop text:', fullText);

    let condition = '';
    if (fullText) {
      // Extract the loop condition - everything between "loop" and the first statement
      const loopMatch = fullText.match(/^loop\s*(.+?)(?=\w+(?:->|-->>|->>|-->)|$)/);
      if (loopMatch) {
        condition = loopMatch[1].trim();
        this.addLine(`loop ${condition}`);
      } else {
        this.addLine('loop');
      }
    }

    // Create element mapping for control structure
    const loopData = {
      structureType: 'loop',
      condition,
    };
    this.createElementMapping('controlStructure', ctx, loopData);
    console.log('📝 Added loop control structure to mappings');

    this.indent();

    // Visit children (content inside loop)
    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Opt block
  visitOptBlock(ctx: any): string {
    const optText = this.getContextText(ctx);
    const optMatch = /opt\s+(.+?)(?=\s|$)/.exec(optText);
    const condition = optMatch ? optMatch[1] : '';

    this.addLine(`opt ${condition}`);

    // Create element mapping for control structure
    const optData = {
      structureType: 'opt',
      condition,
    };
    this.createElementMapping('controlStructure', ctx, optData);
    console.log('📝 Added opt control structure to mappings');

    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Alt block
  visitAltBlock(ctx: any): string {
    const altText = this.getContextText(ctx);
    const altMatch = /alt\s+(.+?)(?=\s|$)/.exec(altText);
    const condition = altMatch ? altMatch[1] : '';

    this.addLine(`alt ${condition}`);

    // Create element mapping for control structure
    const altData = {
      structureType: 'alt',
      condition,
    };
    this.createElementMapping('controlStructure', ctx, altData);
    console.log('📝 Added alt control structure to mappings');

    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Else section within alt block
  visitElseSection(ctx: any): string {
    this.unindent();

    const elseText = this.getContextText(ctx);
    const elseMatch = /else\s+(.+?)(?=\s|$)/.exec(elseText);
    const condition = elseMatch ? elseMatch[1] : '';

    this.addLine(`else ${condition}`);
    this.indent();

    this.visitChildren(ctx);
    return '';
  }

  // Par block
  visitParBlock(ctx: any): string {
    const parText = this.getContextText(ctx);
    const parMatch = /par\s+(.+?)(?=\s|$)/.exec(parText);
    const condition = parMatch ? parMatch[1] : '';

    this.addLine(`par ${condition}`);
    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // And section within par block
  visitAndSection(ctx: any): string {
    this.unindent();

    const andText = this.getContextText(ctx);
    const andMatch = /and\s+(.+?)(?=\s|$)/.exec(andText);
    const condition = andMatch ? andMatch[1] : '';

    this.addLine(`and ${condition}`);
    this.indent();

    this.visitChildren(ctx);
    return '';
  }

  // Rect block
  visitRectBlock(ctx: any): string {
    const rectText = this.getContextText(ctx);
    const rectMatch = /rect\s+(.+?)(?=\s|$)/.exec(rectText);
    const style = rectMatch ? rectMatch[1] : '';

    this.addLine(`rect ${style}`);
    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Box block
  visitBoxBlock(ctx: any): string {
    // Re-emit the exact opening line from the original source (preserves label and indentation)
    const openLine = this.getOriginalLine(ctx.start.line).replace(/\r?$/g, '');
    this.addRawLine(openLine);

    // Do not apply structural indentation here; children already use ctx.start.column
    // to restore original indentation via addLineWithCtxIndent.
    this.visitChildren(ctx);

    // Re-emit the exact closing 'end' line from the original source
    const endLine = this.getOriginalLine(ctx.stop.line).replace(/\r?$/g, '');
    this.addRawLine(endLine);
    return '';
  }

  // Break block
  visitBreakBlock(ctx: any): string {
    const breakText = this.getContextText(ctx);
    const breakMatch = /break\s+(.+?)(?=\s|$)/.exec(breakText);
    const condition = breakMatch ? breakMatch[1] : '';

    this.addLine(`break ${condition}`);
    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Critical block
  visitCriticalBlock(ctx: any): string {
    const criticalText = this.getContextText(ctx);
    const criticalMatch = /critical\s+(.+?)(?=\s|$)/.exec(criticalText);
    const condition = criticalMatch ? criticalMatch[1] : '';

    this.addLine(`critical ${condition}`);
    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Option section within critical block
  visitOptionSection(ctx: any): string {
    this.unindent();

    const optionText = this.getContextText(ctx);
    const optionMatch = /option\s+(.+?)(?=\s|$)/.exec(optionText);
    const condition = optionMatch ? optionMatch[1] : '';

    this.addLine(`option ${condition}`);
    this.indent();

    this.visitChildren(ctx);
    return '';
  }

  // ParOver block
  visitParOverBlock(ctx: any): string {
    const parOverText = this.getContextText(ctx);
    const parOverMatch = /par\s+over\s+(.+?)(?=\s|$)/.exec(parOverText);
    const participants = parOverMatch ? parOverMatch[1] : '';

    this.addLine(`par over ${participants}`);
    this.indent();

    this.visitChildren(ctx);

    this.unindent();
    this.addLine('end');
    return '';
  }

  // Links statement
  visitLinksStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Link statement
  visitLinkStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Properties statement
  visitPropertiesStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Details statement
  visitDetailsStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Activation statement (activate/deactivate)
  visitActivationStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Autonumber statement
  visitAutonumberStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Title statement
  visitTitleStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Legacy title statement
  visitLegacyTitleStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Accessibility title statement
  visitAccTitleStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Accessibility description statement
  visitAccDescrStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
    return '';
  }

  // Accessibility multiline description statement
  visitAccDescrMultilineStatement(ctx: any): string {
    const text = this.getContextText(ctx);
    this.addLine(text);
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
