import { describe, it, expect } from 'vitest';
import { CharStream } from 'antlr4ng';
import { FlowLexer } from './generated/FlowLexer.js';

function lex(input: string) {
  const inputStream = CharStream.fromString(input);
  const lexer = new FlowLexer(inputStream);
  return lexer.getAllTokens();
}

function names(tokens: any[]) {
  return tokens.map((t) => lexer.vocabulary.getSymbolicName(t.type) || '');
}

const lexer = new FlowLexer(CharStream.fromString(''));

describe('Flowchart ANTLR Lexer - headerMode (before flowchart/graph)', () => {
  it('skips YAML front matter before header', () => {
    const input =
      `---\n` +
      `title: Front matter title\n` +
      `config:\n` +
      `  theme: base\n` +
      `---\n` +
      `flowchart TD\n` +
      `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('FRONTMATTER');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
    expect(ns[i + 1]).toBe('DIR');
  });

  it('accepts header comments and blank lines before header', () => {
    const input = `%% percent comment\n` + `\n` + `flowchart LR\n` + `A-->B`;
    const ns = names(lex(input));
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
  });

  it('skips single-line init directive before header', () => {
    const input = `%%{init: { "flowchart": { "curve": "basis" }}}%%\n` + `flowchart TD\n` + `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
    expect(ns[i + 1]).toBe('DIR');
  });

  it('skips multi-line init directive before header', () => {
    const input =
      `%%{\n` +
      `  init: {\n` +
      `    "theme": "dark",\n` +
      `    "flowchart": { "curve": "basis" }\n` +
      `  }\n` +
      `}%%\n` +
      `flowchart LR\n` +
      `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
  });

  it('supports initialize alias in header directive', () => {
    const input =
      `%%{initialize: { "flowchart": { "curve": "linear" }}}%%\n` + `flowchart TD\n` + `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
  });

  it('handles graph keyword instead of flowchart', () => {
    const input = `%%{init: { "theme": "forest" }}%%\n` + `graph TD\n` + `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
  });

  it('handles flowchart-elk keyword', () => {
    const input = `%%{init: { "theme": "dark" }}%%\n` + `flowchart-elk TD\n` + `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
    expect(ns[i]).toBe('GRAPH');
  });

  it('handles multiple header directives', () => {
    const input =
      `%%{init: { "theme": "dark" }}%%\n` +
      `%%{init: { "flowchart": { "curve": "basis" }}}%%\n` +
      `flowchart TD\n` +
      `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('HEADER_DIRECTIVE');
    expect(ns[1]).toBe('NEWLINE');
    expect(ns[2]).toBe('HEADER_DIRECTIVE');
    const i = ns.indexOf('GRAPH');
    expect(i).toBeGreaterThanOrEqual(0);
  });

  it('handles YAML front matter with header directive', () => {
    const input =
      `---\n` +
      `title: My Flowchart\n` +
      `---\n` +
      `%%{init: { "theme": "neutral" }}%%\n` +
      `flowchart LR\n` +
      `A-->B`;
    const ns = names(lex(input));
    expect(ns[0]).toBe('FRONTMATTER');
    const headerIdx = ns.indexOf('HEADER_DIRECTIVE');
    expect(headerIdx).toBeGreaterThanOrEqual(0);
    const graphIdx = ns.indexOf('GRAPH');
    expect(graphIdx).toBeGreaterThan(headerIdx);
  });

  it('does not treat %%{init}%% as comment after header', () => {
    const input = `flowchart TD\n` + `A-->B\n` + `%%{init: { "theme": "dark" }}%%`;
    const ns = names(lex(input));
    const i = ns.indexOf('GRAPH');
    expect(i).toBe(0);
    // After the header, %%{...}%% should not be treated as HEADER_DIRECTIVE
    // It should be ignored or treated as a comment
    expect(ns).not.toContain('HEADER_DIRECTIVE');
  });

  it('handles blank lines and comments before YAML front matter', () => {
    const input =
      `\n` +
      `%% This is a comment\n` +
      `\n` +
      `---\n` +
      `title: Test\n` +
      `---\n` +
      `flowchart TD\n` +
      `A-->B`;
    const ns = names(lex(input));
    const frontmatterIdx = ns.indexOf('FRONTMATTER');
    expect(frontmatterIdx).toBeGreaterThanOrEqual(0);
    const graphIdx = ns.indexOf('GRAPH');
    expect(graphIdx).toBeGreaterThan(frontmatterIdx);
  });
});
