/**
 * Comment parsing tests for flowchart diagrams.
 *
 * Tests both ANTLR and Jison parsers via forBothParsers to ensure
 * comments are correctly handled in all positions within a diagram.
 *
 * Some of these tests are expected to fail initially — they document
 * desired behavior that the parsers may not yet support.
 */
import { it, expect } from 'vitest';
import { forBothParsers } from './parseFlowchartAST.js';
import type { FlowchartStatement } from '../../types.js';

/** Helper: return only comment statements from AST */
function comments(statements: FlowchartStatement[]): FlowchartStatement[] {
  return statements.filter((s) => s.type === 'comment');
}

/** Helper: return only non-comment, non-blankLine statements from AST */
function codeStatements(statements: FlowchartStatement[]): FlowchartStatement[] {
  return statements.filter((s) => s.type !== 'comment' && s.type !== 'blankLine');
}

// ────────────────────────────────────────────────────────────────
// Comments after frontmatter / config, before diagram header
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments between frontmatter and diagram header', (parse) => {
  it('should parse a single comment between config and flowchart keyword', async () => {
    const code = `---
config:
  layout: elk
---
%% This is a comment
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('TB');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse multiple comments between config and flowchart keyword', async () => {
    const code = `---
config:
  layout: elk
---
%% First comment
%% Second comment
%% Third comment
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse comments with blank lines between config and flowchart keyword', async () => {
    const code = `---
config:
  layout: elk
---
%% First comment

%% Second comment after blank line

flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse comments with multiple blank lines between config and header', async () => {
    const code = `---
config:
  layout: elk
---


%% Comment after blank lines


flowchart LR
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('LR');
  });
});

// ────────────────────────────────────────────────────────────────
// Comments at the beginning of the diagram body
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments at the beginning of the diagram body', (parse) => {
  it('should parse a single comment at the start of the body', async () => {
    const code = `flowchart TD
    %% Starting comment
    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse multiple consecutive comments at the start of the body', async () => {
    const code = `flowchart TD
    %% First comment
    %% Second comment
    %% Third comment
    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(3);
  });

  it('should parse comments with a blank line before the first statement', async () => {
    const code = `flowchart TD
    %% Comment

    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse comments separated by blank lines at the start', async () => {
    const code = `flowchart TD
    %% First comment

    %% Second comment

    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Comments in the middle of the diagram body
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments in the middle of the diagram body', (parse) => {
  it('should parse a single comment between statements', async () => {
    const code = `flowchart TD
    A-->B
    %% Middle comment
    B-->C`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse multiple consecutive comments between statements', async () => {
    const code = `flowchart TD
    A-->B
    %% Comment line 1
    %% Comment line 2
    %% Comment line 3
    B-->C`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(3);
  });

  it('should parse comments with blank lines between statements', async () => {
    const code = `flowchart TD
    A-->B

    %% Comment after blank line

    B-->C`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
  });

  it('should parse comments scattered throughout the diagram', async () => {
    const code = `flowchart TD
    %% Before A
    A[Start]
    %% Between A and edge
    A-->B
    %% Between edges
    B-->C
    %% After last edge
    C-->D`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(4);
  });

  it('should parse comments with varying indentation', async () => {
    const code = `flowchart LR
    A-->B
%% No indent comment
  %% Two space indent
      %% Deep indent
    B-->C`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(3);
  });
});

