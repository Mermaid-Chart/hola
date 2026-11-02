import type { ParseTree, TerminalNode, ErrorNode } from 'antlr4ng';
import type {
  VertexStatementContext,
  StartContext,
  DocumentContext,
  LineContext,
  StatementContext,
  StandaloneVertexContext,
  NodeContext,
  StyledVertexContext,
  VertexContext,
  VertexShapeContext,
  TextContext,
  IdStringContext,
  LinkContext,
  LinkStatementContext,
  EdgeTextContext,
  ArrowTextContext,
  ShapeDataContext,
  ShapeDataContentContext,
  ShapeDataContentItemContext,
  StyleStatementContext,
  LinkStyleStatementContext,
  ClassDefStatementContext,
  ClassStatementContext,
  StringLiteralContext,
  ClickStatementContext,
  SubgraphStatementContext,
  DirectionContext,
  AccTitleContext,
  AccDescrContext,
  NumListContext,
  StylesOptContext,
  StyleContext,
  StyleComponentContext,
  AlphaNumContext,
  TextNoTagsContext,
  IdStringTokenContext,
  TextTokenContext,
  TextNoTagsTokenContext,
  EdgeTextTokenContext,
  AlphaNumTokenContext,
  KeywordsContext,
  GraphConfigContext,
} from './generated/FlowParser.js';
import type { FlowchartParserDB } from './FlowchartParserCore.js';
import { FlowchartParserCore } from './FlowchartParserCore.js';

/**
 * Visitor implementation that builds the flowchart model
 * Uses the same core logic as the Listener for 99.1% test compatibility
 */
export class FlowchartVisitor extends FlowchartParserCore {
  constructor(db: FlowchartParserDB) {
    super(db);
  }

  // Default visitor methods
  visit(tree: ParseTree): unknown {
    return tree.accept(this);
  }

  visitChildren(node: ParseTree): unknown {
    let result: unknown = null;
    const n = node.getChildCount();
    for (let i = 0; i < n; i++) {
      const child = node.getChild(i);
      if (child) {
        const childResult = child.accept(this);
        if (childResult !== null) {
          result = childResult;
        }
      }
    }
    return result;
  }

  // Required visitor methods for terminal nodes and errors
  visitTerminal(_node: TerminalNode): unknown {
    return null;
  }

  visitErrorNode(_node: ErrorNode): unknown {
    return null;
  }

  // Additional required methods for the visitor interface
  defaultResult(): unknown {
    return null;
  }

  shouldVisitNextChild(_node: ParseTree, _currentResult: unknown): boolean {
    return true;
  }

  aggregateResult(aggregate: unknown, nextResult: unknown): unknown {
    return nextResult !== null ? nextResult : aggregate;
  }

  // Handle graph config (graph >, flowchart ^, etc.)
  visitGraphConfig(ctx: GraphConfigContext): unknown {
    this.processGraphDeclaration(ctx);
    return this.visitChildren(ctx);
  }

  // Implement key visitor methods using the same logic as the Listener
  visitVertexStatement(ctx: VertexStatementContext): unknown {
    // For left-recursive vertexStatement grammar, we need to visit children first
    // to process the chain in the correct order (A->B->C should process A first)
    const result = this.visitChildren(ctx);

    // Then process this vertex statement using core logic
    // This ensures identical behavior and test compatibility with Listener pattern
    this.processVertexStatementCore(ctx);

    return result;
  }

  // Default implementation for all other visit methods
  visitStart(ctx: StartContext): unknown {
    return this.visitChildren(ctx);
  }

  visitDocument(ctx: DocumentContext): unknown {
    return this.visitChildren(ctx);
  }

  visitLine(ctx: LineContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStatement(ctx: StatementContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStyleStatement(ctx: StyleStatementContext): unknown {
    this.processStyleStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitLinkStyleStatement(ctx: LinkStyleStatementContext): unknown {
    this.processLinkStyleStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitClassStatement(ctx: ClassStatementContext): unknown {
    this.processClassStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitClickStatement(ctx: ClickStatementContext): unknown {
    this.processClickStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitDirection(ctx: DirectionContext): unknown {
    this.processDirectionStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitSubgraphStatement(ctx: SubgraphStatementContext): unknown {
    this.processSubgraphStatementCore(ctx);
    const result = this.visitChildren(ctx);
    this.processSubgraphEndCore();
    return result;
  }

  // Note: Helper methods are now in FlowchartParserCore base class

  // Add implementations for additional visitor methods (avoiding duplicates)
  visitStandaloneVertex(ctx: StandaloneVertexContext): unknown {
    return this.visitChildren(ctx);
  }

  visitNode(ctx: NodeContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStyledVertex(ctx: StyledVertexContext): unknown {
    return this.visitChildren(ctx);
  }

  visitVertex(ctx: VertexContext): unknown {
    return this.visitChildren(ctx);
  }

  visitVertexShape(ctx: VertexShapeContext): unknown {
    return this.visitChildren(ctx);
  }

  visitText(ctx: TextContext): unknown {
    return this.visitChildren(ctx);
  }

  visitIdString(ctx: IdStringContext): unknown {
    return this.visitChildren(ctx);
  }

  visitLink(ctx: LinkContext): unknown {
    return this.visitChildren(ctx);
  }

  visitLinkStatement(ctx: LinkStatementContext): unknown {
    return this.visitChildren(ctx);
  }

  visitEdgeText(ctx: EdgeTextContext): unknown {
    return this.visitChildren(ctx);
  }

  visitArrowText(ctx: ArrowTextContext): unknown {
    return this.visitChildren(ctx);
  }

  visitShapeData(ctx: ShapeDataContext): unknown {
    return this.visitChildren(ctx);
  }

  visitShapeDataContent(ctx: ShapeDataContentContext): unknown {
    return this.visitChildren(ctx);
  }

  visitShapeDataContentItem(ctx: ShapeDataContentItemContext): unknown {
    return this.visitChildren(ctx);
  }

  visitClassDefStatement(ctx: ClassDefStatementContext): unknown {
    this.processClassDefStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitStringLiteral(ctx: StringLiteralContext): unknown {
    return this.visitChildren(ctx);
  }

  visitAccTitle(ctx: AccTitleContext): unknown {
    this.processAccTitleStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitAccDescr(ctx: AccDescrContext): unknown {
    this.processAccDescStatementCore(ctx);
    return this.visitChildren(ctx);
  }

  visitNumList(ctx: NumListContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStylesOpt(ctx: StylesOptContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStyle(ctx: StyleContext): unknown {
    return this.visitChildren(ctx);
  }

  visitStyleComponent(ctx: StyleComponentContext): unknown {
    return this.visitChildren(ctx);
  }

  visitAlphaNum(ctx: AlphaNumContext): unknown {
    return this.visitChildren(ctx);
  }

  visitTextNoTags(ctx: TextNoTagsContext): unknown {
    return this.visitChildren(ctx);
  }

  visitIdStringToken(ctx: IdStringTokenContext): unknown {
    return this.visitChildren(ctx);
  }

  visitTextToken(ctx: TextTokenContext): unknown {
    return this.visitChildren(ctx);
  }

  visitTextNoTagsToken(ctx: TextNoTagsTokenContext): unknown {
    return this.visitChildren(ctx);
  }

  visitEdgeTextToken(ctx: EdgeTextTokenContext): unknown {
    return this.visitChildren(ctx);
  }

  visitAlphaNumToken(ctx: AlphaNumTokenContext): unknown {
    return this.visitChildren(ctx);
  }

  visitKeywords(ctx: KeywordsContext): unknown {
    return this.visitChildren(ctx);
  }
}
