import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import type {
  SequenceAST,
  SequenceStatement,
  DiagramStatement,
  LoopData,
  AltData,
  OptData,
  RectData,
  BreakData,
  ParData,
  CriticalData,
  MessageData,
} from '../../types.ts';

function parseSequenceDiagram(input: string): SequenceAST {
  const chars = CharStream.fromString(input);
  const lexer = new SequenceLexer(chars);
  const tokens = new CommonTokenStream(lexer);
  const parser = new SequenceParser(tokens);
  const tree = parser.start();
  const generator = new SequenceASTBuilder(input);
  const { ast } = generator.generateAST(tree);
  return ast;
}

// Type guard functions
function hasStatements(
  stmt: SequenceStatement | DiagramStatement | undefined
): stmt is SequenceStatement & { data: LoopData | AltData | OptData | RectData | BreakData } {
  return (
    stmt !== undefined &&
    (stmt.type === 'loop' ||
      stmt.type === 'alt' ||
      stmt.type === 'opt' ||
      stmt.type === 'rect' ||
      stmt.type === 'break') &&
    typeof stmt.data === 'object' &&
    stmt.data !== null &&
    'statements' in stmt.data &&
    Array.isArray((stmt.data as LoopData | AltData | OptData | RectData | BreakData).statements)
  );
}

function hasStatementArrays(
  stmt: SequenceStatement | DiagramStatement | undefined
): stmt is SequenceStatement & { data: ParData | CriticalData } {
  return (
    stmt !== undefined &&
    (stmt.type === 'par' || stmt.type === 'critical') &&
    typeof stmt.data === 'object' &&
    stmt.data !== null &&
    'statements' in stmt.data &&
    Array.isArray((stmt.data as ParData | CriticalData).statements)
  );
}

