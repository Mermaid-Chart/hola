import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { FlowLexer } from './generated/FlowLexer.js';
import { FlowParser } from './generated/FlowParser.js';
import { FlowchartASTBuilder } from './FlowchartASTBuilder.js';
import type { EdgeData, VertexData, SubgraphData } from '../../types.js';

function parseFlowchart(input: string) {
  const chars = CharStream.fromString(input);
  const lexer = new FlowLexer(chars);
  const tokens = new CommonTokenStream(lexer);
  const parser = new FlowParser(tokens);
  const tree = parser.start();
  const generator = new FlowchartASTBuilder(input);
  const { ast } = generator.generateAST(tree);
  return ast;
}

describe('Flowchart AST Structure', () => {
  it('should create AST with correct header for flowchart', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');
    expect(ast.header).toBe('flowchart');
    // TD is normalized to TB (both mean top-to-bottom)
    expect(ast.direction).toBe('TB');
  });

  it('should create AST with correct header for graph', () => {
    const ast = parseFlowchart('graph LR\nA-->B');
    expect(ast.header).toBe('graph');
    expect(ast.direction).toBe('LR');
  });

  it('should assign sequential originalIndex to statements', () => {
    const input = `flowchart TD
    A-->B
    B-->C
    C-->D`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Check that originalIndex values are sequential
    for (let i = 0; i < ast.statements.length; i++) {
      expect(ast.statements[i].originalIndex).toBe(i);
    }
  });

  it('should preserve sourceLine for each statement', () => {
    const input = `flowchart TD
    A-->B
    B-->C`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Each statement should have a sourceLine
    ast.statements.forEach((stmt) => {
      expect(stmt.sourceLine).toBeDefined();
      expect(typeof stmt.sourceLine).toBe('string');
    });
  });

  it('should create element mappings', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');
    expect(ast.elementMappings).toBeDefined();
    expect(Array.isArray(ast.elementMappings)).toBe(true);
  });

  it('should track position information in element mappings', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');

    if (ast.elementMappings && ast.elementMappings.length > 0) {
      const mapping = ast.elementMappings[0];
      expect(mapping.position).toBeDefined();
      expect(mapping.position.startLine).toBeGreaterThan(0);
      expect(mapping.position.startColumn).toBeGreaterThanOrEqual(0);
      expect(mapping.position.endLine).toBeGreaterThan(0);
      expect(mapping.position.endColumn).toBeGreaterThan(0);
    }
  });

  it('should handle flowchart with subgraphs', () => {
    const input = `flowchart TD
    subgraph S1
      A-->B
    end
    B-->C`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have statements for subgraph and edges
    const hasSubgraph = ast.statements.some((s) => s.type === 'subgraph');
    expect(hasSubgraph).toBe(true);
  });

  it('should handle flowchart with styles', () => {
    const input = `flowchart TD
    A-->B
    style A fill:#f9f,stroke:#333`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have a style statement
    const hasStyle = ast.statements.some((s) => s.type === 'style');
    expect(hasStyle).toBe(true);
  });

  it('should handle flowchart with classes', () => {
    const input = `flowchart TD
    A-->B
    classDef myClass fill:#f96
    class A myClass`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have classDef and class statements
    const hasClassDef = ast.statements.some((s) => s.type === 'classDef');
    const hasClass = ast.statements.some((s) => s.type === 'class');
    expect(hasClassDef).toBe(true);
    expect(hasClass).toBe(true);
  });

  it('should handle flowchart with click interactions', () => {
    const input = `flowchart TD
    A-->B
    click A "http://example.com" "Tooltip"`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have a click statement
    const hasClick = ast.statements.some((s) => s.type === 'click');
    expect(hasClick).toBe(true);
  });

  it('should handle flowchart with link styles', () => {
    const input = `flowchart TD
    A-->B
    B-->C
    linkStyle 0 stroke:#ff3,stroke-width:4px`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have a linkStyle statement
    const hasLinkStyle = ast.statements.some((s) => s.type === 'linkStyle');
    expect(hasLinkStyle).toBe(true);
  });

  it('should handle flowchart with direction changes', () => {
    const input = `flowchart TD
    A-->B
    direction LR
    B-->C`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have a direction statement
    const hasDirection = ast.statements.some((s) => s.type === 'direction');
    expect(hasDirection).toBe(true);
  });

  it('should handle flowchart with accessibility statements', () => {
    const input = `flowchart TD
    accTitle: My Flowchart
    accDescr: This is a description
    A-->B`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have accTitle and accDescr statements
    const hasAccTitle = ast.statements.some((s) => s.type === 'accTitle');
    const hasAccDescr = ast.statements.some((s) => s.type === 'accDescr');
    expect(hasAccTitle).toBe(true);
    expect(hasAccDescr).toBe(true);
  });

  it('should handle blank lines in flowchart', () => {
    const input = `flowchart TD
    A-->B

    B-->C`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have blank line statements
    const hasBlankLine = ast.statements.some((s) => s.type === 'blankLine');
    expect(hasBlankLine).toBe(true);
  });

  it('should have bidirectional sync methods attached', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');

    // Check that sync methods are attached
    const getElementAtPosition = ast.getElementAtPosition?.bind(ast);
    expect(getElementAtPosition).toBeDefined();
    expect(typeof getElementAtPosition).toBe('function');
    const getElementById = ast.getElementById?.bind(ast);
    expect(getElementById).toBeDefined();
    expect(typeof getElementById).toBe('function');
    const getElementAtIndex = ast.getElementAtIndex?.bind(ast);
    expect(getElementAtIndex).toBeDefined();
    expect(typeof getElementAtIndex).toBe('function');
  });

  it('should have type-specific getter methods attached', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');

    // Check that type-specific getters are attached
    const getVertices = ast.getVertices?.bind(ast);
    expect(getVertices).toBeDefined();
    expect(typeof getVertices).toBe('function');
    const getEdges = ast.getEdges?.bind(ast);
    expect(getEdges).toBeDefined();
    expect(typeof getEdges).toBe('function');
    const getSubgraphs = ast.getSubgraphs?.bind(ast);
    expect(getSubgraphs).toBeDefined();
    expect(typeof getSubgraphs).toBe('function');
  });

  it('should have getStats method attached', () => {
    const ast = parseFlowchart('flowchart TD\nA-->B');

    const getStats = ast.getStats?.bind(ast);
    expect(getStats).toBeDefined();
    expect(typeof getStats).toBe('function');

    const stats = getStats!();
    expect(stats).toBeDefined();
    expect(stats.totalElements).toBeGreaterThanOrEqual(0);
  });

  it('should handle nested subgraphs without spurious blank lines', () => {
    // This input has NO blank lines - the AST should reflect that
    const input = `flowchart TB
subgraph s1
  subgraph s2
    A[A]
  end
end`;

    const ast = parseFlowchart(input);

    // Should have exactly 1 top-level statement (the outer subgraph s1)
    // No blank lines should appear since the input has none
    const blankLines = ast.statements.filter((s) => s.type === 'blankLine');
    expect(blankLines.length).toBe(0);

    // Should have one subgraph at top level
    const subgraphs = ast.statements.filter((s) => s.type === 'subgraph');
    expect(subgraphs.length).toBe(1);

    // The outer subgraph should be s1
    const s1Data = subgraphs[0].data as {
      id: string;
      statements: { type: string; data: { id: string; statements?: unknown[] } }[];
    };
    expect(s1Data.id).toBe('s1');

    // s1 should contain s2 (no blank lines inside)
    const s1Statements = s1Data.statements;
    const s1BlankLines = s1Statements.filter((s) => s.type === 'blankLine');
    expect(s1BlankLines.length).toBe(0);

    // s1 should contain s2
    const innerSubgraphs = s1Statements.filter((s) => s.type === 'subgraph');
    expect(innerSubgraphs.length).toBe(1);
    expect(innerSubgraphs[0].data.id).toBe('s2');

    // s2 should contain vertex A (no blank lines inside)
    const s2Statements = (innerSubgraphs[0].data.statements ?? []) as {
      type: string;
      data?: { id?: string };
    }[];
    const s2BlankLines = s2Statements.filter((s) => s.type === 'blankLine');
    expect(s2BlankLines.length).toBe(0);

    // s2 should contain vertex A
    const vertices = s2Statements.filter((s) => s.type === 'vertex');
    expect(vertices.length).toBe(1);
    expect(vertices[0].data?.id).toBe('A');

    // Verify sourceLine preserves internal indentation
    // The s1 sourceLine should include the nested content with indentation
    const s1SourceLine = subgraphs[0].sourceLine;
    expect(s1SourceLine).toContain('  subgraph s2'); // 2-space indent
    expect(s1SourceLine).toContain('    A[A]'); // 4-space indent

    // The s2 sourceLine should include its content with indentation
    const s2SourceLine = (innerSubgraphs[0] as { sourceLine?: string }).sourceLine;
    expect(s2SourceLine).toContain('    A[A]'); // 4-space indent preserved
  });

  it('should handle complex flowchart with multiple statement types', () => {
    const input = `flowchart TD
    accTitle: Complex Flowchart
    A[Start]-->B{Decision}
    B-->|Yes|C[Process]
    B-->|No|D[End]
    subgraph S1
      C-->E[Step 1]
      E-->F[Step 2]
    end
    F-->D
    style A fill:#f9f
    style D fill:#bbf
    classDef important fill:#f96
    class B important
    click A "http://example.com"
    linkStyle 0 stroke:#ff3`;

    const ast = parseFlowchart(input);
    expect(ast.statements.length).toBeGreaterThan(0);

    // Should have multiple statement types
    const types = new Set(ast.statements.map((s) => s.type));
    expect(types.size).toBeGreaterThan(1);
  });

  it('should have matching ids between edge statements and elementMappings', () => {
    const input = `flowchart TB
    A --> B
    A --> B`;

    const ast = parseFlowchart(input);

    // Get all edge statements
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(2);

    // Get all edge mappings
    const edgeMappings = ast.elementMappings?.filter((m) => m.type === 'edge') ?? [];
    expect(edgeMappings.length).toBe(2);

    // Each edge statement should have an id that matches the corresponding mapping
    for (const [i, statement] of edgeStatements.entries()) {
      const mapping = edgeMappings[i];

      // Statement data should have an id
      expect((statement.data as EdgeData).id).toBeDefined();
      expect((statement.data as EdgeData).id).not.toBe('');

      // Mapping should have an id
      expect(mapping.id).toBeDefined();
      expect(mapping.id).not.toBe('');

      // The ids should match
      expect((statement.data as EdgeData).id).toBe(mapping.id);
    }
  });

  it('should generate unique edge ids for duplicate edges', () => {
    const input = `flowchart TB
    A --> B
    A --> B
    B --> C`;

    const ast = parseFlowchart(input);

    // Get all edge statements
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(3);

    // Collect all edge ids
    const edgeIds = edgeStatements.map((s) => (s.data as EdgeData).id);

    // All ids should be unique
    const uniqueIds = new Set(edgeIds);
    expect(uniqueIds.size).toBe(edgeIds.length);

    // IDs should follow the pattern edge-0, edge-1, edge-2
    expect(edgeIds).toContain('edge-0');
    expect(edgeIds).toContain('edge-1');
    expect(edgeIds).toContain('edge-2');
  });
});

