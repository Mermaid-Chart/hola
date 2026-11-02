import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';

function parseSequenceDiagram(input: string) {
  const chars = CharStream.fromString(input);
  const lexer = new SequenceLexer(chars);
  const tokens = new CommonTokenStream(lexer);
  const parser = new SequenceParser(tokens);
  const tree = parser.start();
  const generator = new SequenceASTBuilder(input);
  const { ast } = generator.generateAST(tree);
  return ast;
}

describe('Activate/Deactivate statements', () => {
  it('should capture activate and deactivate statements in AST', () => {
    const input = `sequenceDiagram
    participant Alice
    Alice->>Bob: Hi Bob
    activate Alice
    Bob->>Alice: Hi Alice
    deactivate Alice`;

    const ast = parseSequenceDiagram(input);

    expect(ast.statements).toHaveLength(5);

    // Check each statement type
    expect(ast.statements[0]).toMatchObject({
      type: 'participant',
      originalIndex: 0,
      data: { id: 'Alice' },
    });

    expect(ast.statements[1]).toMatchObject({
      type: 'message',
      originalIndex: 1,
    });

    expect(ast.statements[2]).toMatchObject({
      type: 'activate',
      originalIndex: 2,
      data: { participant: 'Alice' },
      sourceLine: 'activate Alice',
    });

    expect(ast.statements[3]).toMatchObject({
      type: 'message',
      originalIndex: 3,
    });

    expect(ast.statements[4]).toMatchObject({
      type: 'deactivate',
      originalIndex: 4,
      data: { participant: 'Alice' },
      sourceLine: 'deactivate Alice',
    });
  });

  it('should handle multiple activate/deactivate pairs', () => {
    const input = `sequenceDiagram
    participant Alice
    participant Bob
    activate Alice
    activate Bob
    Alice->>Bob: Message
    deactivate Bob
    deactivate Alice`;

    const ast = parseSequenceDiagram(input);

    const activateStmts = ast.statements.filter((s) => s.type === 'activate');
    const deactivateStmts = ast.statements.filter((s) => s.type === 'deactivate');

    expect(activateStmts).toHaveLength(2);
    expect(deactivateStmts).toHaveLength(2);

    expect(activateStmts[0].data).toMatchObject({ participant: 'Alice' });
    expect(activateStmts[1].data).toMatchObject({ participant: 'Bob' });
    expect(deactivateStmts[0].data).toMatchObject({ participant: 'Bob' });
    expect(deactivateStmts[1].data).toMatchObject({ participant: 'Alice' });
  });

  it('should preserve sourceLine for activate/deactivate statements', () => {
    const input = `sequenceDiagram
    activate Alice
    deactivate Bob`;

    const ast = parseSequenceDiagram(input);

    const activateStmt = ast.statements.find((s) => s.type === 'activate');
    const deactivateStmt = ast.statements.find((s) => s.type === 'deactivate');

    expect(activateStmt?.sourceLine).toBe('activate Alice');
    expect(deactivateStmt?.sourceLine).toBe('deactivate Bob');
  });
});
