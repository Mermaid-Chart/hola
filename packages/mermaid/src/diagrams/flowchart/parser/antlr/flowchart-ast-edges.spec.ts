import { inspect } from 'node:util';
import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { FlowLexer } from './generated/FlowLexer.js';
import { FlowParser } from './generated/FlowParser.js';
import { FlowchartASTBuilder } from './FlowchartASTBuilder.js';
import type { EdgeData } from '../../types.js';

/**
 * Parse input using ANTLR directly and return the AST
 */
function parseWithAntlr(input: string) {
  const inputStream = CharStream.fromString(input);
  const lexer = new FlowLexer(inputStream);
  const tokenStream = new CommonTokenStream(lexer);
  const parser = new FlowParser(tokenStream);
  const tree = parser.start();

  const builder = new FlowchartASTBuilder(input);
  return builder.generateAST(tree);
}

const ASTX_PREFIX = 'ASTX:';
function astxDebug(value: unknown): void {
  if (!process.env.ASTX_DEBUG) {
    return;
  }

  process.stderr.write(`${ASTX_PREFIX} ${inspect(value, { depth: 6, breakLength: 120 })}\n`);
}

describe('Flowchart ANTLR Parser - AST Edge IDs', () => {
  it('should have edge IDs defined in the AST', () => {
    const input = `flowchart TD
A-->B`;

    const result = parseWithAntlr(input);

    // Get the AST
    const ast = result.ast;
    expect(ast).toBeDefined();

    // Check that we have edge statements
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBeGreaterThan(0);

    // Check that each edge has an ID
    for (const edgeStatement of edgeStatements) {
      const edgeData = edgeStatement.data as EdgeData;
      expect(edgeData.id).toBeDefined();
      expect(edgeData.id).not.toBe('');
      expect(edgeData.id).not.toBe(undefined);
    }
  });

  it('should have edge IDs in metadata.edges', () => {
    const input = `flowchart TD
A-->B
B-->C`;

    const result = parseWithAntlr(input);

    // Get the AST
    const ast = result.ast;
    expect(ast).toBeDefined();
    expect(ast.metadata).toBeDefined();
    expect(ast.metadata!.edges).toBeDefined();

    // Check metadata.edges
    expect(ast.metadata!.edges!.length).toBeGreaterThan(0);

    // Check that each edge in metadata has an ID
    for (const edge of ast.metadata!.edges!) {
      expect(edge.id).toBeDefined();
      expect(edge.id).not.toBe('');
      expect(edge.id).not.toBe(undefined);
    }
  });

  it('should have consistent edge IDs between statements and metadata', () => {
    const input = `flowchart TD
A-->B
B-->C
C-->D`;

    const result = parseWithAntlr(input);

    // Get the AST
    const ast = result.ast;
    expect(ast).toBeDefined();

    // Get edge statements
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(3);

    // Get metadata edges
    expect(ast.metadata).toBeDefined();
    expect(ast.metadata!.edges).toBeDefined();
    expect(ast.metadata!.edges!.length).toBe(3);

    // Check that IDs are consistent
    for (const [i, edgeStatement] of edgeStatements.entries()) {
      const edgeData = edgeStatement.data as EdgeData;
      const statementId = edgeData.id;
      const metadataId = ast.metadata!.edges![i].id;

      expect(statementId).toBeDefined();
      expect(metadataId).toBeDefined();
      expect(statementId).toBe(metadataId);
    }
  });

  it('should generate unique edge IDs for multiple edges', () => {
    const input = `flowchart TD
A-->B
B-->C
C-->D
D-->E`;

    const result = parseWithAntlr(input);

    // Get the AST
    const ast = result.ast;
    expect(ast).toBeDefined();
    expect(ast.metadata).toBeDefined();
    expect(ast.metadata!.edges).toBeDefined();

    // Get all edge IDs
    const edgeIds = ast.metadata!.edges!.map((e) => e.id);

    // Check that all IDs are unique
    const uniqueIds = new Set(edgeIds);
    expect(uniqueIds.size).toBe(edgeIds.length);
  });

  it('should preserve user-defined edge IDs', () => {
    const input = `flowchart TD
A myEdgeId@--> B`;

    const result = parseWithAntlr(input);

    // Get the AST
    const ast = result.ast;
    expect(ast).toBeDefined();

    // Check that the edge has the user-defined ID
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(1);
    const edgeData = edgeStatements[0].data as EdgeData;
    expect(edgeData.id).toBe('myEdgeId');

    // Also check metadata
    expect(ast.metadata).toBeDefined();
    expect(ast.metadata!.edges).toBeDefined();
    expect(ast.metadata!.edges!.length).toBe(1);
    expect(ast.metadata!.edges![0].id).toBe('myEdgeId');
  });
});

