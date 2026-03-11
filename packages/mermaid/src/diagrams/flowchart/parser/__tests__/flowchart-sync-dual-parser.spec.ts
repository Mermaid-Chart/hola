/**
 * Dual-parser sync tests.
 *
 * Every test in this file runs for BOTH the ANTLR and Jison parsers,
 * ensuring bidirectional sync works identically regardless of parser.
 */
import { it, expect } from 'vitest';
import { forBothParsers, parseFlowchartAST } from './parseFlowchartAST.js';

// ────────────────────────────────────────────────────────────────
// Basic AST structure
// ────────────────────────────────────────────────────────────────
forBothParsers('AST Structure', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`;

  it('should have element mappings', async () => {
    const ast = await parse(code);
    expect(ast.elementMappings).toBeDefined();
    expect(Array.isArray(ast.elementMappings)).toBe(true);
  });

  it('should have statements', async () => {
    const ast = await parse(code);
    expect(ast.statements).toBeDefined();
    expect(ast.statements.length).toBeGreaterThan(0);
  });

  it('should normalise TD to TB', async () => {
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('TB');
  });

  it('should have position info for each mapping', async () => {
    const ast = await parse(code);
    ast.elementMappings!.forEach((m) => {
      expect(m.position.startLine).toBeGreaterThan(0);
      expect(m.position.startColumn).toBeGreaterThanOrEqual(0);
      expect(m.position.endLine).toBeGreaterThan(0);
      expect(m.position.endColumn).toBeGreaterThan(0);
      expect(m.position.startIndex).toBeGreaterThanOrEqual(0);
      expect(m.position.endIndex).toBeGreaterThanOrEqual(0);
    });
  });

  it('should have unique IDs', async () => {
    const ast = await parse(code);
    const ids = ast.elementMappings!.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ────────────────────────────────────────────────────────────────
// Sync method tests
// ────────────────────────────────────────────────────────────────
forBothParsers('getElementAtPosition', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`;

  it('should find element at first mapping position', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtPosition?.(first.position.startLine, first.position.startColumn);
    expect(found).toBeDefined();
  });

  it('should return undefined for far-out position', async () => {
    const ast = await parse(code);
    expect(ast.getElementAtPosition?.(9999, 9999)).toBeUndefined();
  });
});

forBothParsers('getElementById', (parse) => {
  const code = `flowchart TD\n    A-->B`;

  it('should find element by ID', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementById?.(first.id);
    expect(found?.id).toBe(first.id);
  });

  it('should return undefined for non-existent ID', async () => {
    const ast = await parse(code);
    expect(ast.getElementById?.('non-existent-id-99')).toBeUndefined();
  });
});

forBothParsers('getElementAtIndex', (parse) => {
  it('should find element at character index', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtIndex?.(first.position.startIndex);
    expect(found).toBeDefined();
  });

  it('should return undefined for far-out index', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    expect(ast.getElementAtIndex?.(999999)).toBeUndefined();
  });
});