// ────────────────────────────────────────────────────────────────
// Comments at the end of the diagram
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments at the end of the diagram', (parse) => {
  it('should parse a single comment at the end', async () => {
    const code = `flowchart TD
    A-->B
    %% Trailing comment`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
  });

  it('should parse multiple comments at the end', async () => {
    const code = `flowchart TD
    A-->B
    %% Trailing comment 1
    %% Trailing comment 2
    %% Trailing comment 3`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(3);
  });

  it('should parse a comment at the end followed by a newline', async () => {
    const code = `flowchart TD
    A-->B
    %% Trailing comment
`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
  });

  it('should parse a comment at the end followed by multiple newlines', async () => {
    const code = `flowchart TD
    A-->B
    %% Trailing comment


`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
  });

  it('should parse comments with blank lines between them at the end', async () => {
    const code = `flowchart TD
    A-->B
    %% First trailing comment

    %% Second trailing comment`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(2);
  });

  it('should parse comments at the end with blank lines and trailing newlines', async () => {
    const code = `flowchart TD
    A-->B

    %% Comment after blank

    %% Another comment after blank

`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Comments at the end of a line (inline / trailing comments)
// ────────────────────────────────────────────────────────────────

forBothParsers('Inline comments at the end of a line', (parse) => {
  it('should handle a comment on the same line as a statement', async () => {
    const code = `flowchart TD
    A-->B %% inline comment
    B-->C`;
    const ast = await parse(code);
    const stmts = codeStatements(ast.statements);
    // The edge A-->B should still parse correctly
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });

  it('should handle a comment after a node definition', async () => {
    const code = `flowchart TD
    A[Start] %% node comment
    A-->B`;
    const ast = await parse(code);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle comments at the end of multiple lines', async () => {
    const code = `flowchart TD
    A[Start] %% first inline
    A-->B %% second inline
    B-->C %% third inline`;
    const ast = await parse(code);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(3);
  });
});

// ────────────────────────────────────────────────────────────────
// Empty / whitespace-only comments
// ────────────────────────────────────────────────────────────────

forBothParsers('Empty and whitespace-only comments', (parse) => {
  it('should parse an empty comment (just %%)', async () => {
    const code = `flowchart TD
    A-->B
    %%
    B-->C`;
    const ast = await parse(code);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });

  it('should parse a comment with only whitespace after %%', async () => {
    const code = `flowchart TD
    A-->B
    %%
    B-->C`;
    const ast = await parse(code);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Init directives (%%{init: ...}%%)
// ────────────────────────────────────────────────────────────────

forBothParsers('Init directives', (parse) => {
  it('should parse a single-line init directive before the header', async () => {
    const code = `%%{init: { "flowchart": { "curve": "basis" }}}%%
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('TB');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse a multi-line init directive before the header', async () => {
    const code = `%%{
  init: {
    "theme": "dark",
    "flowchart": { "curve": "basis" }
  }
}%%
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse init directive with frontmatter before it', async () => {
    const code = `---
config:
  layout: elk
---
%%{init: { "theme": "neutral" }}%%
flowchart LR
    A-->B-->C`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('LR');
  });

  it('should parse init directive with comments around it', async () => {
    const code = `%% Comment before init
%%{init: { "theme": "dark" }}%%
%% Comment after init
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse multiple init directives', async () => {
    const code = `%%{init: { "theme": "dark" }}%%
%%{init: { "flowchart": { "curve": "basis" }}}%%
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse init directive after the header (inline directive)', async () => {
    const code = `flowchart TD
    %%{init: { "theme": "dark" }}%%
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse init directive with blank lines around it', async () => {
    const code = `

%%{init: { "theme": "dark" }}%%

flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Blank line variations
// ────────────────────────────────────────────────────────────────

forBothParsers('Blank line variations with comments', (parse) => {
  it('should handle diagram with only blank lines and comments (no real statements)', async () => {
    const code = `flowchart TD

    %% Just a comment

`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
  });

  it('should handle many blank lines interspersed with comments', async () => {
    const code = `flowchart TD


    %% Comment 1


    %% Comment 2


    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(2);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should handle blank lines before, between, and after comments at end', async () => {
    const code = `flowchart TD
    A-->B

    %% End comment 1

    %% End comment 2

`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Comment text content preservation
// ────────────────────────────────────────────────────────────────

forBothParsers('Comment text content', (parse) => {
  it('should preserve comment text content', async () => {
    const code = `flowchart TD
    %% This is a test comment
    A-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    const commentData = c[0].data as { text: string };
    expect(commentData.text).toContain('This is a test comment');
  });

  it('should preserve comment text that contains diagram syntax', async () => {
    const code = `flowchart TD
    %% A-->B this is not an edge
    C-->D`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    const commentData = c[0].data as { text: string };
    expect(commentData.text).toContain('A-->B');
  });
});

// ────────────────────────────────────────────────────────────────
// Comment position / line tracking
// ────────────────────────────────────────────────────────────────

forBothParsers('Comment position tracking', (parse) => {
  it('should track correct line numbers for comments', async () => {
    const code = `flowchart TD
    A-->B
    %% Comment on line 3
    B-->C`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(1);
    if (c[0].position) {
      expect(c[0].position.startLine).toBe(3);
    }
  });

  it('should track correct line numbers for multiple comments', async () => {
    const code = `flowchart TD
    %% Comment on line 2
    A-->B
    %% Comment on line 4
    B-->C
    %% Comment on line 6`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(3);
    if (c[0].position && c[1].position && c[2].position) {
      expect(c[0].position.startLine).toBe(2);
      expect(c[1].position.startLine).toBe(4);
      expect(c[2].position.startLine).toBe(6);
    }
  });
});

// ────────────────────────────────────────────────────────────────
// Comments do not interfere with diagram parsing
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments do not break diagram structure', (parse) => {
  it('should produce correct vertices and edges despite comments', async () => {
    const code = `flowchart TD
    %% Before
    A[Start] --> B{Decision}
    %% Middle
    B -->|Yes| C[Process]
    B -->|No| D[End]
    %% After`;
    const ast = await parse(code);
    const vertexStmts = ast.statements.filter((s) => s.type === 'vertex');
    const edgeStmts = ast.statements.filter((s) => s.type === 'edge');
    expect(vertexStmts.length + edgeStmts.length).toBeGreaterThanOrEqual(3);
  });

  it('should not confuse %% inside node labels with comments', async () => {
    const code = `flowchart TD
    A["Label with %% inside"]-->B`;
    const ast = await parse(code);
    const c = comments(ast.statements);
    expect(c.length).toBe(0);
  });

  it('should handle subgraphs with comments inside', async () => {
    const code = `flowchart TD
    subgraph sub1[My Subgraph]
        %% Comment inside subgraph
        A-->B
    end
    C-->D`;
    const ast = await parse(code);
    // Should parse without error and produce statements
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(2);
  });
});

// ────────────────────────────────────────────────────────────────
// Comments before diagram header (no frontmatter)
// ────────────────────────────────────────────────────────────────

forBothParsers('Comments before the diagram header (no frontmatter)', (parse) => {
  it('should parse a single comment before flowchart keyword', async () => {
    const code = `%% Leading comment
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse multiple comments before flowchart keyword', async () => {
    const code = `%% Leading comment 1
%% Leading comment 2
%% Leading comment 3
flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse comments with blank lines before flowchart keyword', async () => {
    const code = `%% Leading comment 1

%% Leading comment 2

flowchart TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse comments with blank lines before graph keyword', async () => {
    const code = `%% Comment before graph

graph TD
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('graph');
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────
// Mixed: comments + init directives + frontmatter
// ────────────────────────────────────────────────────────────────

forBothParsers('Mixed comments, init directives, and frontmatter', (parse) => {
  it('should parse frontmatter + comments + init directive + diagram', async () => {
    const code = `---
config:
  layout: elk
---
%% Comment after config
%%{init: { "theme": "dark" }}%%
%% Comment after init
flowchart TD
    %% Body comment
    A-->B
    %% Trailing`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const c = comments(ast.statements);
    // At minimum, body comments should be captured
    expect(c.length).toBeGreaterThanOrEqual(1);
  });

  it('should parse frontmatter + blank lines + comments + diagram', async () => {
    const code = `---
config:
  layout: elk
---

%% Comment 1

%% Comment 2

flowchart LR
    A-->B`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    expect(ast.direction).toBe('LR');
  });

  it('should handle complex real-world diagram with mixed comments', async () => {
    const code = `---
config:
  layout: elk
---
%% This diagram shows a simple decision flow
%%{init: { "theme": "neutral" }}%%

flowchart TD
    %% Entry point
    A[Start] --> B{Is it working?}

    %% Success path
    B -->|Yes| C[Great!]

    %% Failure path
    B -->|No| D[Debug]
    D --> B

    %% End of diagram`;
    const ast = await parse(code);
    expect(ast.header).toBe('flowchart');
    const c = comments(ast.statements);
    // Should capture body comments (entry point, success path, failure path, end)
    expect(c.length).toBeGreaterThanOrEqual(3);
    const stmts = codeStatements(ast.statements);
    expect(stmts.length).toBeGreaterThanOrEqual(4);
  });
});
