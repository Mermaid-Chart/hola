import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';

function parseSequenceDiagram(input: string) {
  const chars = CharStream.fromString(input);
  const lexer = new SequenceLexer(chars);
  const tokens = new CommonTokenStream(lexer);
  const parser = new SequenceParser(tokens);
  const tree = parser.start();
  const generator = new SequenceASTBuilder(input);
  const { ast } = generator.generateAST(tree);
  return ast;
}

describe('Loop statement nesting', () => {
  it('should nest note statements inside loop', () => {
    const input = `sequenceDiagram
    participant Alice
    actor Bob
    Alice->>Bob: Message 1
    Note right of Alice: Note 1
    activate Alice
    loop Loop 1
      Bob->>Alice: Message 2
      Note over Alice,Bob: Shared note
    end
    deactivate Alice`;

    const ast = parseSequenceDiagram(input);

    console.log('\nTop-level statements:');
    ast.statements.forEach((stmt, idx) => {
      console.log(
        `[${idx}] type=${stmt.type}, originalIndex=${stmt.originalIndex}, sourceLine="${stmt.sourceLine?.substring(0, 40)}"`
      );
      if (stmt.type === 'loop' && stmt.data?.statements) {
        console.log('  Loop nested statements:');
        stmt.data.statements.forEach((nested: any, nestedIdx: number) => {
          console.log(
            `  [${idx}.${nestedIdx}] type=${nested.type}, originalIndex=${nested.originalIndex}, sourceLine="${nested.sourceLine?.substring(0, 40)}"`
          );
        });
      }
    });

    // Find the loop statement
    const loopStmt = ast.statements.find((s) => s.type === 'loop');
    expect(loopStmt).toBeDefined();
    expect(loopStmt?.data?.statements).toBeDefined();

    // The loop should contain 2 nested statements: message and note
    console.log(`\nLoop contains ${loopStmt?.data?.statements?.length} statements (expected 2)`);
    expect(loopStmt?.data?.statements).toHaveLength(2);

    // Check the nested statements
    const nestedStatements = loopStmt?.data?.statements || [];
    expect(nestedStatements[0].type).toBe('message');
    expect(nestedStatements[1].type).toBe('note');

    // The note should be nested, not at top level
    const topLevelNotes = ast.statements.filter((s) => s.type === 'note');
    console.log(
      `\nTop-level notes: ${topLevelNotes.length} (expected 1 - only "Note right of Alice")`
    );
    expect(topLevelNotes).toHaveLength(1);
    expect(topLevelNotes[0].sourceLine).toContain('Note right of Alice');
  });

  it('should nest multiple statement types inside loop', () => {
    const input = `sequenceDiagram
    loop Loop 1
      Alice->>Bob: Message 1
      Note left of Alice: Note 1
      activate Alice
      Bob->>Alice: Message 2
      deactivate Alice
    end`;

    const ast = parseSequenceDiagram(input);

    const loopStmt = ast.statements.find((s) => s.type === 'loop');
    expect(loopStmt).toBeDefined();

    const nestedStatements = loopStmt?.data?.statements || [];
    expect(nestedStatements).toHaveLength(5);

    expect(nestedStatements[0].type).toBe('message');
    expect(nestedStatements[1].type).toBe('note');
    expect(nestedStatements[2].type).toBe('activate');
    expect(nestedStatements[3].type).toBe('message');
    expect(nestedStatements[4].type).toBe('deactivate');
  });

  it('should handle nested loops with notes', () => {
    const input = `sequenceDiagram
    loop Outer Loop
      Alice->>Bob: Outer message
      Note over Alice: Outer note
      loop Inner Loop
        Bob->>Alice: Inner message
        Note over Bob: Inner note
      end
    end`;

    const ast = parseSequenceDiagram(input);

    const outerLoop = ast.statements.find((s) => s.type === 'loop');
    expect(outerLoop).toBeDefined();

    const outerNested = outerLoop?.data?.statements || [];
    expect(outerNested).toHaveLength(3); // message, note, inner loop

    expect(outerNested[0].type).toBe('message');
    expect(outerNested[1].type).toBe('note');
    expect(outerNested[2].type).toBe('loop');

    // Check inner loop
    const innerLoop = outerNested[2];
    const innerNested = innerLoop.data?.statements || [];
    expect(innerNested).toHaveLength(2); // message, note

    expect(innerNested[0].type).toBe('message');
    expect(innerNested[1].type).toBe('note');
  });

  it('should match the exact structure from the bug report', () => {
    const input = `sequenceDiagram
    participant Alice
    actor Bob
    Alice->>Bob: Message 1
    Note right of Alice: Note 1
    activate Alice
    loop Loop 1
      Bob->>Alice: Message 2
      Note over Alice,Bob: Shared note
    end
    deactivate Alice`;

    const ast = parseSequenceDiagram(input);

    // Expected structure:
    // [0] type=participant, originalIndex=0
    // [1] type=actor, originalIndex=1
    // [2] type=message, originalIndex=2
    // [3] type=note, originalIndex=3
    // [4] type=activate, originalIndex=4
    // [5] type=loop, originalIndex=7
    //   [5.0] type=message, originalIndex=5 (nested)
    //   [5.1] type=note, originalIndex=6 (nested)
    // [6] type=deactivate, originalIndex=8

    expect(ast.statements).toHaveLength(7);

    expect(ast.statements[0].type).toBe('participant');
    expect(ast.statements[0].originalIndex).toBe(0);

    expect(ast.statements[1].type).toBe('actor');
    expect(ast.statements[1].originalIndex).toBe(1);

    expect(ast.statements[2].type).toBe('message');
    expect(ast.statements[2].originalIndex).toBe(2);

    expect(ast.statements[3].type).toBe('note');
    expect(ast.statements[3].originalIndex).toBe(3);
    expect(ast.statements[3].sourceLine).toContain('Note right of Alice');

    expect(ast.statements[4].type).toBe('activate');
    expect(ast.statements[4].originalIndex).toBe(4);

    expect(ast.statements[5].type).toBe('loop');
    expect(ast.statements[5].originalIndex).toBe(7);

    const loopNested = ast.statements[5].data?.statements || [];
    expect(loopNested).toHaveLength(2);

    expect(loopNested[0].type).toBe('message');
    expect(loopNested[0].originalIndex).toBe(5);
    expect(loopNested[0].sourceLine).toContain('Bob->>Alice: Message 2');

    expect(loopNested[1].type).toBe('note');
    expect(loopNested[1].originalIndex).toBe(6);
    expect(loopNested[1].sourceLine).toContain('Note over Alice,Bob: Shared note');

    expect(ast.statements[6].type).toBe('deactivate');
    expect(ast.statements[6].originalIndex).toBe(8);

    // Verify that "Note over Alice,Bob" is NOT at the top level
    const topLevelNotes = ast.statements.filter((s) => s.type === 'note');
    expect(topLevelNotes).toHaveLength(1);
    expect(topLevelNotes[0].sourceLine).toContain('Note right of Alice');
  });
});
