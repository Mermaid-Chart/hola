import type { ParseTreeListener, ParserRuleContext, TerminalNode, ErrorNode } from 'antlr4ng';
import { SequenceParserCore } from './SequenceParserCore.js';
import type {
  LoopBlockContext,
  ParticipantStatementContext,
  CreateStatementContext,
  DestroyStatementContext,
  OptBlockContext,
  AltBlockContext,
  ElseSectionContext,
  ParBlockContext,
  AndSectionContext,
  ParOverBlockContext,
  RectBlockContext,
  BoxBlockContext,
  BreakBlockContext,
  CriticalBlockContext,
  OptionSectionContext,
  SignalStatementContext,
  NoteStatementContext,
  LinksStatementContext,
  LinkStatementContext,
  PropertiesStatementContext,
  DetailsStatementContext,
  ActivationStatementContext,
  AutonumberStatementContext,
  TitleStatementContext,
  LegacyTitleStatementContext,
  AccTitleStatementContext,
  AccDescrStatementContext,
  AccDescrMultilineStatementContext,
} from './generated/SequenceParser.js';

/**
 * Listener implementation that builds the sequence diagram model
 * Extends the core logic to ensure compatibility with Jison parser behavior
 */
export class SequenceListener extends SequenceParserCore implements ParseTreeListener {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(db: any) {
    super(db);
    // Only log for debug mode
    if (this.getEnvVar('ANTLR_DEBUG') === 'true') {
      // eslint-disable-next-line no-console
      console.log('👂 SequenceListener: Constructor called');
    }
  }

  // Standard ParseTreeListener methods
  enterEveryRule = (ctx: ParserRuleContext) => {
    // Optional: Add debug logging for rule entry
    if (this.getEnvVar('NODE_ENV') === 'development') {
      const ruleName = ctx.constructor.name;
      // eslint-disable-next-line no-console
      console.log('🔍 SequenceListener: Entering rule:', ruleName);
    }
  };

  exitEveryRule = (_ctx: ParserRuleContext) => {
    // Optional: Add debug logging for rule exit
  };

  visitTerminal = (_node: TerminalNode) => {
    // Optional: Handle terminal nodes
  };

  visitErrorNode = (_node: ErrorNode) => {
    // Error nodes are created when ANTLR encounters a syntax error
    // The error details are captured by the SequenceErrorListener in the parser
    // and will be thrown after parsing completes, so we don't need to throw here
    // eslint-disable-next-line no-console
    console.log('❌ SequenceListener: Error node encountered');
  };

  // Loop block handlers
  enterLoopBlock = (ctx: LoopBlockContext) => {
    this.processLoopBlockEnter(ctx);
  };

  exitLoopBlock = () => {
    this.processLoopBlockExit();
  };

  // Participant statement handlers
  exitParticipantStatement = (ctx: ParticipantStatementContext) => {
    this.processParticipantStatement(ctx);
  };

  // Create statement handlers
  exitCreateStatement = (ctx: CreateStatementContext) => {
    this.processCreateStatement(ctx);
  };

  // Destroy statement handlers
  exitDestroyStatement = (ctx: DestroyStatementContext) => {
    this.processDestroyStatement(ctx);
  };

  // Opt block handlers
  enterOptBlock = (ctx: OptBlockContext) => {
    this.processOptBlockEnter(ctx);
  };

  exitOptBlock = () => {
    this.processOptBlockExit();
  };

  // Alt block handlers
  enterAltBlock = (ctx: AltBlockContext) => {
    this.processAltBlockEnter(ctx);
  };

  exitAltBlock = () => {
    this.processAltBlockExit();
  };

  enterElseSection = (ctx: ElseSectionContext) => {
    this.processElseSection(ctx);
  };

  // Par block handlers
  enterParBlock = (ctx: ParBlockContext) => {
    this.processParBlockEnter(ctx);
  };

  exitParBlock = () => {
    this.processParBlockExit();
  };

  enterAndSection = (ctx: AndSectionContext) => {
    this.processAndSection(ctx);
  };

  // ParOver block handlers
  enterParOverBlock = (ctx: ParOverBlockContext) => {
    this.processParOverBlockEnter(ctx);
  };

  exitParOverBlock = () => {
    this.processParOverBlockExit();
  };

  // Rect block handlers
  enterRectBlock = (ctx: RectBlockContext) => {
    this.processRectBlockEnter(ctx);
  };

  exitRectBlock = () => {
    this.processRectBlockExit();
  };

  // Box block handlers
  enterBoxBlock = (ctx: BoxBlockContext) => {
    this.processBoxBlockEnter(ctx);
  };

  exitBoxBlock = () => {
    this.processBoxBlockExit();
  };

  // Break block handlers
  enterBreakBlock = (ctx: BreakBlockContext) => {
    this.processBreakBlockEnter(ctx);
  };

  exitBreakBlock = () => {
    this.processBreakBlockExit();
  };

  // Critical block handlers
  enterCriticalBlock = (ctx: CriticalBlockContext) => {
    this.processCriticalBlockEnter(ctx);
  };

  exitCriticalBlock = () => {
    this.processCriticalBlockExit();
  };

  enterOptionSection = (ctx: OptionSectionContext) => {
    this.processOptionSection(ctx);
  };

  // Signal statement handlers
  exitSignalStatement = (ctx: SignalStatementContext) => {
    this.processSignalStatement(ctx);
  };

  // Note statement handlers
  exitNoteStatement = (ctx: NoteStatementContext) => {
    this.processNoteStatement(ctx);
  };

  // Links statement handlers
  exitLinksStatement = (ctx: LinksStatementContext) => {
    this.processLinksStatement(ctx);
  };

  // Link statement handlers
  exitLinkStatement = (ctx: LinkStatementContext) => {
    this.processLinkStatement(ctx);
  };

  // Properties statement handlers
  exitPropertiesStatement = (ctx: PropertiesStatementContext) => {
    this.processPropertiesStatement(ctx);
  };

  // Details statement handlers
  exitDetailsStatement = (ctx: DetailsStatementContext) => {
    this.processDetailsStatement(ctx);
  };

  // Activation statement handlers
  exitActivationStatement = (ctx: ActivationStatementContext) => {
    this.processActivationStatement(ctx);
  };

  // Autonumber statement handlers
  exitAutonumberStatement = (ctx: AutonumberStatementContext) => {
    this.processAutonumberStatement(ctx);
  };

  // Title statement handlers
  exitTitleStatement = (ctx: TitleStatementContext) => {
    this.processTitleStatement(ctx);
  };

  // Legacy title statement handlers
  exitLegacyTitleStatement = (ctx: LegacyTitleStatementContext) => {
    this.processLegacyTitleStatement(ctx);
  };

  // Accessibility title statement handlers
  exitAccTitleStatement = (ctx: AccTitleStatementContext) => {
    this.processAccTitleStatement(ctx);
  };

  // Accessibility description statement handlers
  exitAccDescrStatement = (ctx: AccDescrStatementContext) => {
    this.processAccDescrStatement(ctx);
  };

  // Accessibility multiline description statement handlers
  exitAccDescrMultilineStatement = (ctx: AccDescrMultilineStatementContext) => {
    this.processAccDescrMultilineStatement(ctx);
  };
}
