import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import type { SequenceAST, CreateData, DestroyData } from '../../types.ts';

describe('Create and Destroy statements', () => {
  function parseSequenceDiagram(input: string): SequenceAST {
    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);
    return ast;
  }

  describe('Create statements', () => {
    it('should capture create participant statement in AST', () => {
      const input = `sequenceDiagram
    participant Alice
    Alice->>Bob: Hi Bob
    create participant Carl
    Alice->>Carl: Hi Carl`;

      const ast = parseSequenceDiagram(input);

      // Filter to get only create statements
      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(1);

      const createStmt = createStmts[0];
      expect(createStmt).toMatchObject({
        type: 'create',
        originalIndex: 2,
        sourceLine: 'create participant Carl',
      });

      const createData = createStmt.data as CreateData;
      expect(createData.participant).toBe('Carl');
      expect(createData.type).toBe('participant');
      expect(createData.alias).toBeUndefined();
    });

    it('should capture create participant with alias in AST', () => {
      const input = `sequenceDiagram
    Alice->>Bob: Hi Bob
    create participant Carl as Carlos
    Alice->>Carl: Hi Carlos`;

      const ast = parseSequenceDiagram(input);

      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(1);

      const createStmt = createStmts[0];
      expect(createStmt).toMatchObject({
        type: 'create',
        originalIndex: 1,
        sourceLine: 'create participant Carl as Carlos',
      });

      const createData = createStmt.data as CreateData;
      expect(createData.participant).toBe('Carl');
      expect(createData.type).toBe('participant');
      expect(createData.alias).toBe('Carlos');
    });

    it('should capture create actor statement in AST', () => {
      const input = `sequenceDiagram
    Alice->>Bob: Hi Bob
    create actor Donald
    Alice->>Donald: Hi Donald`;

      const ast = parseSequenceDiagram(input);

      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(1);

      const createStmt = createStmts[0];
      expect(createStmt).toMatchObject({
        type: 'create',
        originalIndex: 1,
        sourceLine: 'create actor Donald',
      });

      const createData = createStmt.data as CreateData;
      expect(createData.participant).toBe('Donald');
      expect(createData.type).toBe('actor');
      expect(createData.alias).toBeUndefined();
    });

    it('should capture create actor with alias in AST', () => {
      const input = `sequenceDiagram
    Alice->>Bob: Hi Bob
    create actor D as Donald
    Alice->>D: Hi Donald`;

      const ast = parseSequenceDiagram(input);

      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(1);

      const createStmt = createStmts[0];
      expect(createStmt).toMatchObject({
        type: 'create',
        originalIndex: 1,
        sourceLine: 'create actor D as Donald',
      });

      const createData = createStmt.data as CreateData;
      expect(createData.participant).toBe('D');
      expect(createData.type).toBe('actor');
      expect(createData.alias).toBe('Donald');
    });

    it('should capture multiple create statements in AST', () => {
      const input = `sequenceDiagram
    Alice->>Bob: Hi Bob
    create participant Carl
    Alice->>Carl: Hi Carl
    create actor D as Donald
    Carl->>D: Hi Donald`;

      const ast = parseSequenceDiagram(input);

      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(2);

      // First create statement
      expect(createStmts[0]).toMatchObject({
        type: 'create',
        originalIndex: 1,
        sourceLine: 'create participant Carl',
      });
      const createData1 = createStmts[0].data as CreateData;
      expect(createData1.participant).toBe('Carl');
      expect(createData1.type).toBe('participant');

      // Second create statement
      expect(createStmts[1]).toMatchObject({
        type: 'create',
        originalIndex: 3,
        sourceLine: 'create actor D as Donald',
      });
      const createData2 = createStmts[1].data as CreateData;
      expect(createData2.participant).toBe('D');
      expect(createData2.type).toBe('actor');
      expect(createData2.alias).toBe('Donald');
    });
  });

  describe('Destroy statements', () => {
    it('should capture destroy statement in AST', () => {
      const input = `sequenceDiagram
    participant Alice
    Alice->>Bob: Hi Bob
    destroy Alice
    Bob->>Alice: Bye Alice`;

      const ast = parseSequenceDiagram(input);

      const destroyStmts = ast.statements.filter((s) => s.type === 'destroy');
      expect(destroyStmts).toHaveLength(1);

      const destroyStmt = destroyStmts[0];
      expect(destroyStmt).toMatchObject({
        type: 'destroy',
        originalIndex: 2,
        sourceLine: 'destroy Alice',
      });

      const destroyData = destroyStmt.data as DestroyData;
      expect(destroyData.participant).toBe('Alice');
    });

    it('should capture multiple destroy statements in AST', () => {
      const input = `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hi Bob
    destroy Alice
    Bob->>Alice: Bye Alice
    destroy Bob
    Alice->>Bob: Bye Bob`;

      const ast = parseSequenceDiagram(input);

      const destroyStmts = ast.statements.filter((s) => s.type === 'destroy');
      expect(destroyStmts).toHaveLength(2);

      expect(destroyStmts[0]).toMatchObject({
        type: 'destroy',
        originalIndex: 3,
        sourceLine: 'destroy Alice',
      });
      const destroyData1 = destroyStmts[0].data as DestroyData;
      expect(destroyData1.participant).toBe('Alice');

      expect(destroyStmts[1]).toMatchObject({
        type: 'destroy',
        originalIndex: 5,
        sourceLine: 'destroy Bob',
      });
      const destroyData2 = destroyStmts[1].data as DestroyData;
      expect(destroyData2.participant).toBe('Bob');
    });
  });

  describe('Combined create and destroy statements', () => {
    it('should capture both create and destroy statements in correct order', () => {
      const input = `sequenceDiagram
    Alice->>Bob: Hello Bob, how are you ?
    Bob->>Alice: Fine, thank you. And you?
    create participant Carl
    Alice->>Carl: Hi Carl!
    create actor D as Donald
    Carl->>D: Hi!
    destroy Carl
    Alice->>Carl: We are too many
    destroy Bob
    Bob->>Alice: I agree`;

      const ast = parseSequenceDiagram(input);

      // Check total statement count (2 messages + 2 creates + 2 messages + 1 destroy + 1 message + 1 destroy + 1 message = 10)
      const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');
      expect(nonBlankStatements.length).toBe(10);

      // Check create statements
      const createStmts = ast.statements.filter((s) => s.type === 'create');
      expect(createStmts).toHaveLength(2);

      expect(createStmts[0].data).toMatchObject({
        participant: 'Carl',
        type: 'participant',
      });

      expect(createStmts[1].data).toMatchObject({
        participant: 'D',
        type: 'actor',
        alias: 'Donald',
      });

      // Check destroy statements
      const destroyStmts = ast.statements.filter((s) => s.type === 'destroy');
      expect(destroyStmts).toHaveLength(2);

      expect((destroyStmts[0].data as DestroyData).participant).toBe('Carl');
      expect((destroyStmts[1].data as DestroyData).participant).toBe('Bob');
    });

    it('should preserve originalIndex for all statements including create and destroy', () => {
      const input = `sequenceDiagram
    participant id1
    id1->>id2: message
    destroy id1`;

      const ast = parseSequenceDiagram(input);

      // Should have 3 statements: participant, message, destroy
      const nonBlankStatements = ast.statements.filter((s) => s.type !== 'blankLine');
      expect(nonBlankStatements.length).toBe(3);

      // Check originalIndex is sequential
      expect(nonBlankStatements[0].originalIndex).toBe(0);
      expect(nonBlankStatements[0].type).toBe('participant');

      expect(nonBlankStatements[1].originalIndex).toBe(1);
      expect(nonBlankStatements[1].type).toBe('message');

      expect(nonBlankStatements[2].originalIndex).toBe(2);
      expect(nonBlankStatements[2].type).toBe('destroy');
    });
  });
});
