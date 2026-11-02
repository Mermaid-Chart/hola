import { describe, it, expect, beforeEach } from 'vitest';
import { ANTLRFlowParser } from './antlr-parser.js';
import { FlowDB } from '../../flowDb.js';

describe('Flowchart Error Handling', () => {
  let parser: ANTLRFlowParser;
  let db: FlowDB;

  beforeEach(() => {
    parser = new ANTLRFlowParser();
    db = new FlowDB();
    parser.yy = db;
  });

  it('should provide detailed error message for invalid syntax', () => {
    const input = `flowchart TD
      A-->B invalid syntax here
    `;

    expect(() => parser.parse(input)).toThrow(/Parse error on line \d+:\d+/);
  });

  it('should include line and column information in error message', () => {
    const input = `flowchart TD
A-->B invalid
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

  it('should parse valid diagrams without errors', () => {
    const input = `flowchart TD
    A-->B
    B-->C
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with node shapes without errors', () => {
    const input = `flowchart TD
    A[Rectangle]
    B(Rounded)
    C([Stadium])
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with subgraphs without errors', () => {
    const input = `flowchart TD
    subgraph S1
      A-->B
    end
    B-->C
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should provide error for unexpected token', () => {
    const input = `flowchart TD
    A-->B
    @@@
`;

    expect(() => parser.parse(input)).toThrow(/Parse error/);
  });

  it('should include hash property in error for Jison compatibility', () => {
    const input = `flowchart TD
A-->B invalid
`;

    try {
      parser.parse(input);
      expect.fail('Should have thrown an error');
    } catch (error) {
      expect(error).toBeInstanceOf(Error);
      // Check that the error has a hash property (Jison compatibility)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).hash).toBeDefined();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).hash).toHaveProperty('line');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).hash).toHaveProperty('loc');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).hash.loc).toHaveProperty('first_line');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((error as any).hash.loc).toHaveProperty('first_column');
    }
  });

  it('should parse flowchart with styles without errors', () => {
    const input = `flowchart TD
    A-->B
    style A fill:#f9f,stroke:#333
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with classes without errors', () => {
    const input = `flowchart TD
    A-->B
    classDef myClass fill:#f96
    class A myClass
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with click interactions without errors', () => {
    const input = `flowchart TD
    A-->B
    click A "http://example.com" "Tooltip"
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with link styles without errors', () => {
    const input = `flowchart TD
    A-->B
    B-->C
    linkStyle 0 stroke:#ff3,stroke-width:4px
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with direction changes without errors', () => {
    const input = `flowchart TD
    A-->B
    direction LR
    B-->C
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with accessibility statements without errors', () => {
    const input = `flowchart TD
    accTitle: My Flowchart
    accDescr: This is a description
    A-->B
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should handle multiple valid statements without errors', () => {
    const input = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D
    style A fill:#f9f
    style D fill:#bbf
    classDef important fill:#f96
    class B important
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with edge text without errors', () => {
    const input = `flowchart TD
    A-->|Edge text|B
    B-- Another text -->C
`;

    expect(() => parser.parse(input)).not.toThrow();
  });

  it('should parse flowchart with different edge types without errors', () => {
    const input = `flowchart TD
    A-->B
    B-.->C
    C==>D
    D~~~E
`;

    expect(() => parser.parse(input)).not.toThrow();
  });
});
