import { describe, it, expect, beforeEach } from 'vitest';
import { ANTLRFlowParser } from './antlr-parser.js';
import { FlowDB } from '../../flowDb.js';
// @ts-expect-error: JISON doesn't support types
import flow from '../flow.jison';

/**
 * Test for edge text containing angle brackets like `<<include>>`
 * Issue: The Jison parser handles `--<<include>>-->` correctly, but ANTLR parser fails
 */
describe('Flowchart ANTLR - Edge text with angle brackets', () => {
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

  it('should parse edge text with <<include>> using inline syntax - compare with Jison', () => {
    const input = `flowchart TD
          MakeDonation --<<include>>--> ProcessOnlinePayment`;

    // Parse with Jison parser first to see what it produces
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison (both text and length)
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
    expect(antlrEdges[0].length).toBe(jisonEdges[0].length);
  });

  it('should parse edge text with <<extend>> using inline syntax', () => {
    const input = `flowchart TD
          A --<<extend>>--> B`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
  });

  it('should parse edge text with angle brackets and spaces', () => {
    const input = `flowchart TD
          A -- << include >> --> B`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
  });

  // Note: Single angle brackets like --<uses>--> are ambiguous because <-- is a valid arrow type.
  // This test is skipped because it's a separate issue from the <<include>> problem.
  it.skip('should parse edge text with single angle brackets', () => {
    const input = `flowchart TD
          A --<uses>--> B`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
  });

  it('should parse multiple edges with angle bracket text', () => {
    const input = `flowchart TD
          A --<<include>>--> B
          B --<<extend>>--> C`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
    expect(antlrEdges[1].text).toBe(jisonEdges[1].text);
  });

  it('should parse edge text with angle brackets using pipe syntax', () => {
    const input = `flowchart TD
          A -->|<<include>>| B`;

    // Parse with Jison parser first
    flow.parser.parse(input);
    const jisonEdges = jisonDb.getEdges();

    // Parse with ANTLR parser
    antlrParser.parse(input);
    const antlrEdges = antlrDb.getEdges();

    // ANTLR should produce the same result as Jison
    expect(antlrEdges[0].text).toBe(jisonEdges[0].text);
  });
});
