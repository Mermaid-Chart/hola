import type { SequenceParserVisitor } from './generated/SequenceParserVisitor.js';
import type { SequenceDB } from '../../sequenceDb.js';
import type { ParseTree, TerminalNode, ErrorNode } from 'antlr4ng';
import { SequenceParserCore } from './SequenceParserCore.js';

/**
 * Visitor implementation that builds the sequence diagram model
 * Uses the same core logic as the Listener for compatibility
 */
export class SequenceVisitor extends SequenceParserCore implements SequenceParserVisitor<void> {
  private visitCount = 0;
  private performanceLog: Record<string, { count: number; totalTime: number }> = {};

  constructor(db: SequenceDB) {
    super(db);
    // Only log for debug mode
    if (this.getEnvVar('ANTLR_DEBUG') === 'true') {
      // eslint-disable-next-line no-console
      console.log('🎯 SequenceVisitor: Constructor called');
    }
  }

  // Default visit method
  visit(tree: ParseTree): void {
    this.visitCount++;
    const startTime = performance.now();

    try {
      tree.accept(this);

      // Performance tracking for debug mode
      if (this.getEnvVar('ANTLR_DEBUG') === 'true') {
        const endTime = performance.now();
        const duration = endTime - startTime;
        const ruleName = tree.constructor.name;

        if (!this.performanceLog[ruleName]) {
          this.performanceLog[ruleName] = { count: 0, totalTime: 0 };
        }
        this.performanceLog[ruleName].count++;
        this.performanceLog[ruleName].totalTime += duration;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('❌ SequenceVisitor: Error visiting node:', error);
      throw error;
    }
  }

  // Default visit methods
  visitChildren(node: ParseTree): void {
    if (!node?.children) {
      return;
    }

    for (const child of node.children) {
      child.accept(this);
    }
  }

  visitTerminal(_node: TerminalNode): void {
    // Terminal nodes don't need processing
  }

  visitErrorNode(_node: ErrorNode): void {
    // eslint-disable-next-line no-console
    console.log('❌ SequenceVisitor: Error node encountered');
    // Throw error to match Jison parser behavior for syntax errors
    throw new Error('Syntax error in sequence diagram');
  }

  // Loop block visitors
  visitLoopBlock(ctx: ParseTree): void {
    this.processLoopBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processLoopBlockExit();
  }

  // Participant statement visitors
  visitParticipantStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processParticipantStatement(ctx);
  }

  // Create statement visitors
  visitCreateStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processCreateStatement(ctx);
  }

  // Destroy statement visitors
  visitDestroyStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processDestroyStatement(ctx);
  }

  // Opt block visitors
  visitOptBlock(ctx: ParseTree): void {
    this.processOptBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processOptBlockExit();
  }

  // Alt block visitors
  visitAltBlock(ctx: ParseTree): void {
    this.processAltBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processAltBlockExit();
  }

  visitElseSection(ctx: ParseTree): void {
    this.processElseSection(ctx);
    this.visitChildren(ctx);
  }

  // Par block visitors
  visitParBlock(ctx: ParseTree): void {
    this.processParBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processParBlockExit();
  }

  visitAndSection(ctx: ParseTree): void {
    this.processAndSection(ctx);
    this.visitChildren(ctx);
  }

  // ParOver block visitors
  visitParOverBlock(ctx: ParseTree): void {
    this.processParOverBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processParOverBlockExit();
  }

  // Rect block visitors
  visitRectBlock(ctx: ParseTree): void {
    this.processRectBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processRectBlockExit();
  }

  // Box block visitors
  visitBoxBlock(ctx: ParseTree): void {
    this.processBoxBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processBoxBlockExit();
  }

  // Break block visitors
  visitBreakBlock(ctx: ParseTree): void {
    this.processBreakBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processBreakBlockExit();
  }

  // Critical block visitors
  visitCriticalBlock(ctx: ParseTree): void {
    this.processCriticalBlockEnter(ctx);
    this.visitChildren(ctx);
    this.processCriticalBlockExit();
  }

  visitOptionSection(ctx: ParseTree): void {
    this.processOptionSection(ctx);
    this.visitChildren(ctx);
  }

  // Signal statement visitors
  visitSignalStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processSignalStatement(ctx);
  }

  // Note statement visitors
  visitNoteStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processNoteStatement(ctx);
  }

  // Links statement visitors
  visitLinksStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processLinksStatement(ctx);
  }

  // Link statement visitors
  visitLinkStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processLinkStatement(ctx);
  }

  // Properties statement visitors
  visitPropertiesStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processPropertiesStatement(ctx);
  }

  // Details statement visitors
  visitDetailsStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processDetailsStatement(ctx);
  }

  // Activation statement visitors
  visitActivationStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processActivationStatement(ctx);
  }

  // Autonumber statement visitors
  visitAutonumberStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processAutonumberStatement(ctx);
  }

  // Title statement visitors
  visitTitleStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processTitleStatement(ctx);
  }

  // Legacy title statement visitors
  visitLegacyTitleStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processLegacyTitleStatement(ctx);
  }

  // Accessibility title statement visitors
  visitAccTitleStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processAccTitleStatement(ctx);
  }

  // Accessibility description statement visitors
  visitAccDescrStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processAccDescrStatement(ctx);
  }

  // Accessibility multiline description statement visitors
  visitAccDescrMultilineStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
    this.processAccDescrMultilineStatement(ctx);
  }

  // Default visitors for other rules
  visitStart(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitDocument(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitLine(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitStatement(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitActorWithConfig(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitConfigObject(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitSignaltype(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitText2(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitRestOfLine(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitAltSections(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitParSections(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitOptionSections(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }

  visitActor(ctx: ParseTree): void {
    this.visitChildren(ctx);
  }
}
