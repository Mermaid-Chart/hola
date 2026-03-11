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

  const db = new FlowDB();
  db.clear();
  flowParser.parser.yy = db;

  // Parse WITH comments — the Jison grammar handles %% comments natively.
  // This ensures @$ positions are in original-text space.
  flowParser.parse(input);

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
