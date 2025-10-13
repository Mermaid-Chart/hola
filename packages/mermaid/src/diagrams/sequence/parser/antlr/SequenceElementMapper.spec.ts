import { describe, it, expect } from 'vitest';
import { SequenceElementMapper, ElementMappingUtils } from './SequenceElementMapper.js';
import type { SequenceAST, ElementMapping } from '../../types.ts';

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
      it('should create position from line/column info', () => {
        const position = ElementMappingUtils.createPosition(2, 5, 2, 15, 10, 20);
        expect(position).toEqual({
          startLine: 2,
          startColumn: 5,
          endLine: 2,
          endColumn: 15,
          startIndex: 10,
          endIndex: 20,
        });
      });

      it('should create position with different start and end lines', () => {
        const position = ElementMappingUtils.createPosition(2, 5, 4, 10, 10, 50);
        expect(position).toEqual({
          startLine: 2,
          startColumn: 5,
          endLine: 4,
          endColumn: 10,
          startIndex: 10,
          endIndex: 50,
        });
      });
    });

    describe('generateElementId', () => {
      it('should generate ID with type and index', () => {
        const id = ElementMappingUtils.generateElementId('participant', 0);
        expect(id).toMatch(/^participant_0_\d+$/);
      });

      it('should generate ID for message with index', () => {
        const id = ElementMappingUtils.generateElementId('message', 5);
        expect(id).toMatch(/^message_5_\d+$/);
      });

      it('should generate ID for note with index', () => {
        const id = ElementMappingUtils.generateElementId('note', 3);
        expect(id).toMatch(/^note_3_\d+$/);
      });

      it('should generate IDs with timestamp suffix', () => {
        const id = ElementMappingUtils.generateElementId('participant', 0);
        // ID should have format: type_index_timestamp
        const parts = id.split('_');
        expect(parts.length).toBe(3);
        expect(parts[0]).toBe('participant');
        expect(parts[1]).toBe('0');
        expect(parseInt(parts[2])).toBeGreaterThan(0);
      });
    });

    describe('generateSvgId', () => {
      it('should generate SVG ID from element ID', () => {
        const elementId = 'participant_0_123456';
        const svgId = ElementMappingUtils.generateSvgId(elementId);
        expect(svgId).toBe('svg_participant_0_123456');
      });
    });

    describe('positionsOverlap', () => {
      it('should detect overlapping positions', () => {
        const pos1 = ElementMappingUtils.createPosition(1, 0, 2, 10, 0, 30);
        const pos2 = ElementMappingUtils.createPosition(2, 5, 3, 5, 25, 50);
        expect(ElementMappingUtils.positionsOverlap(pos1, pos2)).toBe(true);
      });

      it('should detect non-overlapping positions', () => {
        const pos1 = ElementMappingUtils.createPosition(1, 0, 2, 10, 0, 30);
        const pos2 = ElementMappingUtils.createPosition(3, 0, 4, 10, 40, 60);
        expect(ElementMappingUtils.positionsOverlap(pos1, pos2)).toBe(false);
      });
    });

    describe('mergePositions', () => {
      it('should merge two positions into encompassing range', () => {
        const pos1 = ElementMappingUtils.createPosition(1, 5, 2, 10, 5, 30);
        const pos2 = ElementMappingUtils.createPosition(2, 5, 3, 15, 25, 50);
        const merged = ElementMappingUtils.mergePositions(pos1, pos2);
        expect(merged).toEqual({
          startLine: 1,
          startColumn: 5,
          endLine: 3,
          endColumn: 15,
          startIndex: 5,
          endIndex: 50,
        });
      });
    });
  });
});
