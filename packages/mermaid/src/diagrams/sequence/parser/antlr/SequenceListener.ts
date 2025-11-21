import type { ParseTreeListener } from 'antlr4ng';
import { SequenceParserCore } from './SequenceParserCore.js';
import { log } from '../../../../logger.js';

/**
 * Listener implementation that builds the sequence diagram model
 * Extends the core logic to ensure compatibility with Jison parser behavior
 */
export class SequenceListener extends SequenceParserCore implements ParseTreeListener {
  constructor(db: any) {
    super(db);
    log.debug('👂 SequenceListener: Constructor called');
  }

  // Standard ParseTreeListener methods
  enterEveryRule = (ctx: any) => {
    const ruleName = ctx.constructor.name;
    log.debug('🔍 SequenceListener: Entering rule:', ruleName);
  };

  exitEveryRule = (_ctx: any) => {
    // Optional: Add debug logging for rule exit
  };

  visitTerminal = (_node: any) => {
    // Optional: Handle terminal nodes
  };

  visitErrorNode = (_node: any) => {
    // Error nodes are created when ANTLR encounters a syntax error
    // The error details are captured by the SequenceErrorListener in the parser
    // and will be thrown after parsing completes, so we don't need to throw here
    log.debug('❌ SequenceListener: Error node encountered');
  };

  // Loop block handlers
  enterLoopBlock = (ctx: any) => {
    this.processLoopBlockEnter(ctx);
  };

  exitLoopBlock = () => {
    this.processLoopBlockExit();
  };

  // Participant statement handlers
  exitParticipantStatement = (ctx: any) => {
    this.processParticipantStatement(ctx);
  };

  // Create statement handlers
  exitCreateStatement = (ctx: any) => {
    this.processCreateStatement(ctx);
  };

  // Destroy statement handlers
  exitDestroyStatement = (ctx: any) => {
    this.processDestroyStatement(ctx);
  };

  // Opt block handlers
  enterOptBlock = (ctx: any) => {
    this.processOptBlockEnter(ctx);
  };

  exitOptBlock = () => {
    this.processOptBlockExit();
  };

  // Alt block handlers
  enterAltBlock = (ctx: any) => {
    this.processAltBlockEnter(ctx);
  };

  exitAltBlock = () => {
    this.processAltBlockExit();
  };

  enterElseSection = (ctx: any) => {
    this.processElseSection(ctx);
  };

  // Par block handlers
  enterParBlock = (ctx: any) => {
    this.processParBlockEnter(ctx);
  };

  exitParBlock = () => {
    this.processParBlockExit();
  };

  enterAndSection = (ctx: any) => {
    this.processAndSection(ctx);
  };

  // ParOver block handlers
  enterParOverBlock = (ctx: any) => {
    this.processParOverBlockEnter(ctx);
  };

  exitParOverBlock = () => {
    this.processParOverBlockExit();
  };

  // Rect block handlers
  enterRectBlock = (ctx: any) => {
    this.processRectBlockEnter(ctx);
  };

  exitRectBlock = () => {
    this.processRectBlockExit();
  };

  // Box block handlers
  enterBoxBlock = (ctx: any) => {
    this.processBoxBlockEnter(ctx);
  };

  exitBoxBlock = () => {
    this.processBoxBlockExit();
  };

  // Break block handlers
  enterBreakBlock = (ctx: any) => {
    this.processBreakBlockEnter(ctx);
  };

  exitBreakBlock = () => {
    this.processBreakBlockExit();
  };

  // Critical block handlers
  enterCriticalBlock = (ctx: any) => {
    this.processCriticalBlockEnter(ctx);
  };

  exitCriticalBlock = () => {
    this.processCriticalBlockExit();
  };

  enterOptionSection = (ctx: any) => {
    this.processOptionSection(ctx);
  };

  // Signal statement handlers
  exitSignalStatement = (ctx: any) => {
    this.processSignalStatement(ctx);
  };

  // Note statement handlers
  exitNoteStatement = (ctx: any) => {
    this.processNoteStatement(ctx);
  };

  // Links statement handlers
  exitLinksStatement = (ctx: any) => {
    this.processLinksStatement(ctx);
  };

  // Link statement handlers
  exitLinkStatement = (ctx: any) => {
    this.processLinkStatement(ctx);
  };

  // Properties statement handlers
  exitPropertiesStatement = (ctx: any) => {
    this.processPropertiesStatement(ctx);
  };

  // Details statement handlers
  exitDetailsStatement = (ctx: any) => {
    this.processDetailsStatement(ctx);
  };

  // Activation statement handlers
  exitActivationStatement = (ctx: any) => {
    this.processActivationStatement(ctx);
  };

  // Autonumber statement handlers
  exitAutonumberStatement = (ctx: any) => {
    this.processAutonumberStatement(ctx);
  };

  // Title statement handlers
  exitTitleStatement = (ctx: any) => {
    this.processTitleStatement(ctx);
  };

  // Legacy title statement handlers
  exitLegacyTitleStatement = (ctx: any) => {
    this.processLegacyTitleStatement(ctx);
  };

  // Accessibility title statement handlers
  exitAccTitleStatement = (ctx: any) => {
    this.processAccTitleStatement(ctx);
  };

  // Accessibility description statement handlers
  exitAccDescrStatement = (ctx: any) => {
    this.processAccDescrStatement(ctx);
  };

  // Accessibility multiline description statement handlers
  exitAccDescrMultilineStatement = (ctx: any) => {
    this.processAccDescrMultilineStatement(ctx);
  };
}
