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
import { TokenStreamRewriter } from 'antlr4ng';
import { SequenceDB } from '../../sequenceDb.js';
/**
 * Main ANTLR parser class that provides the same interface as the Jison parser
 */
export class ANTLRSequenceParser {
  yy: SequenceDB;

  constructor() {
    this.yy = new SequenceDB();
  }

  parse(input: string): any {
    try {
      // Reset database state
      if (this.yy.clear) {
        this.yy.clear();
      }
      // Create input stream and lexer
      const inputStream = CharStream.fromString(input);
      const lexer = new SequenceLexer(inputStream);
      const tokenStream = new CommonTokenStream(lexer);

      // Create parser
      const parser = new SequenceParser(tokenStream);

      // Generate parse tree
      const tree = parser.start();

      // TODO: Once we are done with the the first diagram and sure about the approach, we can remove this variable
      const useVisitorPattern = true;

      if (useVisitorPattern) {
        const visitor = new SequenceVisitor(this.yy);
        try {
          visitor.visit(tree);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('❌ ANTLR Sequence Parser: Visitor failed:', error.message);
          // eslint-disable-next-line no-console
          console.error('❌ ANTLR Sequence Parser: Visitor stack:', error.stack);
          throw error;
        }
      } else {
        const listener = new SequenceListener(this.yy);
        try {
          ParseTreeWalker.DEFAULT.walk(listener, tree);
        } catch (error) {
          // eslint-disable-next-line no-console
          console.error('❌ ANTLR Sequence Parser: Listener failed:', error.message);
          // eslint-disable-next-line no-console
          console.error('❌ ANTLR Sequence Parser: Listener stack:', error.stack);
          throw error;
        }
      }

      try {
        this.yy._tokenRewriter = new TokenStreamRewriter(tokenStream);
        this.yy._tokenMap = new Map(); // Map statement indices to token positions

        const generator = new SequenceASTBuilder();
        const result = generator.generateAST(tree);
        this.yy.setAST(result.ast);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error('❌ ANTLR Sequence Parser: AST building failed:', error.message);
        // Don't throw - AST building is optional, parsing should still succeed
      }

      console.log('returning DB');
      return this.yy;
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log('📝 Input that caused error (first 500 chars):', input.substring(0, 500));
      throw error;
    }
  }

  // Provide the same interface as Jison parser
  setYY(yy: any) {
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
