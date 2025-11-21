import { SequenceParserVisitor } from './generated/SequenceParserVisitor.js';
import type { SequenceDB } from '../../sequenceDb.js';
import type { ParseTree, TerminalNode, ErrorNode } from 'antlr4ng';
import { SequenceParserCore } from './SequenceParserCore.js';
import { log } from '../../../../logger.js';

/**
 * Visitor implementation that builds the sequence diagram model
 * Uses the same core logic as the Listener for compatibility
 */
export class SequenceVisitor extends SequenceParserVisitor<void> {
  private core: SequenceParserCore;
  private visitCount = 0;
  private performanceLog: Record<string, { count: number; totalTime: number }> = {};

  constructor(db: SequenceDB) {
    super();
    this.core = new SequenceParserCore(db);
    log.debug('🎯 SequenceVisitor: Constructor called');
  }

  // Override default result to return void
  protected defaultResult(): void {
    return undefined;
  }

  // Override shouldVisitNextChild to always return true
  protected shouldVisitNextChild(_node: ParseTree, _currentResult: void): boolean {
    return true;
  }

  // Override aggregateResult to return void
  protected aggregateResult(_aggregate: void, _nextResult: void): void {
    return undefined;
  }

  // Default visit method
  visit(tree: ParseTree): void {
    this.visitCount++;
    const startTime = performance.now();

    try {
      tree.accept(this);

      // Performance tracking
      const endTime = performance.now();
      const duration = endTime - startTime;
      const ruleName = tree.constructor.name;

      if (!this.performanceLog[ruleName]) {
        this.performanceLog[ruleName] = { count: 0, totalTime: 0 };
      }
      this.performanceLog[ruleName].count++;
      this.performanceLog[ruleName].totalTime += duration;
    } catch (error) {
      log.debug('❌ SequenceVisitor: Error visiting node:', error);
      throw error;
    }
  }

  // Default visit methods
  visitChildren(node: ParseTree): void {
    const childCount = node.getChildCount();
    if (childCount === 0) {
      return;
    }

    for (let i = 0; i < childCount; i++) {
      const child = node.getChild(i);
      if (child) {
        child.accept(this);
      }
    }
  }

  visitTerminal(_node: TerminalNode): void {
    // Terminal nodes don't need processing
  }

  visitErrorNode(_node: ErrorNode): void {
    // Error nodes are created when ANTLR encounters a syntax error
    // The error details are captured by the SequenceErrorListener in the parser
    // and will be thrown after parsing completes, so we don't need to throw here
    log.debug('❌ SequenceVisitor: Error node encountered');
  }

  // Loop block visitors
  visitLoopBlock = (ctx: ParseTree): void => {
    this.core.processLoopBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processLoopBlockExit();
  };

  // Participant statement visitors
  visitParticipantStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processParticipantStatement(ctx);
  };

  // Create statement visitors
  visitCreateStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processCreateStatement(ctx);
  };

  // Destroy statement visitors
  visitDestroyStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processDestroyStatement(ctx);
  };

  // Opt block visitors
  visitOptBlock = (ctx: ParseTree): void => {
    this.core.processOptBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processOptBlockExit();
  };

  // Alt block visitors
  visitAltBlock = (ctx: ParseTree): void => {
    this.core.processAltBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processAltBlockExit();
  };

  visitElseSection = (ctx: ParseTree): void => {
    this.core.processElseSection(ctx);
    this.visitChildren(ctx);
  };

  // Par block visitors
  visitParBlock = (ctx: ParseTree): void => {
    this.core.processParBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processParBlockExit();
  };

  visitAndSection = (ctx: ParseTree): void => {
    this.core.processAndSection(ctx);
    this.visitChildren(ctx);
  };

  // ParOver block visitors
  visitParOverBlock = (ctx: ParseTree): void => {
    this.core.processParOverBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processParOverBlockExit();
  };

  // Rect block visitors
  visitRectBlock = (ctx: ParseTree): void => {
    this.core.processRectBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processRectBlockExit();
  };

  // Box block visitors
  visitBoxBlock = (ctx: ParseTree): void => {
    this.core.processBoxBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processBoxBlockExit();
  };

  // Break block visitors
  visitBreakBlock = (ctx: ParseTree): void => {
    this.core.processBreakBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processBreakBlockExit();
  };

  // Critical block visitors
  visitCriticalBlock = (ctx: ParseTree): void => {
    this.core.processCriticalBlockEnter(ctx);
    this.visitChildren(ctx);
    this.core.processCriticalBlockExit();
  };

  visitOptionSection = (ctx: ParseTree): void => {
    this.core.processOptionSection(ctx);
    this.visitChildren(ctx);
  };

  // Signal statement visitors
  visitSignalStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processSignalStatement(ctx);
  };

  // Note statement visitors
  visitNoteStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processNoteStatement(ctx);
  };

  // Links statement visitors
  visitLinksStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processLinksStatement(ctx);
  };

  // Link statement visitors
  visitLinkStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processLinkStatement(ctx);
  };

  // Properties statement visitors
  visitPropertiesStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processPropertiesStatement(ctx);
  };

  // Details statement visitors
  visitDetailsStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processDetailsStatement(ctx);
  };

  // Activation statement visitors
  visitActivationStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processActivationStatement(ctx);
  };

  // Autonumber statement visitors
  visitAutonumberStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processAutonumberStatement(ctx);
  };

  // Title statement visitors
  visitTitleStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processTitleStatement(ctx);
  };

  // Legacy title statement visitors
  visitLegacyTitleStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processLegacyTitleStatement(ctx);
  };

  // Accessibility title statement visitors
  visitAccTitleStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processAccTitleStatement(ctx);
  };

  // Accessibility description statement visitors
  visitAccDescrStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processAccDescrStatement(ctx);
  };

  // Accessibility multiline description statement visitors
  visitAccDescrMultilineStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
    this.core.processAccDescrMultilineStatement(ctx);
  };

  // Default visitors for other rules
  visitStart = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitDocument = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitLine = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitStatement = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitActorWithConfig = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitConfigObject = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitSignaltype = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitText2 = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitRestOfLine = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitAltSections = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitParSections = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitOptionSections = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };

  visitActor = (ctx: ParseTree): void => {
    this.visitChildren(ctx);
  };
}
