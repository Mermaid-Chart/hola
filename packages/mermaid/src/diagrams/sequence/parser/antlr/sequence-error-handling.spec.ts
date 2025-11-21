import { describe, it, expect } from 'vitest';
import { ANTLRSequenceParser } from './antlr-parser.js';

describe('Sequence Diagram Error Handling', () => {
  it('should provide detailed error message for invalid syntax', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram

%% Hello
Alice-->Bob 21
`;

    expect(() => parser.parse(input)).toThrow(/Parse error on line \d+:\d+/);
  });

  it('should include line and column information in error message', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram
Alice-->Bob 21
`;

    try {
      parser.parse(input);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      expect(message).toMatch(/line \d+/);
      expect(message).toMatch(/:\d+/); // column number
    }
  });

  it('should provide helpful error message for missing message text', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram
Alice-->Bob
`;

    try {
      parser.parse(input);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      const message = (error as Error).message;
      // Should contain line number and some indication of what went wrong
      expect(message).toMatch(/Parse error/);
    }
  });

  it('should parse valid diagrams without errors', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram
Alice-->Bob: Hello
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should provide error for unexpected token', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram
Alice-->Bob: Hello
@@@
`;

    expect(() => parser.parse(input)).toThrow(/Parse error/);
  });

  it('should include hash property in error for Jison compatibility', () => {
    const parser = new ANTLRSequenceParser();
    const input = `sequenceDiagram
Alice-->Bob 21
`;

    try {
      parser.parse(input);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      // Check that the error has a hash property (Jison compatibility)
      expect((error as any).hash).toBeDefined();
      expect((error as any).hash).toHaveProperty('line');
      expect((error as any).hash).toHaveProperty('loc');
      expect((error as any).hash.loc).toHaveProperty('first_line');
      expect((error as any).hash.loc).toHaveProperty('first_column');
    }
  });
});