describe('Node shape parsing', () => {
  it('should set type to cylinder for [(text)] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[(Database)]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('cylinder');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Database');
  });

  it('should set type to round for (text) syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A(Round)');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('round');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Round');
  });

  it('should set type to square for [text] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[Square]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('square');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Square');
  });

  it('should set type to diamond for {text} syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A{Decision}');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('diamond');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Decision');
  });

  it('should set type to hexagon for {{text}} syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A{{Prepare}}');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('hexagon');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Prepare');
  });

  it('should set type to stadium for ([text]) syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A([Stadium])');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('stadium');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Stadium');
  });

  it('should set type to circle for ((text)) syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A((Circle))');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('circle');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Circle');
  });

  it('should set type to subroutine for [[text]] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[[Subroutine]]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('subroutine');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Subroutine');
  });

  it('should set type to trapezoid for [/text\\] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[/Trapezoid\\]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('trapezoid');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Trapezoid');
  });

  it(String.raw`should set type to inv_trapezoid for [\text/] syntax`, () => {
    const ast = parseFlowchart(String.raw`flowchart TB
    A[\InvTrapezoid/]`);
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('inv_trapezoid');
    expect((nodeStmt?.data as VertexData)?.text).toBe('InvTrapezoid');
  });

  it('should set type to lean_right for [/text/] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[/Parallelogram/]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('lean_right');
    expect((nodeStmt?.data as VertexData)?.text).toBe('Parallelogram');
  });

  it('should set type to lean_left for [\\text\\] syntax', () => {
    const ast = parseFlowchart('flowchart TB\n    A[\\ParallelogramAlt\\]');
    const nodeStmt = ast.statements.find((s) => s.type === 'vertex');
    expect(nodeStmt).toBeDefined();
    expect((nodeStmt?.data as VertexData)?.type).toBe('lean_left');
    expect((nodeStmt?.data as VertexData)?.text).toBe('ParallelogramAlt');
  });
});

