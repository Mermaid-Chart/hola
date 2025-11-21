import { describe, it, expect } from 'vitest';
import { SequenceASTService } from './SequenceASTService.js';
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

export function stringifySafe<T>(value: T, space = 2): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(
    value,
    (key, val) => {
      if (key === 'sourceTokens') {
        return '[sourceTokens]';
      }

      if (typeof val === 'object' && val !== null) {
        if (seen.has(val)) {
          return '[Circular]';
        }
        seen.add(val);
      }
      return val;
    },
    space
  );
}

// describe('HybridSequenceEditor usage', () => {
//   it('updates participant alias from a simple diagram XYZ12', () => {
//     const input = `sequenceDiagram
//     actor Alice
//     loop Every minute
//       Alice->>Bob: Hi Bob
//     end`;

//     // Create the editor with the input diagram
//     const db = antlrParser.parse(input);
//     const ast = db.getAST();
//     console.info('ast:', ast);

//     const service = new SequenceASTService(ast);

//     // Parse input with ANTLRSequenceParser to get a full AST built by SequenceCodeGenerator

//     // Inject the parsed AST into the editor
//     (service as any).ast = ast;

//     // console.log('Tree:', stringifySafe(tree));
//     console.log('AST:', stringifySafe(ast));

//     // Perform the alias update
//     // editor.updateParticipantAlias('Alice', 'Alicia');

//     // Regenerate code using the AST strategy
//     const out = service.regenerateCode('ast');

//     console.log('Out:', out);

//     // Current HybridSequenceEditor normalizes to the keyword "participant"
//     // and indents statements by two spaces.
//     const expected = `sequenceDiagram\n  participant Alice\n  loop Every minute
//       Alice->>Bob: Hi Bob
//     end`;

//     expect(out).toBe(expected);
//   });
// });
