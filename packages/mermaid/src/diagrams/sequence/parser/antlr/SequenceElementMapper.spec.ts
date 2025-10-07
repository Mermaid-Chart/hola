import { describe, it, expect } from 'vitest';
import { SequenceElementMapper, ElementMappingUtils } from './SequenceElementMapper.js';
import type { SequenceAST, ElementMapping } from './SequenceAST.js';

describe('SequenceElementMapper', () => {
  // Sample AST with element mappings
  const createSampleAST = (): SequenceAST => {
    const mappings: ElementMapping[] = [
      {
        id: 'participant_Alice',
        type: 'participant',
        position: {
          startLine: 2,
          startColumn: 1,
          endLine: 2,
          endColumn: 20,
          startIndex: 17,
          endIndex: 36,
        },
        svgId: 'actor-Alice',
        svgSelector: '[data-et="participant"][data-id="Alice"]',
        data: {
          id: 'Alice',
          label: 'Alice',
          type: 'participant',
        },
      },
      {
        id: 'participant_Bob',
        type: 'participant',
        position: {
          startLine: 3,
          startColumn: 1,
          endLine: 3,
          endColumn: 18,
          startIndex: 37,
          endIndex: 54,
        },
        svgId: 'actor-Bob',
        svgSelector: '[data-et="participant"][data-id="Bob"]',
        data: {
          id: 'Bob',
          label: 'Bob',
          type: 'participant',
        },
      },
      {
        id: 'message_0',
        type: 'message',
        position: {
          startLine: 4,
          startColumn: 1,
          endLine: 4,
          endColumn: 25,
          startIndex: 55,
          endIndex: 79,
        },
        svgId: 'message-0',
        svgSelector: '[data-et="message"][data-id="i0"]',
        data: {
          from: 'Alice',
          to: 'Bob',
          message: 'Hello Bob',
          type: 'solid',
          activate: false,
        },
      },
      {
        id: 'note_0',
        type: 'note',
        position: {
          startLine: 5,
          startColumn: 1,
          endLine: 5,
          endColumn: 30,
          startIndex: 80,
          endIndex: 109,
        },
        svgId: 'note-0',
        svgSelector: '[data-et="note"][data-id="i1"]',
        data: {
          placement: 'right',
          actor: 'Bob',
          text: 'Bob thinks',
        },
      },
    ];

    return {
      header: 'sequenceDiagram',
      statements: [],
      elementMappings: mappings,
    };
  };

  describe('constructor', () => {
    it('should create mapper with element mappings', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      expect(mapper).toBeDefined();
      expect(mapper.getAllMappings()).toHaveLength(4);
    });

    it('should handle AST without element mappings', () => {
      const ast: SequenceAST = {
        header: 'sequenceDiagram',
        statements: [],
      };
      const mapper = new SequenceElementMapper(ast);

      expect(mapper.getAllMappings()).toHaveLength(0);
    });
  });

  describe('getElementAtPosition', () => {
    it('should find element at exact start position', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtPosition(2, 1);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Alice');
    });

    it('should find element at middle position', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtPosition(4, 10);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });

    it('should return undefined for position outside any element', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtPosition(10, 1);
      expect(element).toBeUndefined();
    });

    it('should return undefined for position before first element', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtPosition(1, 1);
      expect(element).toBeUndefined();
    });
  });

  describe('getElementBySvgId', () => {
    it('should find element by SVG ID', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementBySvgId('actor-Alice');
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Alice');
    });

    it('should return undefined for non-existent SVG ID', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementBySvgId('non-existent');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementById', () => {
    it('should find element by ID', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementById('participant_Alice');
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
    });

    it('should return undefined for non-existent ID', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementById('non-existent');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementAtIndex', () => {
    it('should find element at character index', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtIndex(60);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });

    it('should return undefined for index outside any element', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const element = mapper.getElementAtIndex(1000);
      expect(element).toBeUndefined();
    });
  });

  describe('type filtering methods', () => {
    it('should get all participants', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const participants = mapper.getParticipants();
      expect(participants).toHaveLength(2);
      expect(participants[0].type).toBe('participant');
      expect(participants[1].type).toBe('participant');
    });

    it('should get all messages', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const messages = mapper.getMessages();
      expect(messages).toHaveLength(1);
      expect(messages[0].type).toBe('message');
    });

    it('should get all notes', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const notes = mapper.getNotes();
      expect(notes).toHaveLength(1);
      expect(notes[0].type).toBe('note');
    });

    it('should get all control structures', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const structures = mapper.getControlStructures();
      expect(structures).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const ast = createSampleAST();
      const mapper = new SequenceElementMapper(ast);

      const stats = mapper.getStats();
      expect(stats.participants).toBe(2);
      expect(stats.messages).toBe(1);
      expect(stats.notes).toBe(1);
      expect(stats.controlStructures).toBe(0);
      expect(stats.totalElements).toBe(4);
    });

    it('should return zero statistics for empty mapper', () => {
      const ast: SequenceAST = {
        header: 'sequenceDiagram',
        statements: [],
      };
      const mapper = new SequenceElementMapper(ast);

      const stats = mapper.getStats();
      expect(stats.participants).toBe(0);
      expect(stats.messages).toBe(0);
      expect(stats.notes).toBe(0);
      expect(stats.controlStructures).toBe(0);
      expect(stats.totalElements).toBe(0);
    });
  });

  describe('ElementMappingUtils', () => {
    describe('createPosition', () => {
      it('should create position from context with token', () => {
        const mockContext = {
          start: { line: 2, column: 5, start: 10 },
          stop: { line: 2, column: 15, stop: 20 },
        };

        const position = ElementMappingUtils.createPosition(mockContext);
        expect(position).toEqual({
          startLine: 2,
          startColumn: 5,
          endLine: 2,
          endColumn: 15,
          startIndex: 10,
          endIndex: 20,
        });
      });

      it('should return null for context without tokens', () => {
        const mockContext = {};

        const position = ElementMappingUtils.createPosition(mockContext);
        expect(position).toBeNull();
      });
    });

    describe('generateElementId', () => {
      it('should generate ID for participant', () => {
        const id = ElementMappingUtils.generateElementId('participant', 'Alice');
        expect(id).toBe('participant_Alice');
      });

      it('should generate ID for message with index', () => {
        const id = ElementMappingUtils.generateElementId('message', 5);
        expect(id).toBe('message_5');
      });

      it('should generate ID for note with index', () => {
        const id = ElementMappingUtils.generateElementId('note', 3);
        expect(id).toBe('note_3');
      });
    });

    describe('generateSvgSelector', () => {
      it('should generate selector for participant', () => {
        const selector = ElementMappingUtils.generateSvgSelector('participant', 'Alice');
        expect(selector).toBe('[data-et="participant"][data-id="Alice"]');
      });

      it('should generate selector for message', () => {
        const selector = ElementMappingUtils.generateSvgSelector('message', 5);
        expect(selector).toBe('[data-et="message"][data-id="i5"]');
      });

      it('should generate selector for note', () => {
        const selector = ElementMappingUtils.generateSvgSelector('note', 3);
        expect(selector).toBe('[data-et="note"][data-id="i3"]');
      });

      it('should generate selector for control structure', () => {
        const selector = ElementMappingUtils.generateSvgSelector('loop', 2);
        expect(selector).toBe('[data-et="control-structure"][data-id="i2"]');
      });
    });
  });
});
