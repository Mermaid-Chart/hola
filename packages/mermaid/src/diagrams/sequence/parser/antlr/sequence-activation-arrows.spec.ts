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

describe('Activation/Deactivation markers on different arrow types', () => {
  describe('Working arrow types (baseline)', () => {
    it('should parse solid open arrow with activation marker (->+)', () => {
      const input = `sequenceDiagram
    Alice->+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted open arrow with activation marker (-->+)', () => {
      const input = `sequenceDiagram
    Alice-->+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse solid point arrow with activation marker (->>+)', () => {
      const input = `sequenceDiagram
    Alice->>+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted point arrow with activation marker (-->>+)', () => {
      const input = `sequenceDiagram
    Alice-->>+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });
  });

  describe('Broken arrow types - async arrows', () => {
    it('should parse solid async arrow with activation marker (-)+ )', () => {
      const input = `sequenceDiagram
    Alice-)+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse solid async arrow with deactivation marker (-)- )', () => {
      const input = `sequenceDiagram
    Alice-)-Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted async arrow with activation marker (--)+ )', () => {
      const input = `sequenceDiagram
    Alice--)+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted async arrow with deactivation marker (--)- )', () => {
      const input = `sequenceDiagram
    Alice--)-Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });
  });

  describe('Broken arrow types - cross arrows', () => {
    it('should parse solid cross arrow with activation marker (-x+)', () => {
      const input = `sequenceDiagram
    Alice-x+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse solid cross arrow with deactivation marker (-x-)', () => {
      const input = `sequenceDiagram
    Alice-x-Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted cross arrow with activation marker (--x+)', () => {
      const input = `sequenceDiagram
    Alice--x+Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });

    it('should parse dotted cross arrow with deactivation marker (--x-)', () => {
      const input = `sequenceDiagram
    Alice--x-Bob: Hello`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
    });
  });
});
