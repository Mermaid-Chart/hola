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

describe('Note participants array', () => {
  it('should handle single participant note (left of)', () => {
    const input = `sequenceDiagram
  participant Alice
  Note left of Alice: Alice's note`;

    const ast = parseSequenceDiagram(input);
    const noteStmt = ast.statements.find((s) => s.type === 'note');

    expect(noteStmt).toBeDefined();
    expect(noteStmt?.data).toMatchObject({
      position: 'left',
      participant: 'Alice',
      participants: ['Alice'],
      message: "Alice's note",
    });
  });

  it('should handle single participant note (right of)', () => {
    const input = `sequenceDiagram
  participant Bob
  Note right of Bob: Bob's note`;

    const ast = parseSequenceDiagram(input);
    const noteStmt = ast.statements.find((s) => s.type === 'note');

    expect(noteStmt).toBeDefined();
    expect(noteStmt?.data).toMatchObject({
      position: 'right',
      participant: 'Bob',
      participants: ['Bob'],
      message: "Bob's note",
    });
  });

  it('should handle single participant note (over)', () => {
    const input = `sequenceDiagram
  participant Alice
  Note over Alice: Alice's note`;

    const ast = parseSequenceDiagram(input);
    const noteStmt = ast.statements.find((s) => s.type === 'note');

    expect(noteStmt).toBeDefined();
    expect(noteStmt?.data).toMatchObject({
      position: 'over',
      participant: 'Alice',
      participants: ['Alice'],
      message: "Alice's note",
    });
  });

  it('should handle two participant note (over)', () => {
    const input = `sequenceDiagram
  participant Alice
  participant Bob
  Note over Alice, Bob: Shared note`;

    const ast = parseSequenceDiagram(input);
    const noteStmt = ast.statements.find((s) => s.type === 'note');

    expect(noteStmt).toBeDefined();
    expect(noteStmt?.data).toMatchObject({
      position: 'over',
      participant: 'Alice', // First participant for backward compatibility
      participants: ['Alice', 'Bob'],
      message: 'Shared note',
    });
  });

  it('should handle multiple notes with different participant counts', () => {
    const input = `sequenceDiagram
  participant Alice
  participant Bob
  participant Charlie
  Note left of Alice: Alice's note
  Note over Alice, Bob: Alice and Bob
  Note right of Charlie: Charlie's note`;

    const ast = parseSequenceDiagram(input);
    const noteStmts = ast.statements.filter((s) => s.type === 'note');

    expect(noteStmts).toHaveLength(3);

    // First note: single participant
    expect(noteStmts[0].data).toMatchObject({
      position: 'left',
      participant: 'Alice',
      participants: ['Alice'],
      message: "Alice's note",
    });

    // Second note: two participants
    expect(noteStmts[1].data).toMatchObject({
      position: 'over',
      participant: 'Alice',
      participants: ['Alice', 'Bob'],
      message: 'Alice and Bob',
    });

    // Third note: single participant
    expect(noteStmts[2].data).toMatchObject({
      position: 'right',
      participant: 'Charlie',
      participants: ['Charlie'],
      message: "Charlie's note",
    });
  });

  it('should preserve participants array in sourceLine', () => {
    const input = `sequenceDiagram
  Note over Alice, Bob: Shared note`;

    const ast = parseSequenceDiagram(input);
    const noteStmt = ast.statements.find((s) => s.type === 'note');

    expect(noteStmt).toBeDefined();
    expect(noteStmt?.sourceLine).toBe('Note over Alice, Bob: Shared note');
    expect(noteStmt?.data).toMatchObject({
      participants: ['Alice', 'Bob'],
    });
  });
});