describe('Flowchart ANTLR Parser - metadata.nodes backwards compatibility (A1)', () => {
  it('should keep metadata.nodes populated for inline-only node diagrams (A[Start] --> B & C)', () => {
    const input = `flowchart LR\nA[Start] --> B & C`;

    const result = parseWithAntlr(input);
    const ast: any = result.ast;

    expect(ast).toBeDefined();
    expect(ast.metadata).toBeDefined();
    expect(ast.metadata.nodes).toBeDefined();

    // Debug output (single prefix for grepping)
    astxDebug({
      nodesType: typeof ast.metadata.nodes,
      nodesIsMap: ast.metadata.nodes instanceof Map,
      nodeKeys: Object.keys(ast.metadata.nodes),
    });

    const nodeKeys = Object.keys(ast.metadata.nodes);
    expect(nodeKeys).toEqual(expect.arrayContaining(['A', 'B', 'C']));

    expect(ast.metadata.nodes.A).toMatchObject({ id: 'A', text: 'Start' });
    expect(ast.metadata.nodes.B).toMatchObject({ id: 'B', text: 'B' });
    expect(ast.metadata.nodes.C).toMatchObject({ id: 'C', text: 'C' });

    // Ensure we retain `type` when it is inferable from inline definition
    expect(ast.metadata.nodes.A.type).toBeDefined();
  });
});