forBothParsers('getElementsOnLine', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`;

  it('should return empty for line with no elements', async () => {
    const ast = await parse(code);
    expect(ast.getElementsOnLine?.(9999)).toEqual([]);
  });

  it('should return vertices and edge on edge line', async () => {
    const ast = await parse(code);
    const elems = ast.getElementsOnLine!(2);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    expect(elems.filter((e) => e.type === 'vertex').length).toBeGreaterThanOrEqual(2);
  });

  it('line 5 (C-->D) should have at least 3 elements', async () => {
    const ast = await parse(code);
    const elems = ast.getElementsOnLine!(5);
    expect(elems.length).toBeGreaterThanOrEqual(3);
    expect(elems.map((e) => e.type)).toContain('edge');
  });
});

forBothParsers('Type Filtering', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->C
    C-->D`;

  it('getVertices returns only vertices', async () => {
    const ast = await parse(code);
    const v = ast.getVertices!();
    expect(v.length).toBeGreaterThan(0);
    expect(v.every((x) => x.type === 'vertex')).toBe(true);
  });

  it('getEdges returns only edges', async () => {
    const ast = await parse(code);
    const e = ast.getEdges!();
    expect(e.length).toBeGreaterThan(0);
    expect(e.every((x) => x.type === 'edge')).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Edge SVG ID tests
// ────────────────────────────────────────────────────────────────
forBothParsers('Edge SVG IDs', (parse) => {
  it('edges should have svgId in L_start_end_counter format', async () => {
    const ast = await parse(`flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`);
    const edges = ast.getEdges!();
    expect(edges.length).toBeGreaterThan(0);
    edges.forEach((e) => {
      const svgId = (e.data as { svgId?: string }).svgId;
      expect(svgId).toBeDefined();
      expect(svgId).toMatch(/^L_\w+_\w+_\d+$/);
    });
  });

  it('edge A→B should be L_A_B_0', async () => {
    const ast = await parse(`flowchart TD
    A[Start]-->B{Decision}
    B-->C`);
    const edges = ast.getEdges!();
    const edgeAB = edges.find((e) => {
      const d = e.data as { start?: string; end?: string };
      return d.start === 'A' && d.end === 'B';
    });
    expect((edgeAB!.data as { svgId?: string }).svgId).toBe('L_A_B_0');
  });
});

// ────────────────────────────────────────────────────────────────
// Vertex references in edge statements
// ────────────────────────────────────────────────────────────────
forBothParsers('Vertex References in Edges', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`;

  it('should have vertex mappings for A, B, C, D', async () => {
    const ast = await parse(code);
    const verts = ast.getVertices!();
    expect(verts.length).toBeGreaterThanOrEqual(4);
    const ids = verts.map((v) => (v.data as { id?: string }).id).filter(Boolean);
    expect(ids).toContain('A');
    expect(ids).toContain('B');
    expect(ids).toContain('C');
    expect(ids).toContain('D');
  });
});

// ────────────────────────────────────────────────────────────────
// Ampersand chain tests
// ────────────────────────────────────────────────────────────────
forBothParsers('Ampersand Chain A --> B & C', (parse) => {
  it('should create 2 edges (A→B, A→C)', async () => {
    const ast = await parse(`flowchart LR\nA --> B & C`);
    const edges = ast.getEdges!();
    expect(edges.length).toBe(2);

    const data = edges.map((e) => ({
      start: (e.data as { start?: string }).start,
      end: (e.data as { end?: string }).end,
      svgId: (e.data as { svgId?: string }).svgId,
    }));

    expect(data.find((e) => e.start === 'A' && e.end === 'B')?.svgId).toBe('L_A_B_0');
    expect(data.find((e) => e.start === 'A' && e.end === 'C')?.svgId).toBe('L_A_C_0');
  });

  it('line 2 should have 3 vertices and 2 edges', async () => {
    const ast = await parse(`flowchart LR\nA --> B & C`);
    const elems = ast.getElementsOnLine!(2);
    expect(elems.filter((e) => e.type === 'vertex').length).toBeGreaterThanOrEqual(3);
    expect(elems.filter((e) => e.type === 'edge').length).toBe(2);
  });
});

forBothParsers('Ampersand Chain A & B --> C', (parse) => {
  it('should create 2 edges (A→C, B→C)', async () => {
    const ast = await parse(`flowchart LR\nA & B --> C`);
    const edges = ast.getEdges!();
    expect(edges.length).toBe(2);

    const data = edges.map((e) => ({
      start: (e.data as { start?: string }).start,
      end: (e.data as { end?: string }).end,
      svgId: (e.data as { svgId?: string }).svgId,
    }));

    expect(data.find((e) => e.start === 'A' && e.end === 'C')?.svgId).toBe('L_A_C_0');
    expect(data.find((e) => e.start === 'B' && e.end === 'C')?.svgId).toBe('L_B_C_0');
  });
});

// ────────────────────────────────────────────────────────────────
// Chained edge tests
// ────────────────────────────────────────────────────────────────
forBothParsers('Chained Edges A --> B --> C', (parse) => {
  it('should create 2 edges (A→B, B→C)', async () => {
    const ast = await parse(`flowchart LR\n    A --> B --> C`);
    const edges = ast.getEdges!();
    expect(edges.length).toBe(2);

    const data = edges.map((e) => ({
      start: (e.data as { start?: string }).start,
      end: (e.data as { end?: string }).end,
      svgId: (e.data as { svgId?: string }).svgId,
    }));

    expect(data.find((e) => e.start === 'A' && e.end === 'B')?.svgId).toBe('L_A_B_0');
    expect(data.find((e) => e.start === 'B' && e.end === 'C')?.svgId).toBe('L_B_C_0');
  });

  it('line 2 should have 3 vertices + 2 edges', async () => {
    const ast = await parse(`flowchart LR\n    A --> B --> C`);
    const elems = ast.getElementsOnLine!(2);
    expect(elems.filter((e) => e.type === 'vertex').length).toBeGreaterThanOrEqual(3);
    expect(elems.filter((e) => e.type === 'edge').length).toBe(2);
    const edgeSvgIds = elems
      .filter((e) => e.type === 'edge')
      .map((e) => (e.data as { svgId?: string }).svgId);
    expect(edgeSvgIds).toContain('L_A_B_0');
    expect(edgeSvgIds).toContain('L_B_C_0');
  });
});

// ────────────────────────────────────────────────────────────────
// Subgraph tests
// ────────────────────────────────────────────────────────────────
forBothParsers('Subgraph Highlighting', (parse) => {
  const code = `flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    end`;

  it('should create 2 subgraph mappings', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    expect(sgs.length).toBe(2);
    const ids = sgs.map((s) => (s.data as { id?: string }).id);
    expect(ids).toContain('one');
    expect(ids).toContain('two');
  });

  it('subgraph declaration line should return subgraph element', async () => {
    const ast = await parse(code);
    const line3 = ast.getElementsOnLine!(3);
    const sgElems = line3.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
    expect((sgElems[0].data as { id?: string }).id).toBe('one');

    const line6 = ast.getElementsOnLine!(6);
    const sgElems6 = line6.filter((e) => e.type === 'subgraph');
    expect(sgElems6.length).toBe(1);
    expect((sgElems6[0].data as { id?: string }).id).toBe('two');
  });
});

// ────────────────────────────────────────────────────────────────
// getStats
// ────────────────────────────────────────────────────────────────
forBothParsers('getStats', (parse) => {
  it('totalElements = vertices + edges + subgraphs', async () => {
    const ast = await parse(`flowchart TD
    A-->B
    B-->C`);
    const s = ast.getStats!();
    expect(s.totalElements).toBe(s.vertices + s.edges + s.subgraphs);
  });

  it('should count correctly', async () => {
    const ast = await parse(`flowchart TD
    A-->B
    B-->C`);
    const s = ast.getStats!();
    expect(s.vertices).toBeGreaterThanOrEqual(3);
    expect(s.edges).toBe(2);
    expect(s.subgraphs).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────
// getElementByDataId
// ────────────────────────────────────────────────────────────────
forBothParsers('getElementByDataId', (parse) => {
  it('should find vertex by node ID', async () => {
    const ast = await parse(`flowchart TD\n    A[Start]-->B`);
    const found = ast.getElementByDataId?.('A');
    expect(found).toBeDefined();
    expect(found?.type).toBe('vertex');
    expect((found?.data as { id?: string }).id).toBe('A');
  });

  it('should find edge by svgId', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const found = ast.getElementByDataId?.('L_A_B_0');
    expect(found).toBeDefined();
    expect(found?.type).toBe('edge');
  });

  it('should find subgraph by ID', async () => {
    const ast = await parse(`flowchart TB
    subgraph one
    A-->B
    end`);
    const found = ast.getElementByDataId?.('one');
    expect(found).toBeDefined();
    expect(found?.type).toBe('subgraph');
  });

  it('should return undefined for unknown ID', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    expect(ast.getElementByDataId?.('ZZZZZ')).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// Comment handling tests — line numbers must match original source
// ────────────────────────────────────────────────────────────────
forBothParsers('Comments: line numbers match original source', (parse) => {
  const codeWithComments = `flowchart LR
  A[Start] --Some text--> B(Continue)
  %% hello
  B --> C{Evaluate}
    %% hello 1
  C -- One --> D[Option 1]
    %% hello 2
      %% hello 3
        %% hello 4
  C -- Two --> E[Option 2]
  C -- Three --> F[fa:fa-car Option 3]`;

  it('should have correct number of edges', async () => {
    const ast = await parse(codeWithComments);
    const edges = ast.getEdges!();
    expect(edges.length).toBe(5);
  });

  it('should have correct number of vertices', async () => {
    const ast = await parse(codeWithComments);
    const verts = ast.getVertices!();
    // A, B, C, D, E, F — each referenced at least once
    const uniqueIds = new Set(verts.map((v) => (v.data as { id?: string }).id));
    expect(uniqueIds.size).toBeGreaterThanOrEqual(6);
  });

  it('line 2 (A-->B) should have vertex A, vertex B, and edge', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(2);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    const vertexIds = elems
      .filter((e) => e.type === 'vertex')
      .map((e) => (e.data as { id?: string }).id);
    expect(vertexIds).toContain('A');
    expect(vertexIds).toContain('B');
  });

  it('line 3 (%% hello) should NOT highlight B-->C elements', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(3);
    // Comment line should either have no elements or only a comment element
    const nonCommentElems = elems.filter((e) => e.type !== 'comment');
    expect(nonCommentElems.length).toBe(0);
  });

  it('line 4 (B-->C) should have vertex B, vertex C, and edge', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(4);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    const vertexIds = elems
      .filter((e) => e.type === 'vertex')
      .map((e) => (e.data as { id?: string }).id);
    expect(vertexIds).toContain('B');
    expect(vertexIds).toContain('C');
  });

  it('line 5 (%% hello 1) should NOT highlight any elements', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(5);
    const nonCommentElems = elems.filter((e) => e.type !== 'comment');
    expect(nonCommentElems.length).toBe(0);
  });

  it('line 6 (C-->D) should have vertex C, vertex D, and edge', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(6);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    const vertexIds = elems
      .filter((e) => e.type === 'vertex')
      .map((e) => (e.data as { id?: string }).id);
    expect(vertexIds).toContain('C');
    expect(vertexIds).toContain('D');
  });

  it('lines 7-9 (comments) should NOT highlight any elements', async () => {
    const ast = await parse(codeWithComments);
    for (const line of [7, 8, 9]) {
      const elems = ast.getElementsOnLine!(line);
      const nonCommentElems = elems.filter((e) => e.type !== 'comment');
      expect(nonCommentElems.length).toBe(0);
    }
  });

  it('line 10 (C-->E) should have vertex C, vertex E, and edge', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(10);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    const vertexIds = elems
      .filter((e) => e.type === 'vertex')
      .map((e) => (e.data as { id?: string }).id);
    expect(vertexIds).toContain('C');
    expect(vertexIds).toContain('E');
  });

  it('line 11 (C-->F) should have vertex C, vertex F, and edge', async () => {
    const ast = await parse(codeWithComments);
    const elems = ast.getElementsOnLine!(11);
    const types = elems.map((e) => e.type);
    expect(types).toContain('vertex');
    expect(types).toContain('edge');
    const vertexIds = elems
      .filter((e) => e.type === 'vertex')
      .map((e) => (e.data as { id?: string }).id);
    expect(vertexIds).toContain('C');
    expect(vertexIds).toContain('F');
  });
});

// ────────────────────────────────────────────────────────────────
// Comment equivalence: ANTLR vs Jison line numbers must match
// ────────────────────────────────────────────────────────────────

describe('Comment Line Number Equivalence: ANTLR vs Jison', () => {
  const codeWithComments = `flowchart LR
  A[Start] --Some text--> B(Continue)
  %% hello
  B --> C{Evaluate}
    %% hello 1
  C -- One --> D[Option 1]
    %% hello 2
      %% hello 3
        %% hello 4
  C -- Two --> E[Option 2]
  C -- Three --> F[fa:fa-car Option 3]`;

  it('both parsers should produce same number of edges', async () => {
    const antlrAst = await parseFlowchartAST(codeWithComments, 'antlr');
    const jisonAst = await parseFlowchartAST(codeWithComments, 'jison');
    expect(jisonAst.getEdges!().length).toBe(antlrAst.getEdges!().length);
  });

  it('both parsers should produce same number of vertices', async () => {
    const antlrAst = await parseFlowchartAST(codeWithComments, 'antlr');
    const jisonAst = await parseFlowchartAST(codeWithComments, 'jison');
    expect(jisonAst.getVertices!().length).toBe(antlrAst.getVertices!().length);
  });

  it('getElementsOnLine should return same types for each line', async () => {
    const antlrAst = await parseFlowchartAST(codeWithComments, 'antlr');
    const jisonAst = await parseFlowchartAST(codeWithComments, 'jison');

    for (let line = 1; line <= 11; line++) {
      const antlrElems = antlrAst.getElementsOnLine?.(line) ?? [];
      const jisonElems = jisonAst.getElementsOnLine?.(line) ?? [];

      const antlrTypes = antlrElems.map((e) => e.type).sort();
      const jisonTypes = jisonElems.map((e) => e.type).sort();

      // Both parsers should return the same element types on each line
      expect(jisonTypes).toEqual(antlrTypes);
    }
  });

  it('comment lines should have no non-comment elements in both parsers', async () => {
    const antlrAst = await parseFlowchartAST(codeWithComments, 'antlr');
    const jisonAst = await parseFlowchartAST(codeWithComments, 'jison');

    const commentLines = [3, 5, 7, 8, 9];
    for (const line of commentLines) {
      const antlrNonComment = (antlrAst.getElementsOnLine?.(line) ?? []).filter(
        (e) => e.type !== 'comment'
      );
      const jisonNonComment = (jisonAst.getElementsOnLine?.(line) ?? []).filter(
        (e) => e.type !== 'comment'
      );
      expect(antlrNonComment.length).toBe(0);
      expect(jisonNonComment.length).toBe(0);
    }
  });

  it('edge lines should have same vertex IDs in both parsers', async () => {
    const antlrAst = await parseFlowchartAST(codeWithComments, 'antlr');
    const jisonAst = await parseFlowchartAST(codeWithComments, 'jison');

    const edgeLines = [2, 4, 6, 10, 11];
    for (const line of edgeLines) {
      const antlrVertexIds = (antlrAst.getElementsOnLine?.(line) ?? [])
        .filter((e) => e.type === 'vertex')
        .map((e) => (e.data as { id?: string }).id)
        .sort();
      const jisonVertexIds = (jisonAst.getElementsOnLine?.(line) ?? [])
        .filter((e) => e.type === 'vertex')
        .map((e) => (e.data as { id?: string }).id)
        .sort();
      expect(jisonVertexIds).toEqual(antlrVertexIds);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// ElementMappingUtils coverage via parsed ASTs (dual-parser)
// Covers: findElementBySvgId, boundary positions, edge cases
// ────────────────────────────────────────────────────────────────
forBothParsers('ElementMapping: findElementBySvgId equivalent', (parse) => {
  it('should find edge mapping by svgId field', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const mappings = ast.elementMappings!;
    const edgeMappings = mappings.filter((m) => m.type === 'edge');
    expect(edgeMappings.length).toBeGreaterThan(0);

    // Each edge mapping should have an svgId
    const edgeWithSvgId = edgeMappings.find((m) => m.svgId);
    expect(edgeWithSvgId).toBeDefined();

    // Should be findable by svgId lookup on mappings array
    const found = mappings.find((m) => m.svgId === edgeWithSvgId!.svgId);
    expect(found).toBeDefined();
    expect(found!.type).toBe('edge');
  });

  it('should not find mapping by non-existent svgId', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const found = ast.elementMappings!.find((m) => m.svgId === 'non-existent-svg-id-xyz');
    expect(found).toBeUndefined();
  });

  it('edge svgId should follow L_start_end_counter format', async () => {
    const ast = await parse(`flowchart TD\n    A-->B\n    B-->C`);
    const edgeMappings = ast.elementMappings!.filter((m) => m.type === 'edge');
    expect(edgeMappings.length).toBe(2);

    for (const em of edgeMappings) {
      const svgId = em.svgId ?? (em.data as { svgId?: string }).svgId;
      expect(svgId).toBeDefined();
      expect(svgId).toMatch(/^L_\w+_\w+_\d+$/);
    }
  });

  it('vertex mappings should have data.id matching node ID', async () => {
    const ast = await parse(`flowchart TD\n    A[Hello]-->B`);
    const vertexMappings = ast.elementMappings!.filter((m) => m.type === 'vertex');
    expect(vertexMappings.length).toBeGreaterThanOrEqual(2);

    const vertexIds = vertexMappings.map((m) => (m.data as { id?: string }).id);
    expect(vertexIds).toContain('A');
    expect(vertexIds).toContain('B');
  });

  it('subgraph mapping should have data.id matching subgraph ID', async () => {
    const ast = await parse(`flowchart TB\n    subgraph mysg\n    A-->B\n    end`);
    const sgMappings = ast.elementMappings!.filter((m) => m.type === 'subgraph');
    expect(sgMappings.length).toBe(1);
    expect((sgMappings[0].data as { id?: string }).id).toBe('mysg');
  });
});

forBothParsers('ElementMapping: boundary position lookups', (parse) => {
  const code = `flowchart TD
    A[Start]-->B{Decision}
    B-->C`;

  it('getElementAtPosition at start of first mapping should find it', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtPosition?.(first.position.startLine, first.position.startColumn);
    expect(found).toBeDefined();
  });

  it('getElementAtPosition at end of first mapping should find it', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtPosition?.(first.position.endLine, first.position.endColumn);
    expect(found).toBeDefined();
  });

  it('getElementAtPosition one column before start should not find it', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    // Only test if startColumn > 0 to avoid going negative
    if (first.position.startColumn > 0) {
      const found = ast.getElementAtPosition?.(
        first.position.startLine,
        first.position.startColumn - 1
      );
      // May or may not find a different element, but shouldn't find `first`
      if (found) {
        // It's fine if it finds a different overlapping element
        expect(found.position.startColumn).toBeLessThanOrEqual(first.position.startColumn - 1);
      }
    }
  });

  it('getElementAtIndex at start index should find it', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtIndex?.(first.position.startIndex);
    expect(found).toBeDefined();
  });

  it('getElementAtIndex at end index should find it', async () => {
    const ast = await parse(code);
    const first = ast.elementMappings![0];
    const found = ast.getElementAtIndex?.(first.position.endIndex);
    expect(found).toBeDefined();
  });

  it('getElementAtIndex far beyond end should return undefined', async () => {
    const ast = await parse(code);
    const found = ast.getElementAtIndex?.(999999);
    expect(found).toBeUndefined();
  });
});

forBothParsers('ElementMapping: getElementsByType equivalents', (parse) => {
  const code = `flowchart TD
    A[Start]-->B
    B-->C
    subgraph S1
    C-->D
    end`;

  it('getVertices should return all vertex mappings', async () => {
    const ast = await parse(code);
    const vertices = ast.getVertices!();
    expect(vertices.length).toBeGreaterThanOrEqual(4);
    expect(vertices.every((v) => v.type === 'vertex')).toBe(true);
  });

  it('getEdges should return all edge mappings', async () => {
    const ast = await parse(code);
    const edges = ast.getEdges!();
    expect(edges.length).toBe(3);
    expect(edges.every((e) => e.type === 'edge')).toBe(true);
  });

  it('getSubgraphs should return all subgraph mappings', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    expect(sgs.length).toBe(1);
    expect(sgs.every((s) => s.type === 'subgraph')).toBe(true);
  });

  it('getStats should report correct counts', async () => {
    const ast = await parse(code);
    const stats = ast.getStats!();
    expect(stats.vertices).toBeGreaterThanOrEqual(4);
    expect(stats.edges).toBe(3);
    expect(stats.subgraphs).toBe(1);
    expect(stats.totalElements).toBe(stats.vertices + stats.edges + stats.subgraphs);
  });
});

forBothParsers('ElementMapping: empty / minimal diagram', (parse) => {
  it('diagram with no edges should have 0 edges and getEdges returns empty', async () => {
    const ast = await parse(`flowchart TD\n    A[Hello]`);
    const edges = ast.getEdges!();
    expect(edges).toHaveLength(0);
  });

  it('diagram with no subgraphs should have getSubgraphs return empty', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const sgs = ast.getSubgraphs!();
    expect(sgs).toHaveLength(0);
  });

  it('getStats for diagram with only an edge should have 0 subgraphs', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    const stats = ast.getStats!();
    expect(stats.subgraphs).toBe(0);
    expect(stats.edges).toBe(1);
    expect(stats.vertices).toBeGreaterThanOrEqual(2);
  });
});

forBothParsers('ElementMapping: getElementByDataId covers all types', (parse) => {
  const code = `flowchart TB
    subgraph S1
    A[Hello]-->B
    end
    B-->C`;

  it('should find vertex by node ID via getElementByDataId', async () => {
    const ast = await parse(code);
    const found = ast.getElementByDataId?.('A');
    expect(found).toBeDefined();
    expect(found?.type).toBe('vertex');
  });

  it('should find edge by svgId via getElementByDataId', async () => {
    const ast = await parse(code);
    const found = ast.getElementByDataId?.('L_A_B_0');
    expect(found).toBeDefined();
    expect(found?.type).toBe('edge');
  });

  it('should find subgraph by ID via getElementByDataId', async () => {
    const ast = await parse(code);
    const found = ast.getElementByDataId?.('S1');
    expect(found).toBeDefined();
    expect(found?.type).toBe('subgraph');
  });

  it('should return undefined for unknown data ID', async () => {
    const ast = await parse(code);
    expect(ast.getElementByDataId?.('DOES_NOT_EXIST')).toBeUndefined();
  });
});

forBothParsers('ElementMapping: position fields are valid', (parse) => {
  it('every mapping should have valid position with all 6 fields', async () => {
    const ast = await parse(`flowchart TD\n    A[Start]-->B\n    B-->C`);
    for (const m of ast.elementMappings!) {
      expect(m.position).toBeDefined();
      expect(typeof m.position.startLine).toBe('number');
      expect(typeof m.position.startColumn).toBe('number');
      expect(typeof m.position.endLine).toBe('number');
      expect(typeof m.position.endColumn).toBe('number');
      expect(typeof m.position.startIndex).toBe('number');
      expect(typeof m.position.endIndex).toBe('number');

      // Sanity: start <= end
      expect(m.position.startLine).toBeLessThanOrEqual(m.position.endLine);
      expect(m.position.startIndex).toBeLessThanOrEqual(m.position.endIndex);

      // Line numbers should be >= 1
      expect(m.position.startLine).toBeGreaterThanOrEqual(1);
      expect(m.position.endLine).toBeGreaterThanOrEqual(1);

      // Indices should be >= 0
      expect(m.position.startIndex).toBeGreaterThanOrEqual(0);
      expect(m.position.endIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it('every mapping should have a non-empty id', async () => {
    const ast = await parse(`flowchart TD\n    A-->B`);
    for (const m of ast.elementMappings!) {
      expect(m.id).toBeDefined();
      expect(m.id.length).toBeGreaterThan(0);
    }
  });

  it('every mapping should have a valid type', async () => {
    const ast = await parse(`flowchart TD\n    A-->B\n    subgraph S\n    B-->C\n    end`);
    const validTypes = [
      'vertex',
      'edge',
      'subgraph',
      'comment',
      'style',
      'classDef',
      'class',
      'click',
    ];
    for (const m of ast.elementMappings!) {
      expect(validTypes).toContain(m.type);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// Empty subgraph tests
// ────────────────────────────────────────────────────────────────
forBothParsers('Empty Subgraph Highlighting', (parse) => {
  const code = `flowchart LR
  A["Start"] -- Some text --> B("Continue")
  B --> C{"Evaluate"}
  subgraph Ash
  C -- One --> D["Option 1"]
  C -- Two --> E["Option 2"]
  C -- Three --> F["fa:fa-car Option 3"]
  end
  subgraph Knut
  end`;

  it('should create subgraph mapping for empty subgraph Knut', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    const knut = sgs.find((s) => (s.data as { id?: string }).id === 'Knut');
    expect(knut).toBeDefined();
    expect(knut!.type).toBe('subgraph');
  });

  it('should create subgraph mapping for non-empty subgraph Ash', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    const ash = sgs.find((s) => (s.data as { id?: string }).id === 'Ash');
    expect(ash).toBeDefined();
    expect(ash!.type).toBe('subgraph');
  });

  it('should have 2 subgraph mappings total', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    expect(sgs.length).toBe(2);
  });

  it('getElementByDataId should find empty subgraph Knut', async () => {
    const ast = await parse(code);
    const found = ast.getElementByDataId?.('Knut');
    expect(found).toBeDefined();
    expect(found?.type).toBe('subgraph');
    expect((found?.data as { id?: string }).id).toBe('Knut');
  });

  it('cursor on empty subgraph line should return subgraph element', async () => {
    const ast = await parse(code);
    // "subgraph Knut" is on line 9
    const elems = ast.getElementsOnLine!(9);
    const sgElems = elems.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
    expect((sgElems[0].data as { id?: string }).id).toBe('Knut');
  });

  it('cursor on "end" line of empty subgraph should NOT return subgraph', async () => {
    const ast = await parse(code);
    // "end" for Knut is on line 10
    const elems = ast.getElementsOnLine!(10);
    // The "end" line should not have any element mappings
    expect(elems.length).toBe(0);
  });

  it('cursor on Ash subgraph declaration should return Ash subgraph', async () => {
    const ast = await parse(code);
    // "subgraph Ash" is on line 4
    const elems = ast.getElementsOnLine!(4);
    const sgElems = elems.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
    expect((sgElems[0].data as { id?: string }).id).toBe('Ash');
  });
});

// ────────────────────────────────────────────────────────────────
// Empty subgraph equivalence: ANTLR vs Jison
// ────────────────────────────────────────────────────────────────
describe('Empty Subgraph Equivalence: ANTLR vs Jison', () => {
  const code = `flowchart LR
  A["Start"] -- Some text --> B("Continue")
  B --> C{"Evaluate"}
  subgraph Ash
  C -- One --> D["Option 1"]
  C -- Two --> E["Option 2"]
  C -- Three --> F["fa:fa-car Option 3"]
  end
  subgraph Knut
  end`;

  it('both parsers should find empty subgraph Knut via getElementByDataId', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    const antlrKnut = antlrAst.getElementByDataId?.('Knut');
    const jisonKnut = jisonAst.getElementByDataId?.('Knut');

    expect(antlrKnut).toBeDefined();
    expect(jisonKnut).toBeDefined();
    expect(antlrKnut?.type).toBe('subgraph');
    expect(jisonKnut?.type).toBe('subgraph');
  });

  it('both parsers should have same subgraph count', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    expect(jisonAst.getSubgraphs!().length).toBe(antlrAst.getSubgraphs!().length);
  });

  it('both parsers should return subgraph on empty subgraph declaration line', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    // "subgraph Knut" is on line 9
    const antlrElems = antlrAst.getElementsOnLine?.(9) ?? [];
    const jisonElems = jisonAst.getElementsOnLine?.(9) ?? [];

    const antlrSg = antlrElems.filter((e) => e.type === 'subgraph');
    const jisonSg = jisonElems.filter((e) => e.type === 'subgraph');

    expect(antlrSg.length).toBe(1);
    expect(jisonSg.length).toBe(1);
    expect((antlrSg[0].data as { id?: string }).id).toBe('Knut');
    expect((jisonSg[0].data as { id?: string }).id).toBe('Knut');
  });
});

// ────────────────────────────────────────────────────────────────
// Quoted subgraph IDs
// ────────────────────────────────────────────────────────────────
forBothParsers('Quoted Subgraph IDs', (parse) => {
  const code = `flowchart LR
  A-->B
  subgraph "Ash"
  B-->C
  end
  subgraph "Knut"
  end`;

  it('should strip quotes and use clean ID for subgraph', async () => {
    const ast = await parse(code);
    const sgs = ast.getSubgraphs!();
    const ids = sgs.map((s) => (s.data as { id?: string }).id);
    expect(ids).toContain('Ash');
    expect(ids).toContain('Knut');
    // Should NOT contain quoted versions
    expect(ids).not.toContain('"Ash"');
    expect(ids).not.toContain('"Knut"');
  });

  it('getElementByDataId should find quoted subgraph by clean ID', async () => {
    const ast = await parse(code);
    const ash = ast.getElementByDataId?.('Ash');
    expect(ash).toBeDefined();
    expect(ash?.type).toBe('subgraph');

    const knut = ast.getElementByDataId?.('Knut');
    expect(knut).toBeDefined();
    expect(knut?.type).toBe('subgraph');
  });

  it('cursor on quoted subgraph declaration should return subgraph element', async () => {
    const ast = await parse(code);
    // subgraph "Ash" is on line 3
    const line3 = ast.getElementsOnLine!(3);
    const sgElems = line3.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
    expect((sgElems[0].data as { id?: string }).id).toBe('Ash');
  });

  it('cursor on quoted empty subgraph declaration should return subgraph element', async () => {
    const ast = await parse(code);
    // subgraph "Knut" is on line 6
    const line6 = ast.getElementsOnLine!(6);
    const sgElems = line6.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
    expect((sgElems[0].data as { id?: string }).id).toBe('Knut');
  });
});

describe('Quoted Subgraph Equivalence: ANTLR vs Jison', () => {
  const code = `flowchart LR
  A-->B
  subgraph "Ash"
  B-->C
  end
  subgraph "Knut"
  end`;

  it('both parsers should produce same subgraph IDs (quotes stripped)', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    const antlrIds = (antlrAst.getSubgraphs?.() ?? [])
      .map((s) => (s.data as { id?: string }).id)
      .sort();
    const jisonIds = (jisonAst.getSubgraphs?.() ?? [])
      .map((s) => (s.data as { id?: string }).id)
      .sort();

    expect(jisonIds).toEqual(antlrIds);
  });

  it('both parsers should find quoted subgraphs via getElementByDataId', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    for (const id of ['Ash', 'Knut']) {
      const antlrFound = antlrAst.getElementByDataId?.(id);
      const jisonFound = jisonAst.getElementByDataId?.(id);
      expect(antlrFound).toBeDefined();
      expect(jisonFound).toBeDefined();
      expect(antlrFound?.type).toBe('subgraph');
      expect(jisonFound?.type).toBe('subgraph');
    }
  });

  it('both parsers should return subgraph on declaration line', async () => {
    const antlrAst = await parseFlowchartAST(code, 'antlr');
    const jisonAst = await parseFlowchartAST(code, 'jison');

    // subgraph "Ash" on line 3
    const antlrLine3 = (antlrAst.getElementsOnLine?.(3) ?? []).filter((e) => e.type === 'subgraph');
    const jisonLine3 = (jisonAst.getElementsOnLine?.(3) ?? []).filter((e) => e.type === 'subgraph');
    expect(antlrLine3.length).toBe(1);
    expect(jisonLine3.length).toBe(1);
    expect((antlrLine3[0].data as { id?: string }).id).toBe('Ash');
    expect((jisonLine3[0].data as { id?: string }).id).toBe('Ash');
  });
});

// ────────────────────────────────────────────────────────────────
// Markdown backtick subgraph title
// ────────────────────────────────────────────────────────────────
// Jison-only tests for markdown backtick subgraph titles.
// The ANTLR parser has a known issue with markdown backtick subgraph titles
// (creates phantom subgraphs), so these tests run only for Jison.
describe('[jison] Markdown Backtick Subgraph Title', () => {
  const code = `flowchart LR
subgraph "One"
  a --> b
end
subgraph "\`**Two**\`"
  c --> d
end`;

  const parse = (input: string) => parseFlowchartAST(input, 'jison');

  it('should find subgraph with markdown title via getElementByDataId', async () => {
    const ast = await parse(code);
    // FlowDB stores the ID with backticks stripped: "**Two**"
    const found = ast.getElementByDataId?.('**Two**');
    expect(found).toBeDefined();
    expect(found?.type).toBe('subgraph');
  });

  it('should find plain quoted subgraph via getElementByDataId', async () => {
    const ast = await parse(code);
    const found = ast.getElementByDataId?.('One');
    expect(found).toBeDefined();
    expect(found?.type).toBe('subgraph');
  });

  it('cursor on markdown subgraph declaration line should return subgraph', async () => {
    const ast = await parse(code);
    // subgraph "`**Two**`" is on line 5
    const elems = ast.getElementsOnLine!(5);
    const sgElems = elems.filter((e) => e.type === 'subgraph');
    expect(sgElems.length).toBe(1);
  });

  it('should have 2 subgraphs total', async () => {
    const ast = await parse(code);
    expect(ast.getSubgraphs!().length).toBe(2);
  });
});
