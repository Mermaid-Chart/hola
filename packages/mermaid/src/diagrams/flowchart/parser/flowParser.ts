// @ts-ignore: JISON doesn't support types
import flowJisonParser from './flow.jison';
import { JisonFlowchartASTBuilder } from './jison/JisonFlowchartASTBuilder.js';
import { log } from '../../../logger.js';

// Create a wrapper that provides the expected interface for the Jison parser
// Parser selection (jison vs antlr) is handled by getParser() in flowDiagram.ts based on config
const newParser = { ...flowJisonParser };

newParser.parse = (src: string): unknown => {
  // remove the trailing whitespace after closing curly braces when ending a line break
  const newSrc = src.replaceAll(/}\s*\n/g, '}\n');
  const result = flowJisonParser.parse(newSrc);

  // Build AST for bidirectional sync (same as ANTLR parser does)
  try {
    const db = flowJisonParser.yy;
    if (db && typeof db.setAST === 'function') {
      const builder = new JisonFlowchartASTBuilder();
      // Use original text (before comment cleanup) for correct line number mapping.
      // The original text is stored in FlowDB by Diagram.ts before parsing.
      // If not available (e.g. in tests), fall back to the cleaned text.
      const originalText =
        typeof db.getOriginalText === 'function' ? db.getOriginalText() : undefined;
      const ast = builder.buildAST(newSrc, db, originalText);
      db.setAST(ast);
    }
  } catch (error) {
    log.error(
      'Jison Parser: AST building failed:',
      error instanceof Error ? error.message : String(error)
    );
    // Don't throw - AST building is optional, parsing should still succeed
  }

  return result;
};

export default newParser;
