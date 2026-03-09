/**
 * ANTLR-based Flowchart Parser
 *
 * This is a proper ANTLR implementation using antlr-ng generated parser code.
 * It provides the same interface as the Jison parser for 100% compatibility.
 *
 * Goal: Achieve 99.7% pass rate (944/947 tests) to match Jison parser performance
 */

import {
  BailErrorStrategy,
  CharStream,
  CommonTokenStream,
  DefaultErrorStrategy,
  ParseCancellationException,
  PredictionMode,
} from 'antlr4ng';
import { FlowLexer } from './generated/FlowLexer.js';
import { FlowParser } from './generated/FlowParser.js';
import type { StartContext } from './generated/FlowParser.js';
import { FlowchartVisitor } from './FlowchartVisitor.js';
import { FlowchartErrorListener } from './FlowchartErrorListener.js';
import { FlowchartASTBuilder } from './FlowchartASTBuilder.js';
import type { FlowchartParserDB } from './FlowchartParserCore.js';
import { log } from '../../../../logger.js';

/**
 * Main ANTLR parser class that provides the same interface as the Jison parser
 */
export class ANTLRFlowParser {
  yy: FlowchartParserDB;

  constructor() {
    this.yy = {} as FlowchartParserDB;
  }

  parse(input: string): FlowchartParserDB {
    // Clean up HTML tags so that all attributes use single quotes
    // This matches the preprocessing done by cleanupText() in preprocess.ts
    // which is applied to Jison but not to ANTLR (since ANTLR uses processRawText: true)
    // Without this, nested double quotes in HTML attributes break parsing
    // e.g., A("<a href="url">link</a>") becomes A("<a href='url'>link</a>")
    input = input.replaceAll(
      /<(\w+)([^>]*)>/g,
      (_match, tag, attributes) => '<' + tag + attributes.replaceAll(/="([^"]*)"/g, "='$1'") + '>'
    );

    try {
      // Reset database state
      if (this.yy.clear) {
        this.yy.clear();
      }

      // Create input stream and lexer
      const inputStream = CharStream.fromString(input);
      const lexer = new FlowLexer(inputStream);

      // Add error listener to lexer
      const lexerErrorListener = new FlowchartErrorListener();
      lexer.removeErrorListeners();
      lexer.addErrorListener(lexerErrorListener);

      const tokenStream = new CommonTokenStream(lexer);

      // Create parser
      const parser = new FlowParser(tokenStream);

      // Add error listener to parser
      const parserErrorListener = new FlowchartErrorListener();
      parser.removeErrorListeners();
      parser.addErrorListener(parserErrorListener);

      // Generate parse tree using two-stage SLL+LL parsing for optimal performance
      // SLL (Simpler LL) is much faster but may fail on some inputs; LL is slower but handles all cases
      // This is the recommended approach from ANTLR documentation for maximum performance

      let tree: StartContext;

      // First, try with SLL mode (fastest) using BailErrorStrategy
      // BailErrorStrategy immediately throws ParseCancellationException on error
      // instead of trying to recover, making SLL fail-fast
      parser.interpreter.predictionMode = PredictionMode.SLL;
      parser.errorHandler = new BailErrorStrategy();

      try {
        tree = parser.start();
      } catch (sllError) {
        // Check if this is a ParseCancellationException (SLL failure)
        // or some other error type
        if (sllError instanceof ParseCancellationException) {
          // SLL failed - fall back to full LL mode

          // Reset parser state for retry
          tokenStream.seek(0);
          parser.reset();

          // Clear any errors from SLL attempt
          parserErrorListener.clear();

          // Use full LL mode with default error strategy
          parser.interpreter.predictionMode = PredictionMode.LL;
          parser.errorHandler = new DefaultErrorStrategy();
          tree = parser.start();
        } else {
          // Re-throw other errors (actual syntax errors, etc.)
          throw sllError;
        }
      }

      // Check for parsing errors
      if (parserErrorListener.hasErrors()) {
        throw parserErrorListener.createDetailedError();
      }

      // Generate AST (for hybrid editor support)
      // Always generate AST, but don't throw on errors
      try {
        const astBuilder = new FlowchartASTBuilder(input);
        const astResult = astBuilder.generateAST(tree);
        // Store AST in database for later retrieval
        if (this.yy.setAST) {
          this.yy.setAST(astResult.ast);
        }
      } catch (error) {
        log.error(
          'ANTLR Parser: AST building failed:',
          error instanceof Error ? error.message : String(error)
        );
        // Don't throw - AST building is optional, parsing should still succeed
      }

      // Use Visitor pattern to traverse the parse tree
      const visitor = new FlowchartVisitor(this.yy);
      try {
        visitor.visit(tree);
      } catch (error: unknown) {
        const err = error as Error;
        log.error('ANTLR Parser: Visitor failed:', err.message);
        throw error;
      }

      // Update AST with edge data now that the tree has been traversed
      if (this.yy.updateASTWithEdges) {
        this.yy.updateASTWithEdges();
      }

      return this.yy;
    } catch (error) {
      log.error('ANTLR parsing error:', error);
      throw error;
    }
  }

  // Provide the same interface as Jison parser
  setYY(yy: FlowchartParserDB) {
    this.yy = yy;
  }
}

// Export for compatibility with existing code
export const parser = new ANTLRFlowParser();