describe('Subgraph parsing', () => {
  it('should parse subgraph with simple ID', () => {
    const ast = parseFlowchart('flowchart TB\n    subgraph s1\n        A\n    end');
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    expect((subgraphStmt?.data as SubgraphData)?.id).toBe('s1');
  });

  it('should parse subgraph with quoted label using brackets', () => {
    const ast = parseFlowchart('flowchart TB\n    subgraph s1["My Label"]\n        A\n    end');
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    expect((subgraphStmt?.data as SubgraphData)?.id).toBe('s1');
    expect((subgraphStmt?.data as SubgraphData)?.title).toBe('My Label');
  });

  it('should parse subgraph with unquoted label using brackets', () => {
    const ast = parseFlowchart('flowchart TB\n    subgraph s1[MyLabel]\n        A\n    end');
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    expect((subgraphStmt?.data as SubgraphData)?.id).toBe('s1');
    expect((subgraphStmt?.data as SubgraphData)?.title).toBe('MyLabel');
  });

  it('should parse subgraph with spaces in quoted label', () => {
    const ast = parseFlowchart(
      'flowchart TB\n    subgraph s1["Article Sections"]\n        A\n    end'
    );
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    expect((subgraphStmt?.data as SubgraphData)?.id).toBe('s1');
    expect((subgraphStmt?.data as SubgraphData)?.title).toBe('Article Sections');
  });

  it('should parse subgraph without any label', () => {
    const ast = parseFlowchart('flowchart TB\n    subgraph\n        A\n    end');
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    // Subgraph without ID should have auto-generated ID
    expect((subgraphStmt?.data as SubgraphData)?.id).toBeDefined();
  });

  it('should parse nested subgraphs', () => {
    const ast = parseFlowchart(
      'flowchart TB\n    subgraph outer\n        subgraph inner\n            A\n        end\n    end'
    );
    const outerSubgraph = ast.statements.find((s) => s.type === 'subgraph');
    expect(outerSubgraph).toBeDefined();
    expect((outerSubgraph?.data as SubgraphData)?.id).toBe('outer');

    // Check for nested subgraph
    const innerStatements = (outerSubgraph?.data as SubgraphData)?.statements as {
      type: string;
      data?: { id?: string };
    }[];
    const innerSubgraph = innerStatements?.find((s) => s.type === 'subgraph');
    expect(innerSubgraph).toBeDefined();
    expect(innerSubgraph?.data?.id).toBe('inner');
  });

  it('should parse subgraph with direction statement', () => {
    const ast = parseFlowchart(
      'flowchart TB\n    subgraph s1\n        direction LR\n        A --> B\n    end'
    );
    const subgraphStmt = ast.statements.find((s) => s.type === 'subgraph');
    expect(subgraphStmt).toBeDefined();
    expect((subgraphStmt?.data as SubgraphData)?.id).toBe('s1');

    // Check for direction statement inside subgraph
    const innerStatements = (subgraphStmt?.data as SubgraphData)?.statements as { type: string }[];
    const directionStmt = innerStatements?.find((s) => s.type === 'direction');
    expect(directionStmt).toBeDefined();
  });
});
