/**
 * Parser Equivalence Tests
 *
 * These tests verify that the Jison parser produces ASTs with the same
 * structure and element mappings as the ANTLR parser, ensuring bidirectional
 * sync works identically regardless of parser used.
 */
import { describe, it, expect } from 'vitest';
import { parseFlowchartAST, forBothParsers } from './parseFlowchartAST.js';
import type { FlowchartAST } from '../../types.js';

// ────────────────────────────────────────────────────────────────
// Test cases: each entry is [label, source]
// ────────────────────────────────────────────────────────────────
const SIMPLE_CASES: [string, string][] = [
  [
    'basic edge',
    `flowchart TD
    A-->B`,
  ],
  [
    'edge with node shapes',
    `flowchart TD
    A[Start]-->B{Decision}`,
  ],
  [
    'multiple edges',
    `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`,
  ],
  [
    'standalone vertex',
    `flowchart LR
    A[Hello World]`,
  ],
  [
    'subgraph',
    `flowchart TD
    subgraph S1 [My Subgraph]
    A-->B
    end
    B-->C`,
  ],
];

// ────────────────────────────────────────────────────────────────
// Structural equivalence between ANTLR and Jison ASTs
// ────────────────────────────────────────────────────────────────
describe('Parser Equivalence: ANTLR vs Jison', () => {
  for (const [label, source] of SIMPLE_CASES) {
    describe(label, () => {
      let antlrAst: FlowchartAST;
      let jisonAst: FlowchartAST;

      it('both parsers should produce an AST', async () => {
        antlrAst = await parseFlowchartAST(source, 'antlr');
        jisonAst = await parseFlowchartAST(source, 'jison');
        expect(antlrAst).toBeDefined();
        expect(jisonAst).toBeDefined();
      });

      it('header and direction should match', async () => {
        antlrAst = await parseFlowchartAST(source, 'antlr');
        jisonAst = await parseFlowchartAST(source, 'jison');
        expect(jisonAst.header).toBe(antlrAst.header);
        expect(jisonAst.direction).toBe(antlrAst.direction);
      });

      it('statement count and types should match', async () => {
        antlrAst = await parseFlowchartAST(source, 'antlr');
        jisonAst = await parseFlowchartAST(source, 'jison');
        expect(jisonAst.statements.length).toBe(antlrAst.statements.length);
        for (let i = 0; i < antlrAst.statements.length; i++) {
          expect(jisonAst.statements[i].type).toBe(antlrAst.statements[i].type);
        }
      });

      it('element mapping types should match', async () => {
        antlrAst = await parseFlowchartAST(source, 'antlr');
        jisonAst = await parseFlowchartAST(source, 'jison');
        const antlrTypes = (antlrAst.elementMappings ?? [])
          .map((m) => m.type)
          .sort((a, b) => a.localeCompare(b));
        const jisonTypes = (jisonAst.elementMappings ?? [])
          .map((m) => m.type)
          .sort((a, b) => a.localeCompare(b));
        expect(jisonTypes).toEqual(antlrTypes);
      });

      it('sync methods should exist', async () => {
        jisonAst = await parseFlowchartAST(source, 'jison');
        expect(typeof jisonAst.getElementAtPosition).toBe('function');
        expect(typeof jisonAst.getElementByDataId).toBe('function');
        expect(typeof jisonAst.getElementsOnLine).toBe('function');
        expect(typeof jisonAst.getElementById).toBe('function');
        expect(typeof jisonAst.getElementAtIndex).toBe('function');
        expect(typeof jisonAst.getVertices).toBe('function');
        expect(typeof jisonAst.getEdges).toBe('function');
        expect(typeof jisonAst.getSubgraphs).toBe('function');
        expect(typeof jisonAst.getStats).toBe('function');
      });

      it('vertex and edge counts should match', async () => {
        antlrAst = await parseFlowchartAST(source, 'antlr');
        jisonAst = await parseFlowchartAST(source, 'jison');
        const antlrStats = antlrAst.getStats?.();
        const jisonStats = jisonAst.getStats?.();
        expect(jisonStats?.vertices).toBe(antlrStats?.vertices);
        expect(jisonStats?.edges).toBe(antlrStats?.edges);
        expect(jisonStats?.subgraphs).toBe(antlrStats?.subgraphs);
      });
    });
  }
});

// ────────────────────────────────────────────────────────────────
// Dual-parser: all sync methods should work for both parsers
// ────────────────────────────────────────────────────────────────
forBothParsers('Bidirectional Sync Methods', (parse) => {
  it('should find element at valid position', async () => {
    const ast = await parse(`flowchart TD
    A[Start]-->B{Decision}
    B-->C`);
    expect(ast.elementMappings!.length).toBeGreaterThan(0);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtPosition?.(first.position.startLine, first.position.startColumn);
    expect(found).toBeDefined();
  });

  it('should return undefined for out-of-range position', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    expect(ast.getElementAtPosition?.(9999, 9999)).toBeUndefined();
  });

  it('should find element by ID', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const first = ast.elementMappings![0];
    const found = ast.getElementById?.(first.id);
    expect(found).toBeDefined();
    expect(found?.id).toBe(first.id);
  });

  it('getVertices should return only vertices', async () => {
    const ast = await parse(`flowchart TD\n    A[Start]-->B`);
    const vertices = ast.getVertices?.();
    expect(vertices).toBeDefined();
    expect(vertices!.every((v) => v.type === 'vertex')).toBe(true);
  });

  it('getEdges should return only edges', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const edges = ast.getEdges?.();
    expect(edges).toBeDefined();
    expect(edges!.every((e) => e.type === 'edge')).toBe(true);
  });

  it('getStats totalElements should equal sum', async () => {
    const ast = await parse(`flowchart TD\n    A-->B\n    B-->C`);
    const stats = ast.getStats?.();
    expect(stats).toBeDefined();
    expect(stats!.totalElements).toBe(stats!.vertices + stats!.edges + stats!.subgraphs);
  });
});