describe('Flowchart ANTLR Parser - Edge occurrences and statement linkage', () => {
  it('should expose edgeOccurrences + mapping linkage for ampersand chain (A --> B & C)', () => {
    const input = `flowchart LR
A --> B & C`;

    const result = parseWithAntlr(input);
    const ast = result.ast;

    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(1);
    const stmt: any = edgeStatements[0];

    // Statement identity + span
    expect(stmt.statementId).toBeDefined();
    expect(String(stmt.statementId)).toMatch(/^stmt:/);
    expect(stmt.position).toBeDefined();
    expect(typeof stmt.position.startIndex).toBe('number');
    expect(typeof stmt.position.endIndex).toBe('number');

    // Occurrence completeness
    expect(Array.isArray(stmt.edgeOccurrences)).toBe(true);
    expect(stmt.edgeOccurrences.length).toBe(2);

    // Debug output (single prefix for grepping)
    astxDebug({
      statementId: stmt.statementId,
      edgeOccurrences: stmt.edgeOccurrences,
      edgeMappings: ast.elementMappings?.filter((m) => m.type === 'edge'),
    });

    // Mapping → occurrence linkage + distinct per-occurrence spans
    const edgeMappings = (ast.elementMappings ?? []).filter((m) => m.type === 'edge');
    expect(edgeMappings.length).toBe(2);

    const occurrenceIds = new Set<string>();
    const mappingSpans = new Set<string>();
    for (const m of edgeMappings as any[]) {
      expect(m.statementId).toBe(stmt.statementId);
      expect(m.statementOriginalIndex).toBe(stmt.originalIndex);

      expect(m.occurrenceId).toBeDefined();
      expect(m.occurrenceIndex).toBeDefined();
      expect(typeof m.occurrenceIndex).toBe('number');

      occurrenceIds.add(m.occurrenceId);
      mappingSpans.add(`${m.position.startIndex}:${m.position.endIndex}`);

      const occMatches = (stmt.edgeOccurrences as any[]).filter(
        (o) => o.occurrenceId === m.occurrenceId
      );
      expect(occMatches.length).toBe(1);
      const occ = occMatches[0];

      // Occurrence should mirror mapping edge identity
      expect(occ.id).toBe(m.id);
      expect(occ.svgId).toBe(m.svgId);
      expect(occ.occurrenceIndex).toBe(m.occurrenceIndex);
      expect(occ.parentStatementId).toBe(stmt.statementId);
      expect(occ.parentOriginalIndex).toBe(stmt.originalIndex);
      expect(occ.position).toBeDefined();
      expect(occ.position.startIndex).toBe(m.position.startIndex);
      expect(occ.position.endIndex).toBe(m.position.endIndex);

      // Also validate endpoints match mapping data
      expect(occ.start).toBe(m.data.start);
      expect(occ.end).toBe(m.data.end);
    }

    // Ensure we truly have 2 distinct occurrences + spans
    expect(occurrenceIds.size).toBe(2);
    expect(mappingSpans.size).toBe(2);
  });

  it('should expose edgeOccurrences for chained syntax (A --> B --> C)', () => {
    const input = `flowchart LR
A --> B --> C`;

    const result = parseWithAntlr(input);
    const ast = result.ast;
    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(1);
    const stmt: any = edgeStatements[0];

    expect(stmt.statementId).toBeDefined();
    expect(Array.isArray(stmt.edgeOccurrences)).toBe(true);
    expect(stmt.edgeOccurrences.length).toBe(2);

    const spans = new Set(
      (stmt.edgeOccurrences as any[]).map(
        (o) => `${o.position?.startIndex}:${o.position?.endIndex}`
      )
    );
    expect(spans.size).toBe(2);
  });

  it('should expose Addendum root extensions flags (extensions.* = true)', () => {
    const input = `flowchart LR\nA --> B & C`;
    const result = parseWithAntlr(input);
    const ast: any = result.ast;

    expect(ast.extensions).toBeDefined();
    expect(ast.extensions.edgeOccurrences).toBe(true);
    expect(ast.extensions.edgeOccurrenceMappings).toBe(true);
    expect(ast.extensions.statementIds).toBe(true);
    expect(ast.extensions.statementPositions).toBe(true);
    expect(ast.extensions.inlineNodeDefs).toBe(true);
    expect(ast.extensions.dataRef).toBe(true);
    expect(ast.extensions.primaryEdgeData).toBe(true);
    expect(ast.extensions.exactPositions).toBe(true);
    expect(ast.extensions.compoundMetadata).toBe(true);
  });

  it('should anchor legacy statement.data via dataRef + expose primaryEdgeData + statementFlags (A --> B & C)', () => {
    const input = `flowchart LR\nA --> B & C`;
    const result = parseWithAntlr(input);
    const ast = result.ast;

    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(1);
    const stmt: any = edgeStatements[0];

    expect(Array.isArray(stmt.edgeOccurrences)).toBe(true);
    expect(stmt.edgeOccurrences.length).toBe(2);

    // Legacy statement.data must remain untouched (hybrid for compound)
    expect(stmt.data.start).toBe('A');
    expect(stmt.data.end).toBe('C');

    // dataRef anchors statement.data to a specific occurrence
    expect(stmt.dataRef).toBeDefined();
    expect(stmt.dataRef.kind).toBe('edgeOccurrence');
    expect(typeof stmt.dataRef.occurrenceId).toBe('string');

    const occMatches = (stmt.edgeOccurrences as any[]).filter(
      (o) => o.occurrenceId === stmt.dataRef.occurrenceId
    );
    expect(occMatches.length).toBe(1);
    if (stmt.dataRef.occurrenceIndex !== undefined) {
      expect(stmt.dataRef.occurrenceIndex).toBe(occMatches[0].occurrenceIndex);
    }

    // primaryEdgeData is a normalized, unambiguous representative (occurrenceIndex 0)
    expect(stmt.primaryEdgeData).toBeDefined();
    expect(stmt.primaryEdgeData.start).toBe(stmt.edgeOccurrences[0].start);
    expect(stmt.primaryEdgeData.end).toBe(stmt.edgeOccurrences[0].end);

    // Advisory flags for compound statements
    expect(stmt.statementFlags).toBeDefined();
    expect(stmt.statementFlags.dataIsLegacyForCompoundEdges).toBe(true);

    // Debug output (single prefix for grepping)
    astxDebug({
      data: stmt.data,
      dataRef: stmt.dataRef,
      primaryEdgeData: stmt.primaryEdgeData,
      statementFlags: stmt.statementFlags,
    });
  });

  it('should provide exactPosition spans that are within the statement span and distinct (A --> B & C)', () => {
    const input = `flowchart LR\nA --> B & C`;
    const result = parseWithAntlr(input);
    const ast = result.ast;

    const edgeStatements = ast.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBe(1);
    const stmt: any = edgeStatements[0];
    expect(stmt.position).toBeDefined();

    const exactSpans = new Set<string>();
    for (const occ of stmt.edgeOccurrences as any[]) {
      expect(occ.exactPosition).toBeDefined();
      expect(occ.exactPosition.startIndex).toBeGreaterThanOrEqual(stmt.position.startIndex);
      expect(occ.exactPosition.endIndex).toBeLessThanOrEqual(stmt.position.endIndex);
      exactSpans.add(`${occ.exactPosition.startIndex}:${occ.exactPosition.endIndex}`);
    }
    expect(exactSpans.size).toBe((stmt.edgeOccurrences as any[]).length);
  });

  it('should emit compound metadata (compound.kind) for single/and_list/chain', () => {
    const single = parseWithAntlr(`flowchart LR\nA --> B`).ast;
    const andList = parseWithAntlr(`flowchart LR\nA --> B & C`).ast;
    const chain = parseWithAntlr(`flowchart LR\nA --> B --> C`).ast;

    const s1: any = single.statements.find((s) => s.type === 'edge');
    const s2: any = andList.statements.find((s) => s.type === 'edge');
    const s3: any = chain.statements.find((s) => s.type === 'edge');

    expect(s1.compound).toBeDefined();
    expect(s1.compound.kind).toBe('single');

    expect(s2.compound).toBeDefined();
    expect(s2.compound.kind).toBe('and_list');

    expect(s3.compound).toBeDefined();
    expect(s3.compound.kind).toBe('chain');
  });
});
