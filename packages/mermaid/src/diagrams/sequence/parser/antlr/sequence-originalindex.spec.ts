import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import { log } from '../../../../logger.js';

describe('Sequence AST originalIndex assignment', () => {
  it('should assign sequential originalIndex values to all statements', () => {
    const input = `sequenceDiagram
    actor Alice
    actor Bob

    %% A comment
    Alice->>Bob: Hi Bob`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nStatements with originalIndex:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type.padEnd(12)} originalIndex=${stmt.originalIndex} sourceLine="${stmt.sourceLine?.replace(/\n/g, '\\n')}"`
      );
    });

    // Expected statements in order:
    // 0: actor Alice → originalIndex: 0
    // 1: actor Bob → originalIndex: 1
    // 2: blankLine → originalIndex: 2
    // 3: comment → originalIndex: 3
    // 4: message → originalIndex: 4

    expect(ast.statements.length).toBe(5);

    // Check types are in correct order
    expect(ast.statements[0].type).toBe('actor');
    expect(ast.statements[1].type).toBe('actor');
    expect(ast.statements[2].type).toBe('blankLine');
    expect(ast.statements[3].type).toBe('comment');
    expect(ast.statements[4].type).toBe('message');

    // Check originalIndex values are sequential
    expect(ast.statements[0].originalIndex).toBe(0);
    expect(ast.statements[1].originalIndex).toBe(1);
    expect(ast.statements[2].originalIndex).toBe(2);
    expect(ast.statements[3].originalIndex).toBe(3);
    expect(ast.statements[4].originalIndex).toBe(4);

    // Check all originalIndex values are unique
    const indices = ast.statements.map((s) => s.originalIndex);
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(ast.statements.length);
  });

  it('should maintain correct order without blank lines', () => {
    const input = `sequenceDiagram
    actor Alice
    participant Bob
    Alice->>Bob: Hello`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nStatements without blank lines:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(`${idx}: type=${stmt.type.padEnd(12)} originalIndex=${stmt.originalIndex}`);
    });

    // Expected: 0: actor, 1: participant, 2: message
    expect(ast.statements.length).toBe(3);
    expect(ast.statements[0].originalIndex).toBe(0);
    expect(ast.statements[1].originalIndex).toBe(1);
    expect(ast.statements[2].originalIndex).toBe(2);

    // Check uniqueness
    const indices = ast.statements.map((s) => s.originalIndex);
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(ast.statements.length);
  });

  it('should handle multiple blank lines correctly', () => {
    const input = `sequenceDiagram
    actor Alice


    participant Bob`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nStatements with multiple blank lines:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(`${idx}: type=${stmt.type.padEnd(12)} originalIndex=${stmt.originalIndex}`);
    });

    // Expected: 0: actor, 1: blankLine, 2: blankLine, 3: participant
    expect(ast.statements.length).toBe(4);
    expect(ast.statements[0].type).toBe('actor');
    expect(ast.statements[1].type).toBe('blankLine');
    expect(ast.statements[2].type).toBe('blankLine');
    expect(ast.statements[3].type).toBe('participant');

    // Check sequential indices
    expect(ast.statements[0].originalIndex).toBe(0);
    expect(ast.statements[1].originalIndex).toBe(1);
    expect(ast.statements[2].originalIndex).toBe(2);
    expect(ast.statements[3].originalIndex).toBe(3);

    // Check uniqueness
    const indices = ast.statements.map((s) => s.originalIndex);
    const uniqueIndices = new Set(indices);
    expect(uniqueIndices.size).toBe(ast.statements.length);
  });
});
