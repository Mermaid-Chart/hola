import { describe, it, expect, beforeEach } from 'vitest';
import { ANTLRFlowParser } from './antlr-parser.js';
import { FlowDB } from '../../flowDb.js';
// @ts-expect-error: JISON doesn't support types
import flow from '../flow.jison';

/**
 * Test for continuation links where the link starts on a new line
 * Issue: The Jison parser handles continuation links correctly, but ANTLR parser fails
 * Example:
 *   J["get ownerType"]
 *   --- J1["Individual"] & J2["Business"]
 * should be equivalent to:
 *   J["get ownerType"] --- J1["Individual"] & J2["Business"]
 */
describe('Flowchart ANTLR - Continuation links', () => {
  let antlrParser: ANTLRFlowParser;
  let antlrDb: FlowDB;
  let jisonDb: FlowDB;

  beforeEach(() => {
    antlrParser = new ANTLRFlowParser();
    antlrDb = new FlowDB();
    antlrDb.clear();
    antlrParser.yy = antlrDb;

    jisonDb = new FlowDB();
    jisonDb.clear();
    flow.parser.yy = jisonDb;
  });

  it('should parse continuation link on separate line - simple case', () => {
    const input = `flowchart TD
    J["get ownerType"]
    --- J1["Individual"]`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('J')).toBeDefined();
    expect(jisonVertices.get('J1')).toBeDefined();
    expect(jisonEdges.length).toBe(1);
    expect(jisonEdges[0].start).toBe('J');
    expect(jisonEdges[0].end).toBe('J1');

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('J')).toBeDefined();
    expect(antlrVertices.get('J1')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
    expect(antlrEdges[0].start).toBe(jisonEdges[0].start);
    expect(antlrEdges[0].end).toBe(jisonEdges[0].end);
  });

  it('should parse continuation link with ampersand for multiple targets', () => {
    const input = `flowchart TD
    J["get ownerType"]
    --- J1["Individual"] & J2["Business"]`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('J')).toBeDefined();
    expect(jisonVertices.get('J1')).toBeDefined();
    expect(jisonVertices.get('J2')).toBeDefined();
    expect(jisonEdges.length).toBe(2);

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('J')).toBeDefined();
    expect(antlrVertices.get('J1')).toBeDefined();
    expect(antlrVertices.get('J2')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
  });

  it('should parse continuation link inside subgraph', () => {
    const input = `flowchart TD
  subgraph MATSUBoroughAchorageMOA
    J["get ownerType"]
    ---J1["Individual"] & J2["Business"]
  end`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('J')).toBeDefined();
    expect(jisonVertices.get('J1')).toBeDefined();
    expect(jisonVertices.get('J2')).toBeDefined();
    expect(jisonEdges.length).toBe(2);

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('J')).toBeDefined();
    expect(antlrVertices.get('J1')).toBeDefined();
    expect(antlrVertices.get('J2')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
  });

  it('should parse continuation link with arrow', () => {
    const input = `flowchart TD
    J["get ownerType"]
    --> J1["Individual"]`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges.length).toBe(jisonEdges.length);
    expect(antlrEdges[0].start).toBe(jisonEdges[0].start);
    expect(antlrEdges[0].end).toBe(jisonEdges[0].end);
    expect(antlrEdges[0].type).toBe(jisonEdges[0].type);
  });

  it('should parse edge with pipe-delimited text', () => {
    const input = `flowchart TD
      Permisos --|Opt-in|--> SDK`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('Permisos')).toBeDefined();
    expect(jisonVertices.get('SDK')).toBeDefined();
    expect(jisonEdges.length).toBe(1);

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('Permisos')).toBeDefined();
    expect(antlrVertices.get('SDK')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
    // Edge length should be 1 (default), not longer
    expect(antlrEdges[0].length).toBe(jisonEdges[0].length);
  });

  it('should parse edge with empty pipe-delimited text (--|-->)', () => {
    const input = `flowchart TB
    AI_Core --|--> Data_Integration`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('AI_Core')).toBeDefined();
    expect(jisonVertices.get('Data_Integration')).toBeDefined();
    expect(jisonEdges.length).toBe(1);

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('AI_Core')).toBeDefined();
    expect(antlrVertices.get('Data_Integration')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
    expect(antlrEdges[0].length).toBe(jisonEdges[0].length);
  });

  it('should parse continuation link with quoted text ending with arrow', () => {
    const input = `flowchart TD
              D -- "true" -->
              A`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonVertices = jisonDb.getVertices();
    const jisonEdges = jisonDb.getEdges();

    // Verify Jison parsing worked
    expect(jisonVertices.get('D')).toBeDefined();
    expect(jisonVertices.get('A')).toBeDefined();
    expect(jisonEdges.length).toBe(1);
    expect(jisonEdges[0].start).toBe('D');
    expect(jisonEdges[0].end).toBe('A');
    expect(jisonEdges[0].text).toBe('true');

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrVertices = antlrDb.getVertices();
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrVertices.get('D')).toBeDefined();
    expect(antlrVertices.get('A')).toBeDefined();
    expect(antlrEdges.length).toBe(jisonEdges.length);
    expect(antlrEdges[0].start).toBe(jisonEdges[0].start);
    expect(antlrEdges[0].end).toBe(jisonEdges[0].end);
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
  });
});
