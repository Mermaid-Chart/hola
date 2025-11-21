import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import { log } from '../../../../logger.js';

describe('Sequence AST blank line preservation', () => {
  it('should preserve blank lines in the AST', () => {
    const input = `sequenceDiagram
    actor Alice
    participant Bob

    Alice->>Bob: Hello

    %% Comment
    Bob->>Alice: Hi`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Check if we can regenerate the original code from sourceLine
    const regenerated = ast.statements.map((stmt) => stmt.sourceLine || '').join('\n');

    log.debug('Original input:');
    log.debug(input);
    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(`${idx}: type=${stmt.type}, sourceLine="${stmt.sourceLine}"`);
    });
    log.debug('\nRegenerated:');
    log.debug(regenerated);

    // Count blank lines in AST
    const blankLineCount = ast.statements.filter((s) => s.type === 'blankLine').length;
    log.debug(`\nBlank lines in AST: ${blankLineCount}`);

    // We should have 2 blank lines:
    // 1. After participant Bob (before Alice->>Bob: Hello)
    // 2. After Alice->>Bob: Hello (before %% Comment)
    expect(blankLineCount).toBe(2);
  });

  it('should check what statements are created', () => {
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

    log.debug('\nStatements in AST:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(`${idx}: type=${stmt.type}, sourceLine="${stmt.sourceLine}"`);
    });

    // We expect 3 statements: actor, blankLine, participant
    // There is NO blank line after sequenceDiagram - only between actor and participant
    expect(ast.statements.length).toBe(3);
    expect(ast.statements[0].type).toBe('actor');
    expect(ast.statements[1].type).toBe('blankLine'); // Blank line between actor and participant
    expect(ast.statements[2].type).toBe('participant');
  });

  it('should capture ALL blank lines in the correct positions', () => {
    const input = `sequenceDiagram
    actor Alice

    participant Bob

    Alice->>Bob: Hello`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);

    // Debug: print all tokens
    log.debug('\nTokens:');
    tokenStream.fill();
    const tokens = tokenStream.getTokens();
    tokens.forEach((token, idx) => {
      const tokenName = lexer.vocabulary.getSymbolicName(token.type) || 'UNKNOWN';
      const text = token.text?.replace(/\n/g, '\\n').replace(/\r/g, '\\r') || '';
      log.debug(`${idx}: ${tokenName} = "${text}" (line ${token.line})`);
    });

    // Reset for parsing
    tokenStream.seek(0);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    log.debug('\nInput lines:');
    input.split('\n').forEach((line, idx) => {
      log.debug(`${idx}: "${line}"`);
    });

    log.debug('\nAST statements:');
    ast.statements.forEach((stmt, idx) => {
      log.debug(
        `${idx}: type=${stmt.type}, sourceLine="${stmt.sourceLine}", originalIndex=${stmt.originalIndex}`
      );
    });

    // We should have:
    // 0: actor Alice
    // 1: blankLine (blank line after actor)
    // 2: participant Bob
    // 3: blankLine (blank line after participant)
    // 4: message Alice->>Bob: Hello

    const blankLineCount = ast.statements.filter((s) => s.type === 'blankLine').length;
    log.debug(`\nBlank lines in AST: ${blankLineCount}`);
    log.debug(`Expected: 2 blank lines`);

    // Check that all originalIndex values are unique
    const indices = ast.statements.map((s) => s.originalIndex);
    const uniqueIndices = new Set(indices);
    log.debug(`\nOriginal indices: ${indices.join(', ')}`);
    log.debug(`Unique indices: ${uniqueIndices.size} (should be ${ast.statements.length})`);
    expect(uniqueIndices.size).toBe(ast.statements.length);
  });
});
