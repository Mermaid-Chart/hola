import { describe, it, expect, beforeEach } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { FlowLexer } from './generated/FlowLexer.js';
import { FlowParser } from './generated/FlowParser.js';
import { FlowchartASTBuilder } from './FlowchartASTBuilder.js';
import type { FlowchartAST, FlowchartElementMapping } from '../../types.js';

describe('FlowchartAST Bidirectional Synchronization', () => {
  let ast: FlowchartAST;
  let code: string;

  beforeEach(() => {
    // Sample flowchart diagram
    code = `flowchart TD
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    C-->D`;

    // Parse and generate AST
    const chars = CharStream.fromString(code);
    const lexer = new FlowLexer(chars);
    const tokens = new CommonTokenStream(lexer);
    const parser = new FlowParser(tokens);
    const tree = parser.start();
    const builder = new FlowchartASTBuilder(code);
    const result = builder.generateAST(tree);
    ast = result.ast;
  });

  describe('AST Structure', () => {
    it('should have element mappings', () => {
      expect(ast.elementMappings).toBeDefined();
      expect(Array.isArray(ast.elementMappings)).toBe(true);
    });

    it('should have statements', () => {
      expect(ast.statements).toBeDefined();
      expect(Array.isArray(ast.statements)).toBe(true);
      expect(ast.statements.length).toBeGreaterThan(0);
    });

    it('should have header and direction', () => {
      expect(ast.header).toBe('flowchart');
      // TD is normalized to TB (both mean top-to-bottom)
      expect(ast.direction).toBe('TB');
    });
  });

  describe('getElementAtPosition', () => {
    it('should be defined', () => {
      const getElementAtPosition = ast.getElementAtPosition?.bind(ast);
      expect(getElementAtPosition).toBeDefined();
      expect(typeof getElementAtPosition).toBe('function');
    });

    it('should find element at valid position', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        // Skip test if no mappings
        return;
      }

      const firstMapping = ast.elementMappings[0];
      const getElementAtPosition = ast.getElementAtPosition?.bind(ast);
      if (!getElementAtPosition) {
        return;
      }
      const element = getElementAtPosition(
        firstMapping.position.startLine,
        firstMapping.position.startColumn
      );

      expect(element).toBeDefined();
    });

    it('should return undefined for position outside any element', () => {
      const getElementAtPosition = ast.getElementAtPosition?.bind(ast);
      if (!getElementAtPosition) {
        return;
      }
      const element = getElementAtPosition(9999, 9999);
      expect(element).toBeUndefined();
    });

    it('should return most specific element when multiple elements overlap', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      // Find an element with a position
      const mapping = ast.elementMappings.find((m) => m.position);
      if (!mapping) {
        return;
      }

      const getElementAtPosition = ast.getElementAtPosition?.bind(ast);
      if (!getElementAtPosition) {
        return;
      }
      const element = getElementAtPosition(
        mapping.position.startLine,
        mapping.position.startColumn + 1
      );

      expect(element).toBeDefined();
    });
  });

  describe('getElementById', () => {
    it('should be defined', () => {
      const getElementById = ast.getElementById?.bind(ast);
      expect(getElementById).toBeDefined();
      expect(typeof getElementById).toBe('function');
    });

    it('should find element by ID', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      const firstMapping = ast.elementMappings[0];
      const getElementById = ast.getElementById?.bind(ast);
      if (!getElementById) {
        return;
      }
      const element = getElementById(firstMapping.id);

      expect(element).toBeDefined();
      expect(element?.id).toBe(firstMapping.id);
    });

    it('should return undefined for non-existent ID', () => {
      const getElementById = ast.getElementById?.bind(ast);
      if (!getElementById) {
        return;
      }
      const element = getElementById('non-existent-id-12345');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementAtIndex', () => {
    it('should be defined', () => {
      const getElementAtIndex = ast.getElementAtIndex?.bind(ast);
      expect(getElementAtIndex).toBeDefined();
      expect(typeof getElementAtIndex).toBe('function');
    });

    it('should find element at character index', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        // Skip test if no mappings
        expect(true).toBe(true);
        return;
      }

      const firstMapping = ast.elementMappings[0];
      if (
        firstMapping.position.startIndex === undefined ||
        firstMapping.position.startIndex === null
      ) {
        // Skip if no startIndex
        expect(true).toBe(true);
        return;
      }

      const getElementAtIndex = ast.getElementAtIndex?.bind(ast);
      if (!getElementAtIndex) {
        return;
      }
      const element = getElementAtIndex(firstMapping.position.startIndex);
      expect(element).toBeDefined();
    });

    it('should return undefined for index outside any element', () => {
      const getElementAtIndex = ast.getElementAtIndex?.bind(ast);
      if (!getElementAtIndex) {
        return;
      }
      const element = getElementAtIndex(999999);
      expect(element).toBeUndefined();
    });
  });

  describe('Type Filtering Methods', () => {
    it('getVertices should return all vertices', () => {
      const getVertices = ast.getVertices?.bind(ast);
      expect(getVertices).toBeDefined();
      const vertices = getVertices?.();
      expect(vertices).toBeDefined();
      expect(Array.isArray(vertices)).toBe(true);

      if (vertices && vertices.length > 0) {
        expect(vertices.every((v) => v.type === 'vertex')).toBe(true);
      }
    });

    it('getEdges should return all edges', () => {
      const getEdges = ast.getEdges?.bind(ast);
      expect(getEdges).toBeDefined();
      const edges = getEdges?.();
      expect(edges).toBeDefined();
      expect(Array.isArray(edges)).toBe(true);

      if (edges && edges.length > 0) {
        expect(edges.every((e) => e.type === 'edge')).toBe(true);
      }
    });

    it('getSubgraphs should return all subgraphs', () => {
      const getSubgraphs = ast.getSubgraphs?.bind(ast);
      expect(getSubgraphs).toBeDefined();
      const subgraphs = getSubgraphs?.();
      expect(subgraphs).toBeDefined();
      expect(Array.isArray(subgraphs)).toBe(true);

      if (subgraphs && subgraphs.length > 0) {
        expect(subgraphs.every((s) => s.type === 'subgraph')).toBe(true);
      }
    });
  });

  describe('getStats', () => {
    it('should be defined', () => {
      const getStats = ast.getStats?.bind(ast);
      expect(getStats).toBeDefined();
      expect(typeof getStats).toBe('function');
    });

    it('should return correct statistics', () => {
      const getStats = ast.getStats?.bind(ast);
      const stats = getStats?.();
      expect(stats).toBeDefined();
      expect(stats!.totalElements).toBeGreaterThanOrEqual(0);
      expect(stats!.vertices).toBeGreaterThanOrEqual(0);
      expect(stats!.edges).toBeGreaterThanOrEqual(0);
      expect(stats!.subgraphs).toBeGreaterThanOrEqual(0);
    });

    it('should have totalElements equal to sum of all types', () => {
      const stats = ast.getStats?.();
      expect(stats).toBeDefined();
      const sum = stats!.vertices + stats!.edges + stats!.subgraphs;
      expect(stats!.totalElements).toBe(sum);
    });
  });

  describe('Element Mapping Properties', () => {
    it('should have position information for each mapping', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      ast.elementMappings.forEach((mapping) => {
        expect(mapping.position).toBeDefined();
        expect(mapping.position.startLine).toBeGreaterThan(0);
        expect(mapping.position.startColumn).toBeGreaterThanOrEqual(0);
        expect(mapping.position.endLine).toBeGreaterThan(0);
        expect(mapping.position.endColumn).toBeGreaterThan(0);
        expect(mapping.position.startIndex).toBeGreaterThanOrEqual(0);
        expect(mapping.position.endIndex).toBeGreaterThanOrEqual(0);
      });
    });

    it('should have unique IDs for each mapping', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      const ids = ast.elementMappings.map((m) => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it('should have type for each mapping', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      ast.elementMappings.forEach((mapping) => {
        expect(mapping.type).toBeDefined();
        expect(typeof mapping.type).toBe('string');
      });
    });

    it('should have data for each mapping', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      ast.elementMappings.forEach((mapping) => {
        expect(mapping.data).toBeDefined();
      });
    });
  });

  describe('SVG Selector Generation', () => {
    it('should have svgSelector for mappings', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      ast.elementMappings.forEach((mapping) => {
        if (mapping.svgSelector) {
          expect(typeof mapping.svgSelector).toBe('string');
          expect(mapping.svgSelector.length).toBeGreaterThan(0);
        }
      });
    });

    it('should have svgId for mappings', () => {
      if (!ast.elementMappings || ast.elementMappings.length === 0) {
        return;
      }

      ast.elementMappings.forEach((mapping) => {
        if (mapping.svgId) {
          expect(typeof mapping.svgId).toBe('string');
          expect(mapping.svgId.length).toBeGreaterThan(0);
        }
      });
    });
  });

  describe('getElementsOnLine', () => {
    it('should be defined', () => {
      const getElementsOnLine = ast.getElementsOnLine?.bind(ast);
      expect(getElementsOnLine).toBeDefined();
      expect(typeof getElementsOnLine).toBe('function');
    });

    it('should return empty array for line with no elements', () => {
      const getElementsOnLine = ast.getElementsOnLine?.bind(ast);
      if (!getElementsOnLine) {
        return;
      }
      const elements = getElementsOnLine(9999);
      expect(elements).toEqual([]);
    });

    it('should return all elements on a line with edge statement', () => {
      // Line 2: "A[Start]-->B{Decision}" should have vertex A, vertex B, and edge A->B
      const getElementsOnLine = ast.getElementsOnLine?.bind(ast);
      if (!getElementsOnLine) {
        return;
      }
      const elements = getElementsOnLine(2);

      // Should have at least 3 elements: vertex A, vertex B, and edge
      expect(elements.length).toBeGreaterThanOrEqual(3);

      // Check we have both vertex types and edge type
      const types = elements.map((e) => e.type);
      expect(types).toContain('vertex');
      expect(types).toContain('edge');

      // Count vertices - should have at least 2 (A and B)
      const vertices = elements.filter((e) => e.type === 'vertex');
      expect(vertices.length).toBeGreaterThanOrEqual(2);
    });

    it('should return vertex and edge for simple edge line', () => {
      // Line 5: "C-->D" should have vertex C reference, vertex D reference, and edge
      const getElementsOnLine = ast.getElementsOnLine?.bind(ast);
      if (!getElementsOnLine) {
        return;
      }
      const elements = getElementsOnLine(5);

      // Should have 3 elements: vertex C ref, vertex D ref, and edge
      expect(elements.length).toBeGreaterThanOrEqual(3);

      const types = elements.map((e) => e.type);
      expect(types).toContain('edge');
      expect(types).toContain('vertex');
    });
  });

  describe('Vertex References in Edge Statements', () => {
    it('should create element mappings for vertex references in edge statements', () => {
      // The diagram has edges like "A[Start]-->B{Decision}"
      // Each vertex reference (A, B) should have its own element mapping
      const vertices = ast.getVertices?.();
      expect(vertices).toBeDefined();

      // We should have vertex mappings for A, B, C, D (4 unique nodes)
      // But some may be references on edge lines, so we expect multiple mappings
      expect(vertices!.length).toBeGreaterThanOrEqual(4);
    });

    it('should have correct node IDs in vertex data for edge statements', () => {
      const vertices = ast.getVertices?.();
      if (!vertices || vertices.length === 0) {
        return;
      }

      // Each vertex mapping should have an id in its data
      vertices.forEach((v) => {
        expect(v.data).toBeDefined();
        expect('id' in v.data).toBe(true);
      });

      // Check that we have mappings for nodes A, B, C, D
      const nodeIds = vertices.map((v) => ('id' in v.data ? v.data.id : '')).filter(Boolean);
      expect(nodeIds).toContain('A');
      expect(nodeIds).toContain('B');
      expect(nodeIds).toContain('C');
      expect(nodeIds).toContain('D');
    });
  });

  describe('Edge SVG ID Matching', () => {
    it('should have edge data with svgId matching renderer format (L_start_end_counter)', () => {
      const edges = ast.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBeGreaterThan(0);

      // Each edge should have svgId in the L_start_end_counter format
      edges!.forEach((edge) => {
        expect(edge.data).toBeDefined();
        expect('svgId' in edge.data).toBe(true);
        const svgId = (edge.data as { svgId?: string }).svgId;
        expect(svgId).toBeDefined();
        // svgId should match pattern L_<start>_<end>_<counter>
        expect(svgId).toMatch(/^L_\w+_\w+_\d+$/);
      });
    });

    it('should have correct svgId for edge A->B', () => {
      const edges = ast.getEdges?.();
      const edgeAB = edges?.find((e) => {
        const data = e.data as { start?: string; end?: string };
        return data.start === 'A' && data.end === 'B';
      });

      expect(edgeAB).toBeDefined();
      const svgId = (edgeAB!.data as { svgId?: string }).svgId;
      // First edge from A to B should be L_A_B_0
      expect(svgId).toBe('L_A_B_0');
    });

    it('should have correct svgId for edge B->C with label', () => {
      // Line 3: "B-->|Yes|C[Process]" - edge from B to C with label "Yes"
      const edges = ast.getEdges?.();
      const edgeBC = edges?.find((e) => {
        const data = e.data as { start?: string; end?: string };
        return data.start === 'B' && data.end === 'C';
      });

      expect(edgeBC).toBeDefined();
      const svgId = (edgeBC!.data as { svgId?: string }).svgId;
      // First edge from B to C should be L_B_C_0
      expect(svgId).toBe('L_B_C_0');
    });

    it('should increment counter for multiple edges between same nodes', () => {
      // Parse a diagram with multiple edges between same nodes
      const multiEdgeCode = `flowchart TD
    A-->B
    A-->B`;

      const chars = CharStream.fromString(multiEdgeCode);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(multiEdgeCode);
      const result = builder.generateAST(tree);
      const multiEdgeAst = result.ast;

      const edges = multiEdgeAst.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(2);

      const svgIds = edges!.map((e) => (e.data as { svgId?: string }).svgId);
      // Per flowDb.ts addSingleLink logic:
      // - First edge: existingLinks.length === 0 → counter = 0 → L_A_B_0
      // - Second edge: existingLinks.length === 1 → counter = 1 + 1 = 2 → L_A_B_2
      // The counter skips 1 because the DB uses existingLinks.length + 1 for non-first edges
      expect(svgIds).toContain('L_A_B_0');
      expect(svgIds).toContain('L_A_B_2');
    });
  });

  describe('Ampersand (&) Chain Syntax', () => {
    it('should create correct nodes and edges for A --> B & C syntax', () => {
      // Parse a diagram with ampersand chain syntax
      const chainCode = `flowchart LR
A --> B & C`;

      const chars = CharStream.fromString(chainCode);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(chainCode);
      const result = builder.generateAST(tree);
      const chainAst = result.ast;

      // Should have 3 nodes: A, B, C
      const vertices = chainAst.getVertices?.();
      expect(vertices).toBeDefined();
      const nodeIds = vertices!.map((v) => ('id' in v.data ? v.data.id : '')).filter(Boolean);
      expect(nodeIds).toContain('A');
      expect(nodeIds).toContain('B');
      expect(nodeIds).toContain('C');

      // Should have 2 edges: A-->B and A-->C
      const edges = chainAst.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(2);

      // Check edge svgIds
      const edgeData = edges!.map((e) => ({
        start: (e.data as { start?: string }).start,
        end: (e.data as { end?: string }).end,
        svgId: (e.data as { svgId?: string }).svgId,
      }));

      // Should have edge A-->B with svgId L_A_B_0
      const edgeAB = edgeData.find((e) => e.start === 'A' && e.end === 'B');
      expect(edgeAB).toBeDefined();
      expect(edgeAB!.svgId).toBe('L_A_B_0');

      // Should have edge A-->C with svgId L_A_C_0
      const edgeAC = edgeData.find((e) => e.start === 'A' && e.end === 'C');
      expect(edgeAC).toBeDefined();
      expect(edgeAC!.svgId).toBe('L_A_C_0');
    });

    it('should create correct edges for A & B --> C syntax', () => {
      // Parse a diagram where multiple nodes connect to one
      const chainCode = `flowchart LR
A & B --> C`;

      const chars = CharStream.fromString(chainCode);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(chainCode);
      const result = builder.generateAST(tree);
      const chainAst = result.ast;

      // Should have 2 edges: A-->C and B-->C
      const edges = chainAst.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(2);

      const edgeData = edges!.map((e) => ({
        start: (e.data as { start?: string }).start,
        end: (e.data as { end?: string }).end,
        svgId: (e.data as { svgId?: string }).svgId,
      }));

      // Should have edge A-->C with svgId L_A_C_0
      const edgeAC = edgeData.find((e) => e.start === 'A' && e.end === 'C');
      expect(edgeAC).toBeDefined();
      expect(edgeAC!.svgId).toBe('L_A_C_0');

      // Should have edge B-->C with svgId L_B_C_0
      const edgeBC = edgeData.find((e) => e.start === 'B' && e.end === 'C');
      expect(edgeBC).toBeDefined();
      expect(edgeBC!.svgId).toBe('L_B_C_0');
    });

    it('should return all elements on line with ampersand chain', () => {
      const chainCode = `flowchart LR
A --> B & C`;

      const chars = CharStream.fromString(chainCode);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(chainCode);
      const result = builder.generateAST(tree);
      const chainAst = result.ast;

      // Line 2 should have: 3 vertices (A, B, C) + 2 edges
      const elements = chainAst.getElementsOnLine?.(2);
      expect(elements).toBeDefined();

      const types = elements!.map((e) => e.type);
      expect(types.filter((t) => t === 'vertex').length).toBeGreaterThanOrEqual(3);
      expect(types.filter((t) => t === 'edge').length).toBe(2);
    });
  });

  describe('Chained Edge Syntax (A --> B --> C)', () => {
    it('should create all edges for A --> B --> C syntax', () => {
      // Parse a diagram with chained edges
      const code = `flowchart LR
    A --> B --> C`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Should have 3 nodes: A, B, C
      const vertices = ast.getVertices?.();
      expect(vertices).toBeDefined();
      const nodeIds = vertices!.map((v) => ('id' in v.data ? v.data.id : '')).filter(Boolean);
      expect(nodeIds).toContain('A');
      expect(nodeIds).toContain('B');
      expect(nodeIds).toContain('C');

      // Should have 2 edges: A-->B and B-->C
      const edges = ast.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(2);

      // Check edge svgIds
      const edgeData = edges!.map((e) => ({
        start: (e.data as { start?: string }).start,
        end: (e.data as { end?: string }).end,
        svgId: (e.data as { svgId?: string }).svgId,
      }));

      // Should have edge A-->B with svgId L_A_B_0
      const edgeAB = edgeData.find((e) => e.start === 'A' && e.end === 'B');
      expect(edgeAB).toBeDefined();
      expect(edgeAB!.svgId).toBe('L_A_B_0');

      // Should have edge B-->C with svgId L_B_C_0
      const edgeBC = edgeData.find((e) => e.start === 'B' && e.end === 'C');
      expect(edgeBC).toBeDefined();
      expect(edgeBC!.svgId).toBe('L_B_C_0');
    });

    it('should return all edges on line for A --> B --> C syntax', () => {
      const code = `flowchart LR
    A --> B --> C`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Line 2 should have: 3 vertices (A, B, C) + 2 edges (A-->B and B-->C)
      const elements = ast.getElementsOnLine?.(2);
      expect(elements).toBeDefined();

      const types = elements!.map((e) => e.type);
      expect(types.filter((t) => t === 'vertex').length).toBeGreaterThanOrEqual(3);
      expect(types.filter((t) => t === 'edge').length).toBe(2);

      // Both edges should be present
      const edgeElements = elements!.filter((e) => e.type === 'edge');
      const edgeSvgIds = edgeElements.map((e) => (e.data as { svgId?: string }).svgId);
      expect(edgeSvgIds).toContain('L_A_B_0');
      expect(edgeSvgIds).toContain('L_B_C_0');
    });
  });

  describe('User-defined Edge ID', () => {
    it('should use user-defined edge ID as svgId for simple edge', () => {
      // Parse a diagram with user-defined edge ID
      const code = `flowchart LR
C e1@--> D`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Should have 1 edge with user-defined ID
      const edges = ast.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(1);

      const edgeData = edges![0].data as {
        id?: string;
        svgId?: string;
        start?: string;
        end?: string;
      };
      expect(edgeData.id).toBe('e1');
      expect(edgeData.svgId).toBe('e1'); // svgId should be the user-defined ID
      expect(edgeData.start).toBe('C');
      expect(edgeData.end).toBe('D');
    });

    it('should use user-defined edge ID for ampersand chain A e1@--> B & C', () => {
      // Parse a diagram with user-defined edge ID and ampersand chain
      const code = `flowchart LR
A e1@--> B & C`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Should have 2 edges
      const edges = ast.getEdges?.();
      expect(edges).toBeDefined();
      expect(edges!.length).toBe(2);

      const edgeData = edges!.map((e) => ({
        id: (e.data as { id?: string }).id,
        svgId: (e.data as { svgId?: string }).svgId,
        start: (e.data as { start?: string }).start,
        end: (e.data as { end?: string }).end,
      }));

      // First edge A-->B should have svgId e1 (user-defined)
      const edgeAB = edgeData.find((e) => e.start === 'A' && e.end === 'B');
      expect(edgeAB).toBeDefined();
      expect(edgeAB!.id).toBe('e1');
      expect(edgeAB!.svgId).toBe('e1');

      // Second edge A-->C should have auto-generated svgId L_A_C_0
      // (user-defined ID only applies to first edge in chain)
      const edgeAC = edgeData.find((e) => e.start === 'A' && e.end === 'C');
      expect(edgeAC).toBeDefined();
      expect(edgeAC!.svgId).toBe('L_A_C_0');
    });

    it('should correctly count edge counter when user-defined edge exists between same nodes', () => {
      // When there's a user-defined edge C e1@--> D, and later C --> D,
      // the second edge should have a counter that accounts for the first edge.
      // The SVG renderer counts all edges between node pairs, including user-defined ones.
      const code = `flowchart LR
    A --> B --> C
    C e1@--> D & F
    C --> D
    D --> E`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Get all edges
      const edges = ast.getEdges?.();
      expect(edges).toBeDefined();

      const edgeData = edges!.map((e) => ({
        id: (e.data as { id?: string }).id,
        svgId: (e.data as { svgId?: string }).svgId,
        start: (e.data as { start?: string }).start,
        end: (e.data as { end?: string }).end,
      }));

      // Find edges between C and D
      const edgesCD = edgeData.filter((e) => e.start === 'C' && e.end === 'D');
      expect(edgesCD.length).toBe(2);

      // First C-->D edge should have user-defined ID e1
      const firstEdgeCD = edgesCD[0];
      expect(firstEdgeCD.svgId).toBe('e1');

      // Second C-->D edge (on line 4) should have counter 2
      // The DB uses existingLinks.length + 1 when there are existing edges
      // So: first edge uses 'e1', existingLinks.length becomes 1, next counter = 1 + 1 = 2
      const secondEdgeCD = edgesCD[1];
      expect(secondEdgeCD.svgId).toBe('L_C_D_2');
    });
  });

  describe('Subgraph Highlighting', () => {
    it('should create element mapping for subgraph with correct svgId', () => {
      const code = `flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    end`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Should have subgraph element mappings
      const subgraphs = ast.getSubgraphs?.();
      expect(subgraphs).toBeDefined();
      expect(subgraphs!.length).toBe(2);

      // Check subgraph "one"
      const subgraphOne = subgraphs!.find((s) => (s.data as { id?: string }).id === 'one');
      expect(subgraphOne).toBeDefined();
      expect((subgraphOne!.data as { id?: string }).id).toBe('one');

      // Check subgraph "two"
      const subgraphTwo = subgraphs!.find((s) => (s.data as { id?: string }).id === 'two');
      expect(subgraphTwo).toBeDefined();
      expect((subgraphTwo!.data as { id?: string }).id).toBe('two');
    });

    it('should return subgraph element when cursor is on subgraph declaration line', () => {
      const code = `flowchart TB
    c1-->a2
    subgraph one
    a1-->a2
    end
    subgraph two
    b1-->b2
    end`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Line 3 is "subgraph one" - should return subgraph element
      const elementsOnLine3 = ast.getElementsOnLine?.(3);
      expect(elementsOnLine3).toBeDefined();

      const subgraphElements = elementsOnLine3!.filter((e) => e.type === 'subgraph');
      expect(subgraphElements.length).toBe(1);
      expect((subgraphElements[0].data as { id?: string }).id).toBe('one');

      // Line 6 is "subgraph two" - should return subgraph element
      const elementsOnLine6 = ast.getElementsOnLine?.(6);
      expect(elementsOnLine6).toBeDefined();

      const subgraphElements6 = elementsOnLine6!.filter((e) => e.type === 'subgraph');
      expect(subgraphElements6.length).toBe(1);
      expect((subgraphElements6[0].data as { id?: string }).id).toBe('two');
    });

    it('should return vertex element when subgraph is referenced in edge statement', () => {
      // When a subgraph is used as an edge endpoint like "A --> TOP --> B",
      // TOP appears as a vertex in the AST (not as a subgraph on that line)
      // The highlighting logic in the app will check if the vertex ID matches a subgraph
      const code = `flowchart LR
  subgraph TOP
    direction TB
    subgraph B1
        direction RL
        i1 -->f1
    end
    subgraph B2
        direction BT
        i2 -->f2
    end
  end
  A --> TOP --> B
  B1 --> B2`;

      const chars = CharStream.fromString(code);
      const lexer = new FlowLexer(chars);
      const tokens = new CommonTokenStream(lexer);
      const parser = new FlowParser(tokens);
      const tree = parser.start();
      const builder = new FlowchartASTBuilder(code);
      const result = builder.generateAST(tree);
      const ast = result.ast;

      // Line 13 is "A --> TOP --> B" - should have vertices A, TOP, B and two edges
      const elementsOnLine13 = ast.getElementsOnLine?.(13);
      expect(elementsOnLine13).toBeDefined();

      // Should have 3 vertices (A, TOP, B)
      const vertices = elementsOnLine13!.filter((e) => e.type === 'vertex');
      expect(vertices.length).toBe(3);

      const vertexIds = vertices.map((v) => (v.data as { id?: string }).id);
      expect(vertexIds).toContain('A');
      expect(vertexIds).toContain('TOP');
      expect(vertexIds).toContain('B');

      // Should have 2 edges (A-->TOP and TOP-->B)
      const edges = elementsOnLine13!.filter((e) => e.type === 'edge');
      expect(edges.length).toBe(2);

      // TOP should be a vertex reference here, not a subgraph
      // (the subgraph declaration is on line 2)
      const topVertex = vertices.find((v) => (v.data as { id?: string }).id === 'TOP');
      expect(topVertex).toBeDefined();
      expect(topVertex!.type).toBe('vertex');
    });
  });
});
