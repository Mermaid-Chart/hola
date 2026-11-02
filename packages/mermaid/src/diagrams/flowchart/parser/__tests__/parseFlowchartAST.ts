/**
 * Shared test helper for parsing flowchart diagrams with either parser.
 *
 * Usage in tests:
 *   import \{ forBothParsers \} from '../__tests__/parseFlowchartAST.js';
 *   forBothParsers('my tests', (parse) =\> \{ ... \});
 */
import { describe } from 'vitest';
import type { FlowchartAST } from '../../types.js';

export type ParserName = 'antlr' | 'jison';

/**
 * Parse a flowchart source string and return the AST using the specified parser.
 */
export async function parseFlowchartAST(
  input: string,
  parserName: ParserName
): Promise<FlowchartAST> {
  if (parserName === 'antlr') {
    return parseWithAntlr(input);
  } else {
    return parseWithJison(input);
  }
}

async function parseWithAntlr(input: string): Promise<FlowchartAST> {
  const { CharStream, CommonTokenStream } = await import('antlr4ng');
  const { FlowLexer } = await import('../antlr/generated/FlowLexer.js');
  const { FlowParser } = await import('../antlr/generated/FlowParser.js');
  const { FlowchartASTBuilder } = await import('../antlr/FlowchartASTBuilder.js');

  const chars = CharStream.fromString(input);
  const lexer = new FlowLexer(chars);
  const tokens = new CommonTokenStream(lexer);
  const parser = new FlowParser(tokens);
  const tree = parser.start();
  const builder = new FlowchartASTBuilder(input);
  const result = builder.generateAST(tree);
  return result.ast;
}

async function parseWithJison(input: string): Promise<FlowchartAST> {
  const { FlowDB } = await import('../../flowDb.js');
  const flowParserModule = await import('../flowParser.js');
  const flowParser = flowParserModule.default;
  const { extractFrontMatter } = await import('../../../../diagram-api/frontmatter.js');
  const { removeDirectives } = await import('../../../../utils.js');

  const db = new FlowDB();
  db.clear();
  flowParser.parser.yy = db;

  // Preprocess: strip frontmatter and directives (but keep comments).
  // This mirrors the real pipeline in Diagram.ts / preprocessDiagram.
  let textToParse = input.replace(/\r\n?/g, '\n');
  const { text: noFrontMatter } = extractFrontMatter(textToParse);

  // Compute frontmatter line offset (same logic as preprocessDiagram)
  const frontmatterLineOffset =
    textToParse.length > noFrontMatter.length
      ? (textToParse.substring(0, textToParse.length - noFrontMatter.length).match(/\n/g) ?? [])
          .length
      : 0;
  if (frontmatterLineOffset > 0) {
    db.setFrontmatterLineOffset(frontmatterLineOffset);
  }

  textToParse = removeDirectives(noFrontMatter);

  flowParser.parse(textToParse);

  const ast = db.getAST();
  if (!ast) {
    throw new Error('Jison parser did not produce an AST');
  }
  return ast;
}

/**
 * Run a describe block for both parsers.
 * The callback receives a `parse` function that returns a Promise<FlowchartAST>.
 */
export function forBothParsers(
  name: string,
  fn: (parse: (input: string) => Promise<FlowchartAST>, parserName: ParserName) => void
): void {
  for (const parserName of ['antlr', 'jison'] as const) {
    describe(`[${parserName}] ${name}`, () => {
      const parse = (input: string) => parseFlowchartAST(input, parserName);
      fn(parse, parserName);
    });
  }
}
