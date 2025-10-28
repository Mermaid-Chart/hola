/**
 * ANTLR-based Sequence Diagram Parser
 *
 * This is a proper ANTLR implementation using antlr-ng generated parser code.
 * It provides the same interface as the Jison parser for 100% compatibility.
 *
 * Follows the same structure as the flowchart ANTLR parser with both listener and visitor pattern support.
 */

import { CharStream, CommonTokenStream, ParseTreeWalker } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceListener } from './SequenceListener.js';
import { SequenceVisitor } from './SequenceVisitor.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import { SequenceDB } from '../../sequenceDb.js';
import { log } from '../../../../logger.js';
import { SequenceErrorListener } from './SequenceErrorListener.js';
/**
 * Main ANTLR parser class that provides the same interface as the Jison parser
 */
export class ANTLRSequenceParser {
  yy: SequenceDB;

  constructor() {
    this.yy = new SequenceDB();
  }

  parse(input: string): SequenceDB {
    try {
      // Reset database state
      if (this.yy.clear) {
        this.yy.clear();
      }
      // Create input stream and lexer
      const inputStream = CharStream.fromString(input);
      const lexer = new SequenceLexer(inputStream);

      // Add custom error listener to lexer to capture lexer errors
      const lexerErrorListener = new SequenceErrorListener();
      lexer.removeErrorListeners(); // Remove default console error listener
      lexer.addErrorListener(lexerErrorListener);

      const tokenStream = new CommonTokenStream(lexer);

      // Create parser
      const parser = new SequenceParser(tokenStream);

      // Add custom error listener to parser to capture parser errors
      const parserErrorListener = new SequenceErrorListener();
      parser.removeErrorListeners(); // Remove default console error listener
      parser.addErrorListener(parserErrorListener);

      // Generate parse tree
      const tree = parser.start();

      // Check for syntax errors before proceeding (check both lexer and parser errors)
      // Throw a Jison-compatible error with hash property
      if (lexerErrorListener.hasErrors()) {
        throw lexerErrorListener.createDetailedError();
      }
      if (parserErrorListener.hasErrors()) {
        throw parserErrorListener.createDetailedError();
      }

      // TODO: Once we are done with the the first diagram and sure about the approach, we can remove this variable
      const useVisitorPattern = true;

      if (useVisitorPattern) {
        const visitor = new SequenceVisitor(this.yy);
        try {
          visitor.visit(tree);
        } catch (error) {
          log.error(
            '❌ ANTLR Sequence Parser: Visitor failed:',
            error instanceof Error ? error.message : String(error)
          );
          log.error(
            '❌ ANTLR Sequence Parser: Visitor stack:',
            error instanceof Error ? error.stack : undefined
          );
          throw error;
        }
      } else {
        const listener = new SequenceListener(this.yy);
        try {
          ParseTreeWalker.DEFAULT.walk(listener, tree);
        } catch (error) {
          log.error(
            '❌ ANTLR Sequence Parser: Listener failed:',
            error instanceof Error ? error.message : String(error)
          );
          log.error(
            '❌ ANTLR Sequence Parser: Listener stack:',
            error instanceof Error ? error.stack : undefined
          );
          throw error;
        }
      }

      try {
        const generator = new SequenceASTBuilder(input);
        const result = generator.generateAST(tree);
        this.yy.setAST(result.ast);
      } catch (error) {
        log.error(
          '❌ ANTLR Sequence Parser: AST building failed:',
          error instanceof Error ? error.message : String(error)
        );
        // Don't throw - AST building is optional, parsing should still succeed
      }

      return this.yy;
    } catch (error) {
      log.debug('📝 Input that caused error (first 500 chars):', input.substring(0, 500));
      throw error;
    }
  }

  // Provide the same interface as Jison parser
  setYY(yy: SequenceDB) {
    this.yy = yy;
  }
}

// Export for compatibility with existing code
export const parser = new ANTLRSequenceParser();

/**
 * Helper function to create ANTLR parser components for hybrid editor
 */
export function createSequenceParser(input: string): {
  parser: SequenceParser;
  tokenStream: CommonTokenStream;
} {
  // Create lexer
  const inputStream = CharStream.fromString(input);
  const lexer = new SequenceLexer(inputStream);

  // Create token stream
  const tokenStream = new CommonTokenStream(lexer);

  // Create parser
  const parser = new SequenceParser(tokenStream);

  // Configure error handling - remove default error listeners for cleaner output
  parser.removeErrorListeners();

  return { parser, tokenStream };
}
export default parser;
