// @ts-ignore: JISON doesn't support types
import flowJisonParser from './flow.jison';
import { log } from '../../../logger.js';

// Create a wrapper that provides the expected interface for the Jison parser
// Parser selection (jison vs antlr) is handled by getParser() in flowDiagram.ts based on config
const newParser = { ...flowJisonParser };

newParser.parse = (src: string): unknown => {
  // Remove the trailing whitespace after closing curly braces when ending a line break
  const newSrc = src.replaceAll(/}\s*\n/g, '}\n');

  // Set source text for inline position tracking during parsing.
  // Jison grammar rules call addVertexMapping/addEdgeMapping/addSubgraphMapping/addComment
  // with @$ locations during parsing, which FlowDB uses to build the AST.
  const db = flowJisonParser.yy;
  if (db && typeof db.setSourceText === 'function') {
    db.setSourceText(newSrc);
  }

  const result = flowJisonParser.parse(newSrc);

  // Build AST from inline mappings captured during parsing
  try {
    if (
      db &&
      typeof db.setAST === 'function' &&
      typeof db.buildASTFromInlineMappings === 'function'
    ) {
      const ast = db.buildASTFromInlineMappings();
      if (ast) {
        db.setAST(ast);
      }
    }
  } catch (error) {
    log.error(
      'Jison Parser: AST building failed:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return result;
};

export default newParser;