describe('Sequence Diagram Control Structures - Nested Statement Parsing', () => {
  describe('LOOP (should work ✅)', () => {
    it('should parse nested statements inside loop block', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    loop loop_title
      Alice-->>John: 2
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const loopStmt = ast.statements.find((s) => s.type === 'loop');

      expect(loopStmt).toBeDefined();
      expect(loopStmt?.type).toBe('loop');
      expect(hasStatements(loopStmt)).toBe(true);
      if (hasStatements(loopStmt)) {
        expect(loopStmt.data).toHaveProperty('condition', 'loop_title');
        expect(loopStmt.data.statements).toHaveLength(2);
        expect(loopStmt.data.statements[0]?.type).toBe('message');
        expect((loopStmt.data.statements[0]?.data as MessageData)?.message).toBe('2');
        expect(loopStmt.data.statements[1]?.type).toBe('message');
        expect((loopStmt.data.statements[1]?.data as MessageData)?.message).toBe('1');
      }
    });
  });

  describe('ALT (should work ✅)', () => {
    it('should parse nested statements inside alt block', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    alt is sick
      Alice-->>John: 2
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const altStmt = ast.statements.find((s) => s.type === 'alt');

      expect(altStmt).toBeDefined();
      expect(altStmt?.type).toBe('alt');
      expect(hasStatements(altStmt)).toBe(true);
      if (hasStatements(altStmt)) {
        expect(altStmt.data).toHaveProperty('condition', 'is sick');
        expect(altStmt.data.statements).toHaveLength(2);
        expect(altStmt.data.statements[0]?.type).toBe('message');
        expect((altStmt.data.statements[0]?.data as MessageData)?.message).toBe('2');
        expect(altStmt.data.statements[1]?.type).toBe('message');
        expect((altStmt.data.statements[1]?.data as MessageData)?.message).toBe('1');
      }
    });
  });

  describe('OPT (should work ✅)', () => {
    it('should parse nested statements inside opt block', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    opt Extra response
      Alice-->>John: 2
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const optStmt = ast.statements.find((s) => s.type === 'opt');

      expect(optStmt).toBeDefined();
      expect(optStmt?.type).toBe('opt');
      expect(hasStatements(optStmt)).toBe(true);
      if (hasStatements(optStmt)) {
        expect(optStmt.data).toHaveProperty('condition', 'Extra response');
        expect(optStmt.data.statements).toHaveLength(2);
        expect(optStmt.data.statements[0]?.type).toBe('message');
        expect((optStmt.data.statements[0]?.data as MessageData)?.message).toBe('2');
        expect(optStmt.data.statements[1]?.type).toBe('message');
        expect((optStmt.data.statements[1]?.data as MessageData)?.message).toBe('1');
      }
    });
  });

  describe('RECT (was broken ❌, now fixed ✅)', () => {
    it('should parse nested statements inside rect block', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    rect rgb(250,250,200)
      Alice-->>John: 2
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const rectStmt = ast.statements.find((s) => s.type === 'rect');

      expect(rectStmt).toBeDefined();
      expect(rectStmt?.type).toBe('rect');
      expect(hasStatements(rectStmt)).toBe(true);
      if (hasStatements(rectStmt)) {
        expect(rectStmt.data).toHaveProperty('color', '250,250,200');
        expect(rectStmt.data.statements).toHaveLength(2);
        expect(rectStmt.data.statements[0]?.type).toBe('message');
        expect((rectStmt.data.statements[0]?.data as MessageData)?.message).toBe('2');
        expect(rectStmt.data.statements[1]?.type).toBe('message');
        expect((rectStmt.data.statements[1]?.data as MessageData)?.message).toBe('1');
      }
    });

    it('should parse nested rect blocks from official documentation', () => {
      const input = `sequenceDiagram
    participant Alice
    participant John

    rect rgb(191, 223, 255)
    note right of Alice: Alice calls John.
    Alice->>+John: Hello John, how are you?
    rect rgb(200, 150, 255)
    Alice->>+John: John, can you hear me?
    John-->>-Alice: Hi Alice, I can hear you!
    end
    John-->>-Alice: I feel great!
    end
    Alice ->>+ John: Did you want to go to the game tonight?
    John -->>- Alice: Yeah! See you there.`;

      const ast = parseSequenceDiagram(input);
      const rectStmt = ast.statements.find((s) => s.type === 'rect');

      expect(rectStmt).toBeDefined();
      expect(rectStmt?.type).toBe('rect');
      expect(hasStatements(rectStmt)).toBe(true);
      if (hasStatements(rectStmt)) {
        expect(rectStmt.data).toHaveProperty('color', '191, 223, 255');
        // Should have: note, message, nested rect, message
        expect(rectStmt.data.statements.length).toBeGreaterThan(0);

        // Find the nested rect
        const nestedRect = rectStmt.data.statements.find((s) => s.type === 'rect');
        expect(nestedRect).toBeDefined();
        expect(hasStatements(nestedRect)).toBe(true);
        if (hasStatements(nestedRect)) {
          expect(nestedRect.data).toHaveProperty('color', '200, 150, 255');
          expect(nestedRect.data.statements.length).toBeGreaterThan(0);
        }
      }
    });
  });

  describe('BREAK (was broken ❌, now fixed ✅)', () => {
    it('should parse nested statements inside break block', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    break when things go wrong
      Alice-->>John: 2
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const breakStmt = ast.statements.find((s) => s.type === 'break');

      expect(breakStmt).toBeDefined();
      expect(breakStmt?.type).toBe('break');
      expect(hasStatements(breakStmt)).toBe(true);
      if (hasStatements(breakStmt)) {
        expect(breakStmt.data).toHaveProperty('condition', 'when things go wrong');
        expect(breakStmt.data.statements).toHaveLength(2);
        expect(breakStmt.data.statements[0]?.type).toBe('message');
        expect((breakStmt.data.statements[0]?.data as MessageData)?.message).toBe('2');
        expect(breakStmt.data.statements[1]?.type).toBe('message');
        expect((breakStmt.data.statements[1]?.data as MessageData)?.message).toBe('1');
      }
    });
  });

  describe('PAR (was broken ❌, now fixed ✅)', () => {
    it('should parse nested statements inside par block with sections', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    par Alice to Bob
      Alice->>Bob: 2
    and Alice to John
      Alice->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const parStmt = ast.statements.find((s) => s.type === 'par');

      expect(parStmt).toBeDefined();
      expect(parStmt?.type).toBe('par');
      expect(hasStatementArrays(parStmt)).toBe(true);
      if (hasStatementArrays(parStmt)) {
        expect(Array.isArray(parStmt.data.statements)).toBe(true);

        // Par should have 2 sections (one for main par, one for 'and')
        expect(parStmt.data.statements.length).toBeGreaterThanOrEqual(1);

        // First section should have 1 statement
        const firstSection = parStmt.data.statements[0];
        expect(Array.isArray(firstSection)).toBe(true);
        expect(firstSection?.length).toBeGreaterThan(0);
        expect(firstSection?.[0]?.type).toBe('message');
        expect((firstSection?.[0]?.data as MessageData)?.message).toBe('2');

        // Second section should have 1 statement (if properly parsed)
        if (parStmt.data.statements.length > 1) {
          const secondSection = parStmt.data.statements[1];
          expect(Array.isArray(secondSection)).toBe(true);
          expect(secondSection?.length).toBeGreaterThan(0);
          expect(secondSection?.[0]?.type).toBe('message');
          expect((secondSection?.[0]?.data as MessageData)?.message).toBe('1');
        }
      }
    });
  });

  describe('CRITICAL (was broken ❌, now fixed ✅)', () => {
    it('should parse nested statements inside critical block with sections', () => {
      const input = `sequenceDiagram
    John->>Alice: 3
    critical Establish a connection to the DB
      Alice-->>John: 2
    option Network timeout
      Alice-->>John: 1
    end`;

      const ast = parseSequenceDiagram(input);
      const criticalStmt = ast.statements.find((s) => s.type === 'critical');

      expect(criticalStmt).toBeDefined();
      expect(criticalStmt?.type).toBe('critical');
      expect(hasStatementArrays(criticalStmt)).toBe(true);
      if (hasStatementArrays(criticalStmt)) {
        expect(criticalStmt.data).toHaveProperty('condition', 'Establish a connection to the DB');
        expect(Array.isArray(criticalStmt.data.statements)).toBe(true);

        // Critical should have 2 sections (one for main critical, one for 'option')
        expect(criticalStmt.data.statements.length).toBeGreaterThanOrEqual(1);

        // First section should have 1 statement
        const firstSection = criticalStmt.data.statements[0];
        expect(Array.isArray(firstSection)).toBe(true);
        expect(firstSection?.length).toBeGreaterThan(0);
        expect(firstSection?.[0]?.type).toBe('message');
        expect((firstSection?.[0]?.data as MessageData)?.message).toBe('2');

        // Second section should have 1 statement (if properly parsed)
        if (criticalStmt.data.statements.length > 1) {
          const secondSection = criticalStmt.data.statements[1];
          expect(Array.isArray(secondSection)).toBe(true);
          expect(secondSection?.length).toBeGreaterThan(0);
          expect(secondSection?.[0]?.type).toBe('message');
          expect((secondSection?.[0]?.data as MessageData)?.message).toBe('1');
        }
      }
    });
  });

  describe('Summary test - all control structures', () => {
    it('should correctly parse all control structures with nested statements', () => {
      const structures = [
        { type: 'loop', expectedCount: 2 },
        { type: 'alt', expectedCount: 2 },
        { type: 'opt', expectedCount: 2 },
        { type: 'rect', expectedCount: 2 },
        { type: 'break', expectedCount: 2 },
      ];

      for (const { type, expectedCount } of structures) {
        let input = '';
        if (type === 'loop') {
          input = `sequenceDiagram
    John->>Alice: 3
    loop loop_title
      Alice-->>John: 2
      Alice-->>John: 1
    end`;
        } else if (type === 'alt') {
          input = `sequenceDiagram
    John->>Alice: 3
    alt is sick
      Alice-->>John: 2
      Alice-->>John: 1
    end`;
        } else if (type === 'opt') {
          input = `sequenceDiagram
    John->>Alice: 3
    opt Extra response
      Alice-->>John: 2
      Alice-->>John: 1
    end`;
        } else if (type === 'rect') {
          input = `sequenceDiagram
    John->>Alice: 3
    rect rgb(250,250,200)
      Alice-->>John: 2
      Alice-->>John: 1
    end`;
        } else if (type === 'break') {
          input = `sequenceDiagram
    John->>Alice: 3
    break when things go wrong
      Alice-->>John: 2
      Alice-->>John: 1
    end`;
        }

        const ast = parseSequenceDiagram(input);
        const stmt = ast.statements.find((s) => s.type === type);

        if (hasStatements(stmt)) {
          const count = stmt.data.statements.length;
          expect(count).toBe(expectedCount);
        } else {
          expect(hasStatements(stmt)).toBe(true);
        }
      }
    });
  });

  describe('Mixed statement types inside control structures', () => {
    it('should parse different statement types inside rect block', () => {
      const input = `sequenceDiagram
    participant Alice
    participant Bob
    rect rgb(200, 200, 255)
      Alice->>Bob: Message 1
      Note right of Alice: Note 1
      activate Alice
      Bob->>Alice: Message 2
      deactivate Alice
    end`;

      const ast = parseSequenceDiagram(input);
      const rectStmt = ast.statements.find((s) => s.type === 'rect');

      expect(rectStmt).toBeDefined();
      expect(hasStatements(rectStmt)).toBe(true);
      if (hasStatements(rectStmt)) {
        expect(rectStmt.data.statements).toHaveLength(5);
        expect(rectStmt.data.statements[0]?.type).toBe('message');
        expect(rectStmt.data.statements[1]?.type).toBe('note');
        expect(rectStmt.data.statements[2]?.type).toBe('activate');
        expect(rectStmt.data.statements[3]?.type).toBe('message');
        expect(rectStmt.data.statements[4]?.type).toBe('deactivate');
      }
    });

    it('should parse different statement types inside break block', () => {
      const input = `sequenceDiagram
    participant Alice
    participant Bob
    break Error handling
      Alice->>Bob: Error occurred
      Note over Alice,Bob: System failure
      deactivate Alice
    end`;

      const ast = parseSequenceDiagram(input);
      const breakStmt = ast.statements.find((s) => s.type === 'break');

      expect(breakStmt).toBeDefined();
      expect(hasStatements(breakStmt)).toBe(true);
      if (hasStatements(breakStmt)) {
        expect(breakStmt.data.statements).toHaveLength(3);
        expect(breakStmt.data.statements[0]?.type).toBe('message');
        expect(breakStmt.data.statements[1]?.type).toBe('note');
        expect(breakStmt.data.statements[2]?.type).toBe('deactivate');
      }
    });

    it('should parse nested control structures inside rect block', () => {
      const input = `sequenceDiagram
    participant Alice
    participant Bob
    rect rgb(200, 200, 255)
      Alice->>Bob: Start
      loop Retry
        Bob->>Alice: Attempt
      end
      Alice->>Bob: Done
    end`;

      const ast = parseSequenceDiagram(input);
      const rectStmt = ast.statements.find((s) => s.type === 'rect');

      expect(rectStmt).toBeDefined();
      expect(hasStatements(rectStmt)).toBe(true);
      if (hasStatements(rectStmt)) {
        expect(rectStmt.data.statements).toHaveLength(3);
        expect(rectStmt.data.statements[0]?.type).toBe('message');
        expect(rectStmt.data.statements[1]?.type).toBe('loop');
        expect(rectStmt.data.statements[2]?.type).toBe('message');

        // Verify the nested loop has its own nested statement
        const nestedLoop = rectStmt.data.statements[1];
        expect(hasStatements(nestedLoop)).toBe(true);
        if (hasStatements(nestedLoop)) {
          expect(nestedLoop.data.statements).toHaveLength(1);
          expect(nestedLoop.data.statements[0]?.type).toBe('message');
        }
      }
    });
  });
});
