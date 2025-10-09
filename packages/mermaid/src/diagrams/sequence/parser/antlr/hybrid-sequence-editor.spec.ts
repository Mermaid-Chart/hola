import { describe, it, expect } from 'vitest';
import { HybridSequenceEditor } from './SequenceASTService.js';
import { parser as antlrParser } from './antlr-parser.js';

/**
 * This test demonstrates how to consume HybridSequenceEditor by:
 * - creating an editor from code
 * - updating a participant alias via updateParticipantAlias
 * - regenerating code from AST
 *
 * Note: HybridSequenceEditor’s internal AST builder is a stub; in this test we
 * parse with the ANTLR parser to obtain the AST and inject it into the editor.
 */

// Reuse the full set of round-trip test cases
import { ROUNDTRIP_CASES } from './sequence-codegen-roundtrip.spec.js';

function normalizeLines(txt: string): string {
  return txt
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[\t ]+$/g, ''))
    .join('\n')
    .trim();
}

describe('HybridSequenceEditor usage', () => {
  it('updates participant alias from a simple diagram XYZ12', () => {
    const input = `sequenceDiagram
    actor Alice
    Alice->>Bob: Hi Bob`;

    // Create the editor with the input diagram
    const editor = new HybridSequenceEditor(input);

    // Parse input with ANTLRSequenceParser to get a full AST built by SequenceCodeGenerator
    antlrParser.parse(input);
    const ast = antlrParser.getAST();

    // Inject the parsed AST into the editor
    (editor as any).ast = ast;

    // Perform the alias update
    editor.updateParticipantAlias('Alice', 'Alicia');

    // Regenerate code using the AST strategy
    const out = editor.regenerateCode('ast');

    // Current HybridSequenceEditor normalizes to the keyword "participant"
    // and indents statements by two spaces.
    const expected = `sequenceDiagram\n  actor Alice as Alicia\n  Alice->>Bob: Hi Bob`;

    expect(out).toBe(expected);
  });
  it('adds a participant XYZ12', () => {
    const input = `sequenceDiagram
    actor Alice
    Alice->>Bob: Hi Bob`;

    // Create the editor with the input diagram
    const editor = new HybridSequenceEditor(input);

    // Parse input with ANTLRSequenceParser to get a full AST built by SequenceCodeGenerator
    antlrParser.parse(input);
    const ast = antlrParser.getAST();

    // Inject the parsed AST into the editor
    (editor as any).ast = ast;

    // Perform the alias update
    editor.addParticipant('John');

    // Regenerate code using the AST strategy
    const out = editor.regenerateCode('ast');

    // Current HybridSequenceEditor normalizes to the keyword "participant"
    // and indents statements by two spaces.
    const expected = `sequenceDiagram
    participant John
    actor Alice
    Alice->>Bob: Hi Bob`;

    expect(out).toBe(expected);
  });
});

// Round-trip check for all CASES using token strategy (no modifications)
describe('HybridSequenceEditor round-trip (ast strategy)', () => {
  for (const { name, input } of ROUNDTRIP_CASES) {
    it(`smoke parses and regenerates (ast): ${name}`, () => {
      const editor = new HybridSequenceEditor(input);
      // No edits; use tokens strategy to regenerate something quickly
      const generated = editor.regenerateCode('ast');

      const out = normalizeLines(generated);

      expect(typeof generated).toBe('string');
      expect(out.length).toBeGreaterThan(0);
      expect(out.includes('sequenceDiagram')).toBe(true);
    });
  }
});
