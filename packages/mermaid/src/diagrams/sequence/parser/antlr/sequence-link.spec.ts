import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import type { SequenceAST, LinkData, LinksData } from '../../types.ts';

describe('Sequence Diagram Link Statements', () => {
  function parseSequence(input: string): SequenceAST {
    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);
    return ast;
  }

  it('should parse single link statement', () => {
    const input = `sequenceDiagram
    participant Alice
    link Alice: Dashboard @ https://dashboard.contoso.com/alice`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(2);
    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[1].type).toBe('link');

    const linkStmt = ast.statements[1];
    expect(linkStmt.originalIndex).toBe(1);
    expect((linkStmt.data as LinkData).participant).toBe('Alice');
    expect((linkStmt.data as LinkData).linkName).toBe('Dashboard');
    expect((linkStmt.data as LinkData).linkUrl).toBe('https://dashboard.contoso.com/alice');
  });

  it('should parse multiple link statements', () => {
    const input = `sequenceDiagram
    participant Alice
    participant John
    link Alice: Dashboard @ https://dashboard.contoso.com/alice
    link Alice: Wiki @ https://wiki.contoso.com/alice
    link John: Dashboard @ https://dashboard.contoso.com/john
    link John: Wiki @ https://wiki.contoso.com/john`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(6);
    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[1].type).toBe('participant');
    expect(ast.statements[2].type).toBe('link');
    expect(ast.statements[3].type).toBe('link');
    expect(ast.statements[4].type).toBe('link');
    expect(ast.statements[5].type).toBe('link');

    // Check first link
    const link1 = ast.statements[2];
    expect((link1.data as LinkData).participant).toBe('Alice');
    expect((link1.data as LinkData).linkName).toBe('Dashboard');
    expect((link1.data as LinkData).linkUrl).toBe('https://dashboard.contoso.com/alice');

    // Check second link
    const link2 = ast.statements[3];
    expect((link2.data as LinkData).participant).toBe('Alice');
    expect((link2.data as LinkData).linkName).toBe('Wiki');
    expect((link2.data as LinkData).linkUrl).toBe('https://wiki.contoso.com/alice');

    // Check third link
    const link3 = ast.statements[4];
    expect((link3.data as LinkData).participant).toBe('John');
    expect((link3.data as LinkData).linkName).toBe('Dashboard');
    expect((link3.data as LinkData).linkUrl).toBe('https://dashboard.contoso.com/john');

    // Check fourth link
    const link4 = ast.statements[5];
    expect((link4.data as LinkData).participant).toBe('John');
    expect((link4.data as LinkData).linkName).toBe('Wiki');
    expect((link4.data as LinkData).linkUrl).toBe('https://wiki.contoso.com/john');
  });

  it('should parse links statement with multiple key-value pairs', () => {
    const input = `sequenceDiagram
    participant Alice
    links Alice: Dashboard: https://dashboard.contoso.com/alice, Wiki: https://wiki.contoso.com/alice`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(2);
    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[1].type).toBe('links');

    const linksStmt = ast.statements[1];
    expect(linksStmt.originalIndex).toBe(1);
    expect((linksStmt.data as LinksData).participant).toBe('Alice');
    expect((linksStmt.data as LinksData).links).toEqual({
      Dashboard: 'https://dashboard.contoso.com/alice',
      Wiki: 'https://wiki.contoso.com/alice',
    });
  });

  it('should parse link and links statements together', () => {
    const input = `sequenceDiagram
    participant Alice
    participant John
    link Alice: Dashboard @ https://dashboard.contoso.com/alice
    links John: Dashboard: https://dashboard.contoso.com/john, Wiki: https://wiki.contoso.com/john`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(4);
    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[1].type).toBe('participant');
    expect(ast.statements[2].type).toBe('link');
    expect(ast.statements[3].type).toBe('links');

    // Check link statement
    const linkStmt = ast.statements[2];
    expect((linkStmt.data as LinkData).participant).toBe('Alice');
    expect((linkStmt.data as LinkData).linkName).toBe('Dashboard');
    expect((linkStmt.data as LinkData).linkUrl).toBe('https://dashboard.contoso.com/alice');

    // Check links statement
    const linksStmt = ast.statements[3];
    expect((linksStmt.data as LinksData).participant).toBe('John');
    expect((linksStmt.data as LinksData).links).toEqual({
      Dashboard: 'https://dashboard.contoso.com/john',
      Wiki: 'https://wiki.contoso.com/john',
    });
  });

  it('should parse link statements with messages', () => {
    const input = `sequenceDiagram
    participant Alice
    participant John
    link Alice: Dashboard @ https://dashboard.contoso.com/alice
    link Alice: Wiki @ https://wiki.contoso.com/alice
    link John: Dashboard @ https://dashboard.contoso.com/john
    link John: Wiki @ https://wiki.contoso.com/john
    Alice->>John: Hello John, how are you?`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(7);
    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[1].type).toBe('participant');
    expect(ast.statements[2].type).toBe('link');
    expect(ast.statements[3].type).toBe('link');
    expect(ast.statements[4].type).toBe('link');
    expect(ast.statements[5].type).toBe('link');
    expect(ast.statements[6].type).toBe('message');
  });

  it('should preserve originalIndex for link statements', () => {
    const input = `sequenceDiagram
    participant Alice
    link Alice: Dashboard @ https://dashboard.contoso.com/alice
    participant John
    link John: Wiki @ https://wiki.contoso.com/john`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(4);
    expect(ast.statements[0].originalIndex).toBe(0);
    expect(ast.statements[1].originalIndex).toBe(1);
    expect(ast.statements[2].originalIndex).toBe(2);
    expect(ast.statements[3].originalIndex).toBe(3);
  });

  it('should handle link names with spaces', () => {
    const input = `sequenceDiagram
    participant Alice
    link Alice: My Dashboard @ https://dashboard.contoso.com/alice`;

    const ast = parseSequence(input);

    expect(ast.statements).toHaveLength(2);
    expect(ast.statements[1].type).toBe('link');

    const linkStmt = ast.statements[1];
    expect((linkStmt.data as LinkData).linkName).toBe('My Dashboard');
    expect((linkStmt.data as LinkData).linkUrl).toBe('https://dashboard.contoso.com/alice');
  });
});
