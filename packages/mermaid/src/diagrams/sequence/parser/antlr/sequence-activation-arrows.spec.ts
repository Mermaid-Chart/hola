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

  describe('Messages with empty text', () => {
    it('should parse message with empty text after colon', () => {
      const input = `sequenceDiagram
    Alice ->> John:`;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
      const data = ast.statements[0].data as any;
      expect(data.message).toBe('');
    });

    it('should parse all 4 messages including one with empty text', () => {
      const input = `sequenceDiagram
  participant Alice as Alice
  participant John as John

  Alice ->>+ John: Hello John, how are you?
  Alice ->>+ John: John, can you hear me?
  John -->>- Alice: Hi Alice, I can hear you!
  John -->>- Alice:`;

      const ast = parseSequenceDiagram(input);

      // Should have 2 participants + 1 blank line + 4 messages = 7 statements
      expect(ast.statements).toHaveLength(7);

      // Filter messages
      const messages = ast.statements.filter((s) => s.type === 'message');
      expect(messages).toHaveLength(4);

      // Check the 4th message (without text)
      const fourthMessage = messages[3];
      expect(fourthMessage.type).toBe('message');
      const fourthData = fourthMessage.data as any;
      expect(fourthData.from).toBe('John');
      expect(fourthData.to).toBe('Alice');
      expect(fourthData.arrow).toBe('-->>-');
      expect(fourthData.message).toBe('');
    });

    it('should parse message with only whitespace as empty text', () => {
      const input = `sequenceDiagram
    Alice ->> John:   `;

      const ast = parseSequenceDiagram(input);
      expect(ast.statements).toHaveLength(1);
      expect(ast.statements[0].type).toBe('message');
      const data = ast.statements[0].data as any;
      // Whitespace should be trimmed to empty string
      expect(data.message).toBe('');
    });
  });
});
