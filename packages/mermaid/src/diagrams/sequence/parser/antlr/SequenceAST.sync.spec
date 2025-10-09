import { describe, it, expect, beforeEach } from 'vitest';
import { createSequenceParser } from './antlr-parser.js';
import { SequenceCodeGenerator } from './SequenceCodeGenerator.js';
import type { SequenceAST, ElementMapping } from './SequenceAST.js';

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
    const generator = new SequenceCodeGenerator(code);
    const result = generator.generateCode(tree);
    ast = result.ast;
  });

  describe('AST Method Attachment', () => {
    it('should attach getElementAtPosition method', () => {
      expect(ast.getElementAtPosition).toBeDefined();
      expect(typeof ast.getElementAtPosition).toBe('function');
    });

    it('should attach getElementByDataId method', () => {
      expect(ast.getElementByDataId).toBeDefined();
      expect(typeof ast.getElementByDataId).toBe('function');
    });

    it('should attach getElementById method', () => {
      expect(ast.getElementById).toBeDefined();
      expect(typeof ast.getElementById).toBe('function');
    });

    it('should attach getElementAtIndex method', () => {
      expect(ast.getElementAtIndex).toBeDefined();
      expect(typeof ast.getElementAtIndex).toBe('function');
    });

    it('should attach getParticipants method', () => {
      expect(ast.getParticipants).toBeDefined();
      expect(typeof ast.getParticipants).toBe('function');
    });

    it('should attach getMessages method', () => {
      expect(ast.getMessages).toBeDefined();
      expect(typeof ast.getMessages).toBe('function');
    });

    it('should attach getNotes method', () => {
      expect(ast.getNotes).toBeDefined();
      expect(typeof ast.getNotes).toBe('function');
    });

    it('should attach getControlStructures method', () => {
      expect(ast.getControlStructures).toBeDefined();
      expect(typeof ast.getControlStructures).toBe('function');
    });

    it('should attach getStats method', () => {
      expect(ast.getStats).toBeDefined();
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
      const element = ast.getElementAtPosition?.(2, 5);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect('id' in element!.data && element.data.id).toBe('Alice');
    });

    it('should find participant Bob at line 3', () => {
      const element = ast.getElementAtPosition?.(3, 5);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect('id' in element!.data && element.data.id).toBe('Bob');
    });

    it('should find message at line 4', () => {
      const element = ast.getElementAtPosition?.(4, 10);
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
      expect('id' in element!.data && element.data.id).toBe('Alice');
    });

    it('should find participant Bob by data-id', () => {
      const element = ast.getElementByDataId?.('Bob');
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect('id' in element!.data && element.data.id).toBe('Bob');
    });

    it('should find message by data-id with "i" prefix', () => {
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
      const index = firstParticipant.position.startIndex + 5;
      const element = ast.getElementAtIndex?.(index);
      expect(element).toBeDefined();
      expect(element?.id).toBe(firstParticipant.id);
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
      expect(participants!.length).toBe(2);
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
      expect(stats!.participants).toBe(2);
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

  describe('Complex Diagram with Control Structures', () => {
    beforeEach(() => {
      code = `sequenceDiagram
    participant Alice
    participant Bob
    loop Every minute
        Alice->>Bob: Status check
    end
    alt Success
        Bob-->>Alice: OK
    else Failure
        Bob-->>Alice: Error
    end`;

      const { parser } = createSequenceParser(code);
      const tree = parser.start();
      const generator = new SequenceCodeGenerator(code);
      const result = generator.generateCode(tree);
      ast = result.ast;
    });

    it('should find control structures', () => {
      const structures = ast.getControlStructures?.();
      expect(structures).toBeDefined();
      expect(structures!.length).toBeGreaterThan(0);
    });

    it('should include control structures in stats', () => {
      const stats = ast.getStats?.();
      expect(stats).toBeDefined();
      expect(stats!.controlStructures).toBeGreaterThan(0);
    });

    it('should find elements inside control structures', () => {
      // Find message inside loop
      const element = ast.getElementAtPosition?.(5, 10);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });
  });

  describe('Element Position Accuracy', () => {
    it('should have valid position data for all elements', () => {
      const mappings = ast.elementMappings;
      expect(mappings).toBeDefined();

      mappings!.forEach((mapping) => {
        expect(mapping.position.startLine).toBeGreaterThan(0);
        expect(mapping.position.startColumn).toBeGreaterThan(0);
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
});
