import { describe, it, expect, beforeEach } from 'vitest';
import { FlowDB } from '../../flowDb.js';
import antlrParser from '../flowAntlrParser.js';
import { setConfig } from '../../../../config.js';

setConfig({
  securityLevel: 'strict',
});

// Helper to get yy as FlowDB for test assertions
const getYY = (): FlowDB => antlrParser.parser.yy as FlowDB;

describe('Flowchart ANTLR Parser - Configuration Handling', () => {
  beforeEach(() => {
    const db = new FlowDB();
    antlrParser.parser.yy = db;
    db.clear();
  });

  it('should parse flowchart with init directive', () => {
    const input = `%%{init: { "flowchart": { "curve": "basis" }}}%%
flowchart TD
A-->B`;

    antlrParser.parser.parse(input);

    // Verify the diagram was parsed correctly
    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();

    const edges = getYY().getEdges();
    expect(edges.length).toBe(1);
    expect(edges[0].start).toBe('A');
    expect(edges[0].end).toBe('B');
  });

  it('should parse flowchart with multi-line init directive', () => {
    const input = `%%{
  init: {
    "theme": "dark",
    "flowchart": { "curve": "basis" }
  }
}%%
flowchart LR
A-->B-->C`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
    expect(vertices.get('C')).toBeDefined();

    const edges = getYY().getEdges();
    expect(edges.length).toBe(2);
  });

  it('should parse flowchart with YAML front matter', () => {
    const input = `---
title: Test Flowchart
config:
  theme: base
---
flowchart TD
A-->B`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
  });

  it('should parse flowchart with both YAML front matter and init directive', () => {
    const input = `---
title: Test Flowchart
---
%%{init: { "theme": "neutral" }}%%
flowchart LR
A-->B-->C`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
    expect(vertices.get('C')).toBeDefined();
  });

  it('should parse flowchart with blank lines before init directive', () => {
    const input = `

%%{init: { "theme": "dark" }}%%

flowchart TD
A-->B`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
  });

  it('should parse graph keyword with init directive', () => {
    const input = `%%{init: { "theme": "neutral" }}%%
graph TD
A-->B`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
  });

  it('should parse flowchart-elk keyword with init directive', () => {
    const input = `%%{init: { "theme": "base" }}%%
flowchart-elk TD
A-->B`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
  });

  it('should parse complex flowchart with init directive', () => {
    const input = `%%{init: { "theme": "dark", "flowchart": { "curve": "linear" }}}%%
flowchart TD
A[Start] --> B{Decision}
B -->|Yes| C[Option 1]
B -->|No| D[Option 2]
C --> E[End]
D --> E`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('A')?.text).toBe('Start');
    expect(vertices.get('B')).toBeDefined();
    expect(vertices.get('B')?.text).toBe('Decision');
    expect(vertices.get('C')).toBeDefined();
    expect(vertices.get('D')).toBeDefined();
    expect(vertices.get('E')).toBeDefined();

    const edges = getYY().getEdges();
    expect(edges.length).toBe(5);
  });

  it('should parse flowchart with YAML front matter containing complex config', () => {
    const input = `---
title: Complex Flowchart
config:
  theme: base
  themeVariables:
    primaryColor: "#ff0000"
---
flowchart TD
A-->B-->C`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
    expect(vertices.get('C')).toBeDefined();
  });

  it('should handle multiple init directives', () => {
    const input = `%%{init: { "theme": "dark" }}%%
%%{init: { "flowchart": { "curve": "basis" }}}%%
flowchart TD
A-->B`;

    antlrParser.parser.parse(input);

    const vertices = getYY().getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('B')).toBeDefined();
  });
});
