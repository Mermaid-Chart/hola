import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import { log } from '../../../../logger.js';

describe('Sequence AST comment preservation', () => {
  it('should preserve comments immediately after sequenceDiagram in the AST', () => {
    const input = `sequenceDiagram
%% actors
%% 1111
%% 222
    actor Alice
    actor Bob
    %% messages
    Alice ->> Bob: Hi Bob
    Bob ->> Alice: Hi Alice`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // Count comments in AST
    const commentStatements = ast.statements.filter((s) => s.type === 'comment');
    log.debug(`\nComments in AST: ${commentStatements.length}`);

    // We should have 4 comments:
    // 1. %% actors (immediately after sequenceDiagram)
    // 2. %% 1111 (immediately after sequenceDiagram)
    // 3. %% 222 (immediately after sequenceDiagram)
    // 4. %% messages (before messages)
    expect(commentStatements.length).toBe(4);

    // Verify the first 3 comments are the ones immediately after sequenceDiagram
    expect(commentStatements[0].sourceLine).toBe('%% actors');
    expect(commentStatements[1].sourceLine).toBe('%% 1111');
    expect(commentStatements[2].sourceLine).toBe('%% 222');
    // Note: Comments parsed by the parser (not immediately after sequenceDiagram) may have trimmed indentation
    expect(commentStatements[3].sourceLine?.trim()).toBe('%% messages');

    // Verify all comments have data.text set
    commentStatements.forEach((comment, idx) => {
      const data = comment.data as { text?: string };
      expect(data.text).toBeDefined();
      log.debug(`Comment ${idx}: data.text="${data.text}"`);
    });
  });

  it('should preserve comments with blank lines after sequenceDiagram', () => {
    const input = `sequenceDiagram
%% comment 1

%% comment 2
    actor Alice`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // We have 4 statements total
    expect(ast.statements.length).toBe(4);
    expect(ast.statements[0].type).toBe('comment');
    expect(ast.statements[0].sourceLine).toBe('%% comment 1');
    expect(ast.statements[1].type).toBe('comment');
    expect(ast.statements[1].sourceLine).toBe('%% comment 2');
    // The blank line is added by the parser as a separate statement
    expect(ast.statements[2].type).toBe('blankLine');
    expect(ast.statements[3].type).toBe('actor');
  });

  it('should preserve comments in various positions', () => {
    const input = `sequenceDiagram
%% header comment
    actor Alice
    %% between participants
    actor Bob
    Alice ->> Bob: Hello
    %% between messages
    Bob ->> Alice: Hi`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // Count comments
    const commentStatements = ast.statements.filter((s) => s.type === 'comment');
    expect(commentStatements.length).toBe(3);

    // Verify comments are in the correct order
    // Note: Comments parsed by the parser may have trimmed indentation
    expect(commentStatements[0].sourceLine).toBe('%% header comment');
    expect(commentStatements[1].sourceLine?.trim()).toBe('%% between participants');
    expect(commentStatements[2].sourceLine?.trim()).toBe('%% between messages');
  });

  it('should not duplicate comments in AST', () => {
    const input = `sequenceDiagram
%% comment after header
    actor Alice
    %% comment in body
    Alice ->> Bob: Hello`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // Count comments - should be exactly 2, not duplicated
    const commentStatements = ast.statements.filter((s) => s.type === 'comment');
    expect(commentStatements.length).toBe(2);

    // Verify originalIndex values are unique
    const originalIndices = ast.statements.map((s) => s.originalIndex);
    const uniqueIndices = new Set(originalIndices);
    expect(uniqueIndices.size).toBe(originalIndices.length);
  });

  it('should handle hash-style comments after sequenceDiagram', () => {
    const input = `sequenceDiagram
# hash comment
    actor Alice`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // Should have comment and actor
    expect(ast.statements.length).toBe(2);
    expect(ast.statements[0].type).toBe('comment');
    expect(ast.statements[0].sourceLine).toBe('# hash comment');
    expect(ast.statements[1].type).toBe('actor');
  });

  it('should preserve multiple consecutive comments after sequenceDiagram', () => {
    const input = `sequenceDiagram
%% comment 1
%% comment 2
%% comment 3
%% comment 4
%% comment 5
    actor Alice`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine}"`
      );
    });

    // Should have 5 comments + 1 actor = 6 statements
    expect(ast.statements.length).toBe(6);

    // First 5 should be comments
    for (let i = 0; i < 5; i++) {
      expect(ast.statements[i].type).toBe('comment');
      expect(ast.statements[i].sourceLine).toBe(`%% comment ${i + 1}`);
    }

    // Last should be actor
    expect(ast.statements[5].type).toBe('actor');
  });
});
