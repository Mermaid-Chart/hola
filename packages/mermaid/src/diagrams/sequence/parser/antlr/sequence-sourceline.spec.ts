import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';

describe('Sequence AST sourceLine property', () => {
  it('should populate sourceLine for participant statements', () => {
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

    // Filter out blank lines for this test
    const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');

    // Check that we have 2 non-blank statements
    expect(nonBlankStatements).toHaveLength(2);

    // Check first statement (actor Alice)
    const aliceStatement = nonBlankStatements[0];
    expect(aliceStatement.type).toBe('actor');
    expect(aliceStatement.sourceLine).toBe('actor Alice');

    // Check second statement (participant Bob)
    const bobStatement = nonBlankStatements[1];
    expect(bobStatement.type).toBe('participant');
    expect(bobStatement.sourceLine).toBe('participant Bob');
  });

  it('should populate sourceLine for message statements', () => {
    const input = `sequenceDiagram
    Alice->>Bob: Hello Bob`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines for this test
    const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');

    // Check that we have 1 non-blank statement
    expect(nonBlankStatements).toHaveLength(1);

    // Check message statement
    const messageStatement = nonBlankStatements[0];
    expect(messageStatement.type).toBe('message');
    expect(messageStatement.sourceLine).toBe('Alice->>Bob: Hello Bob');
  });

  it('should populate sourceLine for note statements', () => {
    const input = `sequenceDiagram
    note right of Alice: This is a note`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines for this test
    const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');

    // Check that we have 1 non-blank statement
    expect(nonBlankStatements).toHaveLength(1);

    // Check note statement
    const noteStatement = nonBlankStatements[0];
    expect(noteStatement.type).toBe('note');
    expect(noteStatement.sourceLine).toBe('note right of Alice: This is a note');
  });

  it('should populate sourceLine for loop blocks', () => {
    const input = `sequenceDiagram
    loop Every minute
        Alice->>Bob: Great!
    end`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines for this test
    const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');

    // Check that we have 1 non-blank statement (the loop)
    expect(nonBlankStatements).toHaveLength(1);

    // Check loop statement
    const loopStatement = nonBlankStatements[0];
    expect(loopStatement.type).toBe('loop');
    expect(loopStatement.sourceLine).toContain('loop Every minute');
    expect(loopStatement.sourceLine).toContain('Alice->>Bob: Great!');
    expect(loopStatement.sourceLine).toContain('end');
  });

  it('should allow regenerating code from sourceLine when unchanged', () => {
    const input = `sequenceDiagram
    actor Alice
    Alice->>Bob: Hello Bob
    note right of Alice: This is a note`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Regenerate code from sourceLine properties
    const regeneratedStatements = ast.statements
      .map((stmt) => stmt.sourceLine)
      .filter((line) => line)
      .join('\n');

    // The regenerated statements should match the original (minus the header)
    const expectedStatements = `actor Alice
Alice->>Bob: Hello Bob
note right of Alice: This is a note`;

    expect(regeneratedStatements.trim()).toBe(expectedStatements.trim());
  });

  it('should populate sourceLine for autonumber statement', () => {
    const input = `sequenceDiagram
    autonumber`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const autonumberStmt = ast.statements.find((s) => s.type === 'autonumber');

    expect(autonumberStmt?.sourceLine).toBeDefined();
    expect(autonumberStmt?.sourceLine).toContain('autonumber');
  });

  it('should populate sourceLine for title statement', () => {
    const input = `sequenceDiagram
    title My Sequence Diagram`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const titleStmt = ast.statements.find((s) => s.type === 'title');

    expect(titleStmt?.sourceLine).toBeDefined();
    expect(titleStmt?.sourceLine).toContain('title My Sequence Diagram');
  });

  it('should populate sourceLine for opt block', () => {
    const input = `sequenceDiagram
    opt Optional
        Alice->>Bob: Hello
    end`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const optStmt = ast.statements.find((s) => s.type === 'opt');

    expect(optStmt?.sourceLine).toBeDefined();
    expect(optStmt?.sourceLine).toContain('opt Optional');
    expect(optStmt?.sourceLine).toContain('end');
  });

  it('should populate sourceLine for alt block', () => {
    const input = `sequenceDiagram
    alt Condition
        Alice->>Bob: Hello
    else
        Bob->>Alice: Hi
    end`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const altStmt = ast.statements.find((s) => s.type === 'alt');

    expect(altStmt?.sourceLine).toBeDefined();
    expect(altStmt?.sourceLine).toContain('alt Condition');
    expect(altStmt?.sourceLine).toContain('end');
  });

  it('should populate sourceLine for par block', () => {
    const input = `sequenceDiagram
    par
        Alice->>Bob: Hello
    and
        Alice->>Charlie: Hi
    end`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const parStmt = ast.statements.find((s) => s.type === 'par');

    expect(parStmt?.sourceLine).toBeDefined();
    expect(parStmt?.sourceLine).toContain('par');
    expect(parStmt?.sourceLine).toContain('end');
  });

  it('should populate sourceLine for comment statements', () => {
    const input = `sequenceDiagram
    %% This is a comment
    actor Alice
    %% Another comment
    participant Bob`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const commentStmts = ast.statements.filter((s) => s.type === 'comment');

    // Should have at least 2 comment statements
    expect(commentStmts.length).toBeGreaterThanOrEqual(2);

    const firstComment = commentStmts[0];
    expect(firstComment?.sourceLine).toBeDefined();
    expect(firstComment?.sourceLine).toContain('This is a comment');

    const secondComment = commentStmts[1];
    expect(secondComment?.sourceLine).toBeDefined();
    expect(secondComment?.sourceLine).toContain('Another comment');
  });
});
