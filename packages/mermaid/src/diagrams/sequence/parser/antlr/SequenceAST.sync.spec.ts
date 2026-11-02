import { describe, it, expect, beforeEach } from 'vitest';
import { createSequenceParser } from './antlr-parser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import type { SequenceAST, MessageData } from '../../types.ts';

describe('SequenceAST Bidirectional Synchronization', () => {
  let ast: SequenceAST;
  let code: string;

  beforeEach(() => {
    // Sample sequence diagram
    code = `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello Bob
    Note right of Bob: Bob thinks
    Bob-->>Alice: Hi Alice`;

    // Parse and generate AST
    const { parser } = createSequenceParser(code);
    const tree = parser.start();
    const builder = new SequenceASTBuilder(code);
    const result = builder.generateAST(tree);
    ast = result.ast;
  });

  describe('AST Method Attachment', () => {
    it('should attach getElementAtPosition method', () => {
      expect(ast).toHaveProperty('getElementAtPosition');
      expect(typeof ast.getElementAtPosition).toBe('function');
    });

    it('should attach getElementByDataId method', () => {
      expect(ast).toHaveProperty('getElementByDataId');
      expect(typeof ast.getElementByDataId).toBe('function');
    });

    it('should attach getElementById method', () => {
      expect(ast).toHaveProperty('getElementById');
      expect(typeof ast.getElementById).toBe('function');
    });

    it('should attach getElementAtIndex method', () => {
      expect(ast).toHaveProperty('getElementAtIndex');
      expect(typeof ast.getElementAtIndex).toBe('function');
    });

    it('should attach getParticipants method', () => {
      expect(ast).toHaveProperty('getParticipants');
      expect(typeof ast.getParticipants).toBe('function');
    });

    it('should attach getMessages method', () => {
      expect(ast).toHaveProperty('getMessages');
      expect(typeof ast.getMessages).toBe('function');
    });

    it('should attach getNotes method', () => {
      expect(ast).toHaveProperty('getNotes');
      expect(typeof ast.getNotes).toBe('function');
    });

    it('should attach getControlStructures method', () => {
      expect(ast).toHaveProperty('getControlStructures');
      expect(typeof ast.getControlStructures).toBe('function');
    });

    it('should attach getStats method', () => {
      expect(ast).toHaveProperty('getStats');
      expect(typeof ast.getStats).toBe('function');
    });

    it('should have elementMappings array', () => {
      expect(ast.elementMappings).toBeDefined();
      expect(Array.isArray(ast.elementMappings)).toBe(true);
      expect(ast.elementMappings!.length).toBeGreaterThan(0);
    });
  });

  describe('getElementAtPosition', () => {
    it('should find participant Alice at line 2', () => {
      const element = ast.getElementAtPosition?.(2, 20); // Position on "Alice" in "participant Alice"
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      if (element && 'id' in element.data) {
        expect(element.data.id).toBe('Alice');
      }
    });

    it('should find participant Bob at line 3', () => {
      const element = ast.getElementAtPosition?.(3, 18); // Position on "Bob" in "participant Bob"
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      if (element && 'id' in element.data) {
        expect(element.data.id).toBe('Bob');
      }
    });

    it('should find message text at line 4', () => {
      const element = ast.getElementAtPosition?.(4, 25); // Position on "Hello Bob" message text
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });

    it('should find note at line 5', () => {
      const element = ast.getElementAtPosition?.(5, 10);
      expect(element).toBeDefined();
      expect(element?.type).toBe('note');
    });

    it('should return undefined for position outside any element', () => {
      const element = ast.getElementAtPosition?.(100, 1);
      expect(element).toBeUndefined();
    });

    it('should return undefined for position before first element', () => {
      const element = ast.getElementAtPosition?.(1, 1);
      expect(element).toBeUndefined();
    });
  });

  describe('getElementByDataId', () => {
    it('should find participant by data-id', () => {
      const element = ast.getElementByDataId?.('Alice');
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      if (element && 'id' in element.data) {
        expect(element.data.id).toBe('Alice');
      }
    });

    it('should find participant Bob by data-id', () => {
      const element = ast.getElementByDataId?.('Bob');
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      if (element && 'id' in element.data) {
        expect(element.data.id).toBe('Bob');
      }
    });

    it('should find message by data-id with "i" prefix', () => {
      // The test diagram has (DB message array indices):
      // - Alice->>Bob message (index 0) → i0
      // - Note (index 1) → i1
      // - Bob-->>Alice message (index 2) → i2
      // Note: Participants are NOT in the DB messages array
      const element = ast.getElementByDataId?.('i0');
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });

    it('should find note by data-id with "i" prefix', () => {
      const element = ast.getElementByDataId?.('i1');
      expect(element).toBeDefined();
      expect(element?.type).toBe('note');
    });

    it('should return undefined for non-existent data-id', () => {
      const element = ast.getElementByDataId?.('NonExistent');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementById', () => {
    it('should find element by generated ID', () => {
      const participants = ast.getParticipants?.();
      expect(participants).toBeDefined();
      expect(participants!.length).toBeGreaterThan(0);

      const firstParticipant = participants![0];
      const element = ast.getElementById?.(firstParticipant.id);
      expect(element).toBeDefined();
      expect(element?.id).toBe(firstParticipant.id);
    });

    it('should return undefined for non-existent ID', () => {
      const element = ast.getElementById?.('non-existent-id');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementAtIndex', () => {
    it('should find element at character index', () => {
      // Find an element and test its index
      const participants = ast.getParticipants?.();
      expect(participants).toBeDefined();
      expect(participants!.length).toBeGreaterThan(0);

      const firstParticipant = participants![0];
      const index = firstParticipant.position.startIndex;
      const element = ast.getElementAtIndex?.(index);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
    });

    it('should return undefined for index outside any element', () => {
      const element = ast.getElementAtIndex?.(999999);
      expect(element).toBeUndefined();
    });
  });

  describe('Type Filtering Methods', () => {
    it('getParticipants should return all participants', () => {
      const participants = ast.getParticipants?.();
      expect(participants).toBeDefined();
      // Participants include both declarations and references in messages
      expect(participants!.length).toBeGreaterThan(0);
      expect(participants!.every((p) => p.type === 'participant')).toBe(true);
    });

    it('getMessages should return all messages', () => {
      const messages = ast.getMessages?.();
      expect(messages).toBeDefined();
      expect(messages!.length).toBeGreaterThan(0);
      expect(messages!.every((m) => m.type === 'message')).toBe(true);
    });

    it('getNotes should return all notes', () => {
      const notes = ast.getNotes?.();
      expect(notes).toBeDefined();
      expect(notes!.length).toBeGreaterThan(0);
      expect(notes!.every((n) => n.type === 'note')).toBe(true);
    });

    it('getControlStructures should return empty array for simple diagram', () => {
      const structures = ast.getControlStructures?.();
      expect(structures).toBeDefined();
      expect(structures!.length).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const stats = ast.getStats?.();
      expect(stats).toBeDefined();
      // Participants include both declarations and references
      expect(stats!.participants).toBeGreaterThan(0);
      expect(stats!.messages).toBeGreaterThan(0);
      expect(stats!.notes).toBeGreaterThan(0);
      expect(stats!.controlStructures).toBe(0);
      expect(stats!.totalElements).toBeGreaterThan(0);
    });

    it('should have totalElements equal to sum of all types', () => {
      const stats = ast.getStats?.();
      expect(stats).toBeDefined();
      const sum = stats!.participants + stats!.messages + stats!.notes + stats!.controlStructures;
      expect(stats!.totalElements).toBe(sum);
    });
  });

  describe('Element Position Accuracy', () => {
    it('should have valid position data for all elements', () => {
      const mappings = ast.elementMappings;
      expect(mappings).toBeDefined();

      mappings!.forEach((mapping) => {
        expect(mapping.position.startLine).toBeGreaterThan(0);
        // startColumn can be 0 for full-line mappings that include leading whitespace
        expect(mapping.position.startColumn).toBeGreaterThanOrEqual(0);
        expect(mapping.position.endLine).toBeGreaterThanOrEqual(mapping.position.startLine);
        expect(mapping.position.startIndex).toBeGreaterThanOrEqual(0);
        expect(mapping.position.endIndex).toBeGreaterThanOrEqual(mapping.position.startIndex);
      });
    });

    it('should have positions that match code content', () => {
      const participants = ast.getParticipants?.();
      expect(participants).toBeDefined();

      participants!.forEach((participant) => {
        const { startLine, startColumn, endLine, endColumn } = participant.position;
        const lines = code.split('\n');
        const line = lines[startLine - 1];

        expect(line).toBeDefined();
        expect(line.length).toBeGreaterThanOrEqual(endColumn);
      });
    });
  });

  describe('SVG Selector Generation', () => {
    it('should have svgSelector for participants', () => {
      const participants = ast.getParticipants?.();
      expect(participants).toBeDefined();

      participants!.forEach((participant) => {
        expect(participant.svgSelector).toBeDefined();
        expect(participant.svgSelector).toContain('data-et="participant"');
      });
    });

    it('should have svgSelector for messages', () => {
      const messages = ast.getMessages?.();
      expect(messages).toBeDefined();

      messages!.forEach((message) => {
        expect(message.svgSelector).toBeDefined();
        expect(message.svgSelector).toContain('data-et="message"');
      });
    });

    it('should have svgSelector for notes', () => {
      const notes = ast.getNotes?.();
      expect(notes).toBeDefined();

      notes!.forEach((note) => {
        expect(note.svgSelector).toBeDefined();
        expect(note.svgSelector).toContain('data-et="note"');
      });
    });
  });

  describe('getElementAtPosition with autonumber', () => {
    it('should correctly find messages and have correct dbIndex when autonumber is present', () => {
      const codeWithAutonumber = `sequenceDiagram
autonumber
actor Alice
actor Bob
Alice->>Bob: Hi Bob
Bob->>Alice: Hi Alice`;

      // Parse and generate AST
      const { parser } = createSequenceParser(codeWithAutonumber);
      const tree = parser.start();
      const builder = new SequenceASTBuilder(codeWithAutonumber);
      const result = builder.generateAST(tree);
      const astWithAutonumber = result.ast;

      // Verify that autonumber statement exists and doesn't have a dbIndex
      const autonumberStmt = astWithAutonumber.statements.find((s) => s.type === 'autonumber');
      expect(autonumberStmt).toBeDefined();
      expect(autonumberStmt?.dbIndex).toBeUndefined();

      // Verify that messages have correct dbIndex values
      // When autonumber is present, the DB adds an entry at index 0, so messages start at index 1
      const messages = astWithAutonumber.statements.filter((s) => s.type === 'message');
      expect(messages.length).toBe(2);
      expect(messages[0].dbIndex).toBe(1); // First message should have dbIndex 1 (not 0)
      expect(messages[1].dbIndex).toBe(2); // Second message should have dbIndex 2 (not 1)

      // Verify element mappings have correct svgSelector values
      const messageMappings = astWithAutonumber.elementMappings?.filter(
        (m) => m.type === 'message'
      );
      expect(messageMappings).toBeDefined();
      expect(messageMappings!.length).toBeGreaterThan(0);

      // Find the full-line message mappings (they have startColumn: 0)
      const fullLineMappings = messageMappings!.filter((m) => m.position.startColumn === 0);
      expect(fullLineMappings.length).toBe(2);

      // First message should have svgSelector with data-id="i1" (not i0)
      const firstMessageMapping = fullLineMappings.find((m) => m.position.startLine === 5);
      expect(firstMessageMapping).toBeDefined();
      expect(firstMessageMapping!.svgSelector).toBe('[data-et="message"][data-id="i1"]');

      // Second message should have svgSelector with data-id="i2" (not i1)
      const secondMessageMapping = fullLineMappings.find((m) => m.position.startLine === 6);
      expect(secondMessageMapping).toBeDefined();
      expect(secondMessageMapping!.svgSelector).toBe('[data-et="message"][data-id="i2"]');

      // Test cursor position on line 5 (Alice->>Bob: Hi Bob)
      const elementAtLine5 = astWithAutonumber.getElementAtPosition?.(5, 5);
      expect(elementAtLine5).toBeDefined();
      expect(elementAtLine5?.type).toBe('message');
      expect(elementAtLine5?.position.startLine).toBe(5);
      expect(elementAtLine5?.svgSelector).toBe('[data-et="message"][data-id="i1"]');
      if (elementAtLine5 && elementAtLine5.type === 'message') {
        const msgData = elementAtLine5.data as MessageData;
        expect(msgData.message).toBe('Hi Bob');
        expect(msgData.from).toBe('Alice');
        expect(msgData.to).toBe('Bob');
      }

      // Test cursor position on line 6 (Bob->>Alice: Hi Alice)
      const elementAtLine6 = astWithAutonumber.getElementAtPosition?.(6, 5);
      expect(elementAtLine6).toBeDefined();
      expect(elementAtLine6?.type).toBe('message');
      expect(elementAtLine6?.position.startLine).toBe(6);
      expect(elementAtLine6?.svgSelector).toBe('[data-et="message"][data-id="i2"]');
      if (elementAtLine6 && elementAtLine6.type === 'message') {
        const msgData = elementAtLine6.data as MessageData;
        expect(msgData.message).toBe('Hi Alice');
        expect(msgData.from).toBe('Bob');
        expect(msgData.to).toBe('Alice');
      }

      // Verify that cursor on line 6 does NOT return the message from line 5
      expect(elementAtLine6?.position.startLine).not.toBe(5);
      if (elementAtLine6 && elementAtLine6.type === 'message') {
        const msgData = elementAtLine6.data as MessageData;
        expect(msgData.message).not.toBe('Hi Bob');
      }
    });
  });
});
