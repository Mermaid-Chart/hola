import { describe, it, expect, beforeEach } from 'vitest';
import { ANTLRFlowParser } from './antlr-parser.js';
import { FlowDB } from '../../flowDb.js';
import type { EdgeData, VertexData } from '../../types.js';

describe('Flowchart ANTLR AST', () => {
  let parser: ANTLRFlowParser;
  let db: FlowDB;

  beforeEach(() => {
    parser = new ANTLRFlowParser();
    db = new FlowDB();
    db.clear();
    parser.yy = db;
  });

  it('should parse diagram and populate AST in flowDb', () => {
    const input = `flowchart TD
    A[Start] --> B[End]`;

    // Parse the diagram
    parser.parse(input);

    // Get the AST from flowDb
    const ast = db.getAST();

    // Verify AST is populated
    expect(ast).toBeDefined();
    expect(ast).toHaveProperty('header');
    expect(ast).toHaveProperty('statements');
    expect(ast).toHaveProperty('direction');

    // Verify header and direction
    expect(ast!.header).toBe('flowchart');
    expect(ast!.direction).toBe('TB'); // TD is normalized to TB

    // Verify statements array is populated
    expect(Array.isArray(ast!.statements)).toBe(true);
    expect(ast!.statements.length).toBeGreaterThan(0);

    // Verify we have edge statements
    const edgeStatements = ast!.statements.filter((s) => s.type === 'edge');
    expect(edgeStatements.length).toBeGreaterThan(0);

    // Verify edge has correct data
    expect((edgeStatements[0].data as EdgeData).start).toBe('A');
    expect((edgeStatements[0].data as EdgeData).end).toBe('B');

    // Verify each statement has required properties
    ast!.statements.forEach((stmt) => {
      expect(stmt).toHaveProperty('type');
      expect(stmt).toHaveProperty('originalIndex');
      expect(stmt).toHaveProperty('data');
      expect(typeof stmt.originalIndex).toBe('number');
    });
  });

  it('should preserve comments in AST', () => {
    const input = `flowchart TD
    %% This is a comment
    A[Start] --> B[End]
    %% Another comment`;

    // Parse the diagram
    parser.parse(input);

    // Get the AST from flowDb
    const ast = db.getAST();

    // Verify AST is populated
    expect(ast).toBeDefined();
    expect(ast!.statements).toBeDefined();

    // Check for comment statements
    const commentStatements = ast!.statements.filter((s) => s.type === 'comment');

    // Verify comments are preserved
    expect(commentStatements.length).toBe(2);
    expect(commentStatements[0].sourceLine).toBe('%% This is a comment');
    expect(commentStatements[1].sourceLine).toBe('%% Another comment');

    // Verify originalIndex is set correctly
    expect(commentStatements[0].originalIndex).toBe(0); // First statement
    expect(commentStatements[1].originalIndex).toBe(2); // After edge
  });

  it('should verify user reported diagram AST', () => {
    const input = `flowchart LR
    D

    %% Hello!
    I`;

    // Parse the diagram
    parser.parse(input);

    // Get the AST from flowDb
    const ast = db.getAST();

    // Verify AST is populated
    expect(ast).toBeDefined();
    expect(ast!.statements).toBeDefined();

    // Check for comment statements
    const commentStatements = ast!.statements.filter((s) => s.type === 'comment');

    // Verify we have the comment
    expect(commentStatements.length).toBe(1);
    expect(commentStatements[0].sourceLine).toBe('%% Hello!');
    expect(commentStatements[0].originalIndex).toBe(2); // D=0, blank=1, comment=2

    // Check for vertex statements
    const vertexStatements = ast!.statements.filter((s) => s.type === 'vertex');
    expect(vertexStatements.length).toBe(2);
    expect((vertexStatements[0].data as VertexData).id).toBe('D');
    expect(vertexStatements[0].originalIndex).toBe(0);
    expect((vertexStatements[1].data as VertexData).id).toBe('I');
    expect(vertexStatements[1].originalIndex).toBe(3); // D=0, blank=1, comment=2, I=3

    // Check for blank line
    const blankLines = ast!.statements.filter((s) => s.type === 'blankLine');
    expect(blankLines.length).toBe(1);
    expect(blankLines[0].originalIndex).toBe(1); // Between D and comment
  });

  it('should handle node text with HTML-like content and nested double quotes', () => {
    // This tests that the ANTLR parser correctly preprocesses HTML attribute quotes
    // by converting double quotes to single quotes inside HTML tags
    const input = `flowchart TD
    A("fab:fa-youtube <a rel="noopener" href="https://www.youtube.com/watch?v=T5Zthq-QR2A&amp" target="_blank">Starter Guide</a>")`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertex was created with the correct text
    const vertices = db.getVertices();
    expect(vertices.get('A')).toBeDefined();
    expect(vertices.get('A')!.text).toContain('fab:fa-youtube');
    expect(vertices.get('A')!.text).toContain('Starter Guide');
  });

  it('should handle diagram with leading whitespace and comments', () => {
    // This tests parsing a diagram that has leading whitespace (indentation) on each line
    // and includes a comment line before the flowchart header
    const input = `      %% Professional-style IMC Paid Media Campaign Workflow
      flowchart TD
      A`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertex was created
    const vertices = db.getVertices();
    expect(vertices.get('A')).toBeDefined();
  });

  it('should handle inline comments in style statements', () => {
    // This tests parsing a diagram with an inline comment at the end of a style statement
    const input = `flowchart TD
         J
         style J  stroke-width:2px  %% Unified style for Kafka topics,fill:#E1BEE7`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertex was created
    const vertices = db.getVertices();
    expect(vertices.get('J')).toBeDefined();
  });

  it('should handle edge labels with HTML br tags and CSS properties', () => {
    // This tests parsing edge labels containing <br> tags with CSS style properties
    const input = `flowchart LR
          n65 -- "eMail body<br style=--tw-scale-x:>&amp;<br style=--tw-scale-x:>Excels" --> E`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertices were created
    const vertices = db.getVertices();
    expect(vertices.get('n65')).toBeDefined();
    expect(vertices.get('E')).toBeDefined();
  });

  it('should handle multi-line trapezoid node with Unicode characters', () => {
    // This tests parsing a trapezoid node with multi-line text and Unicode symbols
    const input = `flowchart TD

    T[/"Understand Swing Code ↔ RLM Code trading:
(ΔSwing = (ΣRLM₀ – ΣRLMₜuned) ÷ 6)"/]`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertex was created
    const vertices = db.getVertices();
    expect(vertices.get('T')).toBeDefined();
  });

  it('should handle dotted edge with quoted text containing dots and dashes', () => {
    // This tests parsing dotted edges with text that contains dots and dashes
    const input = `flowchart TD
      ERR -. "-.-." .-> ESB`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertices were created
    const vertices = db.getVertices();
    expect(vertices.get('ERR')).toBeDefined();
    expect(vertices.get('ESB')).toBeDefined();
  });

  it('should handle arrow with blank line before target node', () => {
    // This tests parsing when there's a blank line between the arrow and the target node
    const input = `flowchart TD
         Share_ISO -->

         Schedule_Meeting`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertices were created
    const vertices = db.getVertices();
    expect(vertices.get('Share_ISO')).toBeDefined();
    expect(vertices.get('Schedule_Meeting')).toBeDefined();
  });

  it('should handle chained nodes with arrow on separate line', () => {
    // This tests parsing chained nodes where the arrow is at end of line
    // and the target node is on the next line
    const input = `flowchart LR
              s1a("a. Go to console.cloud.google.com") -->
              s1b("b. Click 'New Project' and give it a name")`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertices were created
    const vertices = db.getVertices();
    expect(vertices.get('s1a')).toBeDefined();
    expect(vertices.get('s1b')).toBeDefined();
  });

  it('should handle subgraph with init directive and node with underscores', () => {
    // This tests parsing a diagram with:
    // 1. Init directive %%{init: {'theme':'base'}}%%
    // 2. Subgraph with id and title in brackets
    // 3. Node with underscores in the name
    const input = `graph TD
      %%{init: {'theme':'base'}}%%
      subgraph article_sections[Article Sections]
          inherently_interpretable_models
      end`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the subgraph was created
    const subgraphs = db.getSubGraphs();
    expect(subgraphs.length).toBe(1);
    expect(subgraphs[0].id).toBe('article_sections');
    expect(subgraphs[0].title).toBe('Article Sections');

    // Verify the vertex was created
    const vertices = db.getVertices();
    expect(vertices.get('inherently_interpretable_models')).toBeDefined();
  });

  it('should extract subgraph title from SQUARE_COMPLETE token in Visitor/DB path', () => {
    // This tests that FlowchartParserCore.extractSubgraphLabel() correctly handles
    // SQUARE_COMPLETE tokens. When parsing "subgraph s1[Title]", the SQUARE_COMPLETE
    // token matches "[Title]" as a single token. The Core method must extract the
    // title from this token rather than looking for a separate '[' terminal.
    const input = `flowchart TD
      subgraph s1[My Title]
          A[Node A]
      end`;

    // Parse the diagram
    parser.parse(input);

    // Verify the subgraph was created with correct ID and title
    const subgraphs = db.getSubGraphs();
    expect(subgraphs.length).toBe(1);
    expect(subgraphs[0].id).toBe('s1');
    // BUG FIX: Before the fix, this would incorrectly return 's1' (the ID) as the title
    // because extractSubgraphLabel() didn't handle SQUARE_COMPLETE token
    expect(subgraphs[0].title).toBe('My Title');

    // Also verify the vertex was created
    const vertices = db.getVertices();
    expect(vertices.get('A')).toBeDefined();
  });

  it('should handle dotted edge with embedded text -.text.->', () => {
    // This tests parsing a diagram with:
    // Dotted edge with text embedded in arrow syntax: -.on error.->
    const input = `flowchart LR
    slow_step_function -.on error.-> fifo_dlq`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertices were created
    const vertices = db.getVertices();
    expect(vertices.get('slow_step_function')).toBeDefined();
    expect(vertices.get('fifo_dlq')).toBeDefined();

    // Verify the edge was created with correct text
    const edges = db.getEdges();
    expect(edges.length).toBe(1);
    expect(edges[0].text).toBe('on error');
  });

  it('should handle click statement with hyphenated node ID', () => {
    // This tests parsing a diagram where click references a node with hyphens in its ID
    const input = `flowchart LR
      a2p-sms-api@{label: "Исходящие агрегаторы"}
      click a2p-sms-api "https://www.notion.so/example"`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the vertex was parsed correctly
    const vertices = db.getVertices();
    expect(vertices.has('a2p-sms-api')).toBe(true);
  });

  it('should handle bidirectional edge with text containing parentheses', () => {
    // This tests parsing a bidirectional edge with text like <--text-->
    const input = `flowchart LR
      a2p-sms-api <--HTTPS(баланс, маршрут) --> osclte`;

    // Parse the diagram - should NOT throw
    parser.parse(input);

    // Verify the edge was created with correct text and length
    const edges = db.getEdges();
    expect(edges.length).toBe(1);
    expect(edges[0].text).toBe('HTTPS(баланс, маршрут)');
    expect(edges[0].type).toBe('double_arrow_point');
    expect(edges[0].length).toBe(1); // Should be 1, not 10!
  });

  // Tests for complete token types - ensuring label text is properly extracted
  describe('Complete token types text extraction', () => {
    it('should extract text from CYLINDER_COMPLETE token [(text)]', () => {
      const input = `flowchart TD
        A[(Database)]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Database');
    });

    it('should extract text from SUBROUTINE_COMPLETE token [[text]]', () => {
      const input = `flowchart TD
        A[[Subroutine]]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Subroutine');
    });

    it(String.raw`should extract text from TRAPEZOID_COMPLETE token [/text\]`, () => {
      const input = String.raw`flowchart TD
        A[/Trapezoid\]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Trapezoid');
    });

    it(String.raw`should extract text from INVTRAPEZOID_COMPLETE token [\text/]`, () => {
      const input = String.raw`flowchart TD
        A[\Inverted/]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Inverted');
    });

    it('should extract text from LEANRIGHT_COMPLETE token [/text/]', () => {
      const input = `flowchart TD
        A[/LeanRight/]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('LeanRight');
    });

    it(String.raw`should extract text from LEANLEFT_COMPLETE token [\text\]`, () => {
      const input = String.raw`flowchart TD
        A[\LeanLeft\]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('LeanLeft');
    });

    it('should extract text from SQUARE_COMPLETE token [text]', () => {
      const input = `flowchart TD
        A[Square]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Square');
    });

    it('should extract text from DIAMOND_COMPLETE token {text}', () => {
      const input = `flowchart TD
        A{Diamond}`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Diamond');
    });

    it('should extract text from CIRCLE_COMPLETE token ((text))', () => {
      const input = `flowchart TD
        A((Circle))`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Circle');
    });

    it('should extract text from STADIUM_COMPLETE token ([text])', () => {
      const input = `flowchart TD
        A([Stadium])`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Stadium');
    });

    it('should extract text from ELLIPSE_COMPLETE token (-text-)', () => {
      const input = `flowchart TD
        A(-Ellipse-)`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Ellipse');
    });

    it('should handle quoted text in complete tokens', () => {
      const input = `flowchart TD
        A[("Quoted Database")]
        B[["Quoted Subroutine"]]
        C{{"Quoted Diamond"}}`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Quoted Database');
      expect(vertices.get('B')).toBeDefined();
      expect(vertices.get('B')!.text).toBe('Quoted Subroutine');
      expect(vertices.get('C')).toBeDefined();
      expect(vertices.get('C')!.text).toBe('Quoted Diamond');
    });

    it('should handle quoted text in ELLIPSE_COMPLETE token', () => {
      const input = `flowchart TD
        A(-"Quoted Ellipse"-)`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Quoted Ellipse');
    });
  });

  describe('Complete token fallback to mode-based parsing', () => {
    // These tests verify that inputs with special characters (excluded from complete tokens)
    // correctly fall through to mode-based parsing and produce the same results.
    // SQUARE_COMPLETE excludes / and \ to avoid trapezoid conflicts, but these inputs
    // should still parse correctly via the mode-based slow path.

    it('should parse square bracket text with slashes via mode-based fallback', () => {
      const input = `flowchart TD
        A[text/with/slashes]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('text/with/slashes');
      expect(vertices.get('A')!.type).toBe('square');
    });

    it('should parse square bracket text with backslashes via mode-based fallback', () => {
      const input = String.raw`flowchart TD
        A[path\to\file]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe(String.raw`path\to\file`);
      expect(vertices.get('A')!.type).toBe('square');
    });

    it('should parse square bracket text with mixed slashes via mode-based fallback', () => {
      const input = String.raw`flowchart TD
        A[C:\path/to/file]`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe(String.raw`C:\path/to/file`);
      expect(vertices.get('A')!.type).toBe('square');
    });

    // Note: Characters like (), {}, | are excluded from both complete tokens AND mode-based TEXT_CONTENT.
    // To include these characters, users must use quoted strings:

    it('should parse quoted text with parentheses in diamond', () => {
      const input = `flowchart TD
        A{"Decision(yes)"}`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('Decision(yes)');
      expect(vertices.get('A')!.type).toBe('diamond');
    });

    it('should parse quoted text with curly braces in circle', () => {
      const input = `flowchart TD
        A(("value{1}"))`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('value{1}');
      expect(vertices.get('A')!.type).toBe('circle');
    });

    it('should parse quoted text with pipe in stadium', () => {
      const input = `flowchart TD
        A(["value|other"])`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('value|other');
      expect(vertices.get('A')!.type).toBe('stadium');
    });

    it('should parse quoted text with parentheses in hexagon', () => {
      const input = `flowchart TD
        A{{"func(x)"}}`;

      parser.parse(input);

      const vertices = db.getVertices();
      expect(vertices.get('A')).toBeDefined();
      expect(vertices.get('A')!.text).toBe('func(x)');
      expect(vertices.get('A')!.type).toBe('hexagon');
    });
  });
});
