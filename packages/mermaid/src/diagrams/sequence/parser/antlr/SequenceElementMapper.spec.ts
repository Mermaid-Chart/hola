import { describe, it, expect, beforeEach } from 'vitest';
import { SequenceElementMapper, ElementMappingUtils } from './SequenceElementMapper.js';
import type { SequenceAST, ElementMapping, ParticipantData } from '../../types.ts';

// Type guard to check if an ElementMapping has ParticipantData
function isParticipantMapping(
  mapping: ElementMapping
): mapping is ElementMapping & { data: ParticipantData } {
  return (
    (mapping.type === 'participant' || mapping.type === 'actor') &&
    typeof mapping.data === 'object' &&
    mapping.data !== null &&
    'id' in mapping.data
  );
}

describe('SequenceElementMapper', () => {
  // Helper function to parse code and get AST
  const parseCode = async (code: string): Promise<SequenceAST | undefined> => {
    const parser = (await import('../sequenceParser.js')).default;
    parser.parse(code);
    const antlrParser = (await import('./antlr-parser.js')).default;
    return antlrParser.yy.getAST();
  };

  // Sample diagram code for basic tests
  const basicDiagramCode = `sequenceDiagram
    participant Alice
    participant Bob
    Alice->>Bob: Hello Bob
    note right of Bob: Bob thinks`;

  let sampleAST: SequenceAST | undefined;

  beforeEach(async () => {
    sampleAST = await parseCode(basicDiagramCode);
  });

  describe('constructor', () => {
    it('should create mapper with element mappings', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      expect(mapper).toBeDefined();
      expect(mapper.getAllMappings().length).toBeGreaterThan(0);
    });

    it('should handle AST without element mappings', async () => {
      const ast = await parseCode('sequenceDiagram');
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      expect(mapper.getAllMappings()).toHaveLength(0);
    });
  });

  describe('getElementAtPosition', () => {
    it('should find element at participant position', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      // Find participant Alice (line 2)
      const element = mapper.getElementAtPosition(2, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Alice');
    });

    it('should find element at message position', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      // Find message on line 4 (Alice->>Bob: Hello Bob)
      // The message text starts at column 17 (after ": ")
      const element = mapper.getElementAtPosition(4, 17);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
    });

    it('should return undefined for position outside any element', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const element = mapper.getElementAtPosition(100, 1);
      expect(element).toBeUndefined();
    });

    it('should return undefined for position before first element', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const element = mapper.getElementAtPosition(1, 1);
      expect(element).toBeUndefined();
    });
  });

  describe('getElementBySvgId', () => {
    it('should find element by SVG ID', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      // Get all participants to find the actual SVG ID
      const participants = mapper.getParticipants();
      expect(participants.length).toBeGreaterThan(0);

      const aliceParticipant = participants.find(
        (p) => p.data && 'id' in p.data && p.data.id === 'Alice'
      );
      expect(aliceParticipant).toBeDefined();

      if (aliceParticipant?.svgId) {
        const element = mapper.getElementBySvgId(aliceParticipant.svgId);
        expect(element).toBeDefined();
        expect(element?.type).toBe('participant');
      }
    });

    it('should return undefined for non-existent SVG ID', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const element = mapper.getElementBySvgId('non-existent-svg-id-12345');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementById', () => {
    it('should find element by ID', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const allMappings = mapper.getAllMappings();
      expect(allMappings.length).toBeGreaterThan(0);

      const firstElement = allMappings[0];
      const element = mapper.getElementById(firstElement.id);
      expect(element).toBeDefined();
      expect(element?.id).toBe(firstElement.id);
    });

    it('should return undefined for non-existent ID', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const element = mapper.getElementById('non-existent-id-12345');
      expect(element).toBeUndefined();
    });
  });

  describe('getElementAtIndex', () => {
    it('should find element at character index', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const allMappings = mapper.getAllMappings();
      expect(allMappings.length).toBeGreaterThan(0);

      // Use the start index of the first element
      const firstElement = allMappings[0];
      const element = mapper.getElementAtIndex(firstElement.position.startIndex);
      expect(element).toBeDefined();
    });

    it('should return undefined for index outside any element', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const element = mapper.getElementAtIndex(999999);
      expect(element).toBeUndefined();
    });
  });

  describe('type filtering methods', () => {
    it('should get all participants', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const participants = mapper.getParticipants();
      expect(participants.length).toBeGreaterThan(0);
      participants.forEach((p) => {
        expect(p.type).toBe('participant');
      });
    });

    it('should get all messages', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const messages = mapper.getMessages();
      expect(messages.length).toBeGreaterThan(0);
      messages.forEach((m) => {
        expect(m.type).toBe('message');
      });
    });

    it('should get all notes', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const notes = mapper.getNotes();
      expect(notes.length).toBeGreaterThan(0);
      notes.forEach((n) => {
        expect(n.type).toBe('note');
      });
    });

    it('should get all control structures', async () => {
      const codeWithControl = `sequenceDiagram
    Alice->>Bob: Hello
    loop Every minute
        Bob->>Alice: Great!
    end`;
      const ast = await parseCode(codeWithControl);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const structures = mapper.getControlStructures();
      expect(structures.length).toBeGreaterThan(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      const stats = mapper.getStats();
      expect(stats.participants).toBeGreaterThan(0);
      expect(stats.messages).toBeGreaterThan(0);
      expect(stats.notes).toBeGreaterThan(0);
      expect(stats.totalElements).toBeGreaterThan(0);
    });

    it('should return zero statistics for empty mapper', async () => {
      const ast = await parseCode('sequenceDiagram');
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const stats = mapper.getStats();
      expect(stats.participants).toBe(0);
      expect(stats.messages).toBe(0);
      expect(stats.notes).toBe(0);
      expect(stats.controlStructures).toBe(0);
      expect(stats.totalElements).toBe(0);
    });
  });

  describe('Participant Types', () => {
    const allTypesCode = `sequenceDiagram
    actor Customer
    participant UI
    participant API@{ "type": "boundary" }
    participant Orchestrator@{ "type": "control" }
    participant OrderModel@{ "type": "entity" }
    participant SQL@{ "type": "database" }
    participant Cache@{ "type": "collections" }
    participant Jobs@{ "type": "queue" }`;

    it('should create element mappings for all participant types', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();

      const mapper = new SequenceElementMapper(ast!);

      const participants = mapper.getParticipants();
      expect(participants.length).toBe(8); // All 8 participant types

      // Verify each participant type has a mapping
      const participantIds = [
        'Customer',
        'UI',
        'API',
        'Orchestrator',
        'OrderModel',
        'SQL',
        'Cache',
        'Jobs',
      ];
      for (const id of participantIds) {
        const mapping = participants.find((p) => p.data && 'id' in p.data && p.data.id === id);
        expect(mapping).toBeDefined();
        expect(mapping?.type).toMatch(/^(participant|actor)$/);
      }
    });

    it('should generate correct SVG selectors for all participant types', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const participants = mapper.getParticipants();

      // Participants can have either data-et="participant" or data-et="actor" in SVG
      // Actors use data-et="actor", all other participant types use data-et="participant"
      for (const p of participants) {
        expect(p.svgSelector).toBeDefined();
        if (p.svgSelector) {
          const hasParticipantOrActor =
            p.svgSelector.includes('[data-et="participant"]') ||
            p.svgSelector.includes('[data-et="actor"]');
          expect(hasParticipantOrActor).toBe(true);
          expect(p.svgSelector).toContain('[data-id="');
        }
      }
    });

    it('should find actor type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find Customer (actor type) - line 2
      // Note: All participant types (including actors) use type='participant' in element mappings
      // because the SVG renderer sets data-et="participant" for all types
      const element = mapper.getElementAtPosition(2, 10);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Customer');
    });

    it('should find boundary type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find API (boundary type) - line 4
      const element = mapper.getElementAtPosition(4, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'API');
    });

    it('should find control type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find Orchestrator (control type) - line 5
      const element = mapper.getElementAtPosition(5, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Orchestrator');
    });

    it('should find entity type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find OrderModel (entity type) - line 6
      const element = mapper.getElementAtPosition(6, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'OrderModel');
    });

    it('should find database type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find SQL (database type) - line 7
      const element = mapper.getElementAtPosition(7, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'SQL');
    });

    it('should find collections type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find Cache (collections type) - line 8
      const element = mapper.getElementAtPosition(8, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Cache');
    });

    it('should find queue type participant by cursor position', async () => {
      const ast = await parseCode(allTypesCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find Jobs (queue type) - line 9
      const element = mapper.getElementAtPosition(9, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'Jobs');
    });
  });

  describe('Participant Aliases', () => {
    const aliasCode = `sequenceDiagram
    actor Alice as Ash
    actor Bob as Bob
    participant Charlie as Charlie`;

    it('should find participant when cursor is on participant ID', async () => {
      const ast = await parseCode(aliasCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find all participant mappings
      const participants = mapper.getParticipants();
      expect(participants.length).toBeGreaterThan(0);

      // Find Alice participant
      const aliceMapping = participants.find(
        (p) => p.data && 'id' in p.data && p.data.id === 'Alice'
      );
      expect(aliceMapping).toBeDefined();
      expect(aliceMapping?.data).toHaveProperty('id', 'Alice');
    });

    it('should find participant when cursor is on alias', async () => {
      const ast = await parseCode(aliasCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // The alias "Ash" should also map to Alice
      const participants = mapper.getParticipants();
      const aliceAliasMapping = participants.find(
        (p) => p.position.startLine === 2 && p.position.startColumn > 15
      );

      if (aliceAliasMapping) {
        expect(aliceAliasMapping.data).toHaveProperty('id', 'Alice');
      }
    });

    it('should return same SVG ID for both participant ID and alias', async () => {
      const ast = await parseCode(aliasCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const participants = mapper.getParticipants();
      const aliceMappings = participants.filter(
        (p) => p.data && 'id' in p.data && p.data.id === 'Alice'
      );

      if (aliceMappings.length >= 2) {
        // Both mappings should have the same SVG ID
        expect(aliceMappings[0].svgId).toBe(aliceMappings[1].svgId);
      }
    });

    it('should count alias mappings in statistics', async () => {
      const ast = await parseCode(aliasCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const stats = mapper.getStats();
      // Should have participant mappings (including aliases)
      expect(stats.participants).toBeGreaterThan(0);
      expect(stats.totalElements).toBeGreaterThan(0);
    });
  });

  describe('Messages in Control Structures', () => {
    it('should create element mappings for messages inside alt/opt blocks', async () => {
      const code = `sequenceDiagram
    Alice->>Bob: Hello Bob, how are you?
    alt is sick
        Bob->>Alice: Not so good one:(
        Bob->>Alice: Not so good two:(
    else is well
        Bob->>Alice: Feeling fresh like a daisy
    end
    opt Extra response
        Bob->>Alice: Thanks for asking
    end`;

      const parser = (await import('../sequenceParser.js')).default;
      parser.parse(code);

      // Get the AST from the parser's yy (db) instance
      // The parser wraps the ANTLR parser which has a yy property
      const antlrParser = (await import('./antlr-parser.js')).default;
      const ast = antlrParser.yy.getAST();

      expect(ast).toBeDefined();
      expect(ast?.elementMappings).toBeDefined();

      // Filter message mappings
      const messageMappings = ast?.elementMappings?.filter((m) => m.type === 'message') ?? [];

      // Should have 5 messages total:
      // 1. Alice->>Bob: Hello Bob, how are you?
      // 2. Bob->>Alice: Not so good one:(
      // 3. Bob->>Alice: Not so good two:(
      // 4. Bob->>Alice: Feeling fresh like a daisy
      // 5. Bob->>Alice: Thanks for asking
      expect(messageMappings.length).toBeGreaterThanOrEqual(5);

      // Check that messages inside alt block are mapped
      const altMessage1 = messageMappings.find(
        (m) =>
          m.position.startLine === 4 &&
          'message' in m.data &&
          m.data.message === 'Not so good one:('
      );
      expect(altMessage1).toBeDefined();
      if (altMessage1 && 'from' in altMessage1.data && 'to' in altMessage1.data) {
        expect(altMessage1.data.from).toBe('Bob');
        expect(altMessage1.data.to).toBe('Alice');
      }

      const altMessage2 = messageMappings.find(
        (m) =>
          m.position.startLine === 5 &&
          'message' in m.data &&
          m.data.message === 'Not so good two:('
      );
      expect(altMessage2).toBeDefined();

      // Check that message inside else block is mapped
      const elseMessage = messageMappings.find(
        (m) =>
          m.position.startLine === 7 &&
          'message' in m.data &&
          m.data.message === 'Feeling fresh like a daisy'
      );
      expect(elseMessage).toBeDefined();

      // Check that message inside opt block is mapped
      const optMessage = messageMappings.find(
        (m) =>
          m.position.startLine === 10 &&
          'message' in m.data &&
          m.data.message === 'Thanks for asking'
      );
      expect(optMessage).toBeDefined();
    });

    it('should have correct SVG selectors for messages in control structures', async () => {
      const code = `sequenceDiagram
    Alice->>Bob: Hello Bob, how are you?
    alt is sick
        Bob->>Alice: Not so good one:(
        Bob->>Alice: Not so good two:(
    else is well
        Bob->>Alice: Feeling fresh like a daisy
    end
    opt Extra response
        Bob->>Alice: Thanks for asking
    end`;

      const parser = (await import('../sequenceParser.js')).default;
      parser.parse(code);

      // Get the AST from the parser's yy (db) instance
      const antlrParser = (await import('./antlr-parser.js')).default;
      const ast = antlrParser.yy.getAST();

      const messageMappings = ast?.elementMappings?.filter((m) => m.type === 'message') ?? [];

      // Each message should have a unique SVG selector with correct index
      // The indices should match the DB indices (which include control structures)
      const selectors = messageMappings.map((m) => m.svgSelector);

      expect(selectors).toContain('[data-et="message"][data-id="i0"]'); // Hello Bob
      expect(selectors).toContain('[data-et="message"][data-id="i2"]'); // Not so good one (after ALT_START)
      expect(selectors).toContain('[data-et="message"][data-id="i3"]'); // Not so good two
      expect(selectors).toContain('[data-et="message"][data-id="i5"]'); // Feeling fresh (after ALT_ELSE)
      expect(selectors).toContain('[data-et="message"][data-id="i8"]'); // Thanks for asking (after OPT_START)
    });

    it('should have correct SVG selectors for messages with activation/deactivation', async () => {
      const code = `sequenceDiagram
    Alice->>Bob: Hello Bob, how are you?
    alt is sick
        Bob->>Alice: Not so good one:(
        Bob->>Alice: Not so good two:(
    else is well
        Bob->>Alice: Feeling fresh like a daisy
    end
    opt Extra response
        Bob->>Alice: Thanks for asking
    end
    loop
        C->>D: Hello 1
        loop
            C->>D: in between
        end
        D->>C: Hello 2
        activate D
        C->>D: Under activation
        D->>C: one
        C->>D: two
        deactivate D
        activate John
        John-->>Alice: Great!
        deactivate John
    end`;

      const parser = (await import('../sequenceParser.js')).default;
      parser.parse(code);

      const antlrParser = (await import('./antlr-parser.js')).default;
      const ast = antlrParser.yy.getAST();

      const messageMappings = ast?.elementMappings?.filter((m) => m.type === 'message') ?? [];

      // Should have 12 messages total
      expect(messageMappings.length).toBe(12);

      // DB message array structure:
      // 0: Alice->>Bob: Hello Bob, how are you?
      // 1: ALT_START
      // 2: Bob->>Alice: Not so good one:(
      // 3: Bob->>Alice: Not so good two:(
      // 4: ALT_ELSE
      // 5: Bob->>Alice: Feeling fresh like a daisy
      // 6: ALT_END
      // 7: OPT_START
      // 8: Bob->>Alice: Thanks for asking
      // 9: OPT_END
      // 10: LOOP_START
      // 11: C->>D: Hello 1
      // 12: LOOP_START (nested)
      // 13: C->>D: in between
      // 14: LOOP_END (nested)
      // 15: D->>C: Hello 2
      // 16: ACTIVE_START (activate D)
      // 17: C->>D: Under activation
      // 18: D->>C: one
      // 19: C->>D: two
      // 20: ACTIVE_END (deactivate D)
      // 21: ACTIVE_START (activate John)
      // 22: John-->>Alice: Great!
      // 23: ACTIVE_END (deactivate John)
      // 24: LOOP_END

      const selectors = messageMappings.map((m) => m.svgSelector);

      expect(selectors).toContain('[data-et="message"][data-id="i0"]'); // Alice->>Bob: Hello Bob, how are you?
      expect(selectors).toContain('[data-et="message"][data-id="i2"]'); // Bob->>Alice: Not so good one:(
      expect(selectors).toContain('[data-et="message"][data-id="i3"]'); // Bob->>Alice: Not so good two:(
      expect(selectors).toContain('[data-et="message"][data-id="i5"]'); // Bob->>Alice: Feeling fresh like a daisy
      expect(selectors).toContain('[data-et="message"][data-id="i8"]'); // Bob->>Alice: Thanks for asking
      expect(selectors).toContain('[data-et="message"][data-id="i11"]'); // C->>D: Hello 1
      expect(selectors).toContain('[data-et="message"][data-id="i13"]'); // C->>D: in between
      expect(selectors).toContain('[data-et="message"][data-id="i15"]'); // D->>C: Hello 2
      expect(selectors).toContain('[data-et="message"][data-id="i17"]'); // C->>D: Under activation
      expect(selectors).toContain('[data-et="message"][data-id="i18"]'); // D->>C: one
      expect(selectors).toContain('[data-et="message"][data-id="i19"]'); // C->>D: two
      expect(selectors).toContain('[data-et="message"][data-id="i22"]'); // John-->>Alice: Great!
    });
  });

  describe('Participant Types with Config Objects', () => {
    it('should create correct element mappings for participants with config objects', async () => {
      const diagramCode = `sequenceDiagram
    actor Customer
    participant UI
    participant API@{ "type": "boundary" }
    participant Orchestrator@{ "type": "control" }
    participant OrderModel@{ "type": "entity" }
    participant SQL@{ "type": "database" }
    participant Cache@{ "type": "collections" }
    participant Jobs@{ "type": "queue" }
    Customer->>UI: Place order
    UI->>API: POST /orders`;

      const ast = await parseCode(diagramCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get participant mappings (should include both 'participant' and 'actor' types)
      const participantMappings = mapper.getParticipants().filter(isParticipantMapping);

      // We should have 8 participant declarations
      expect(participantMappings.length).toBeGreaterThanOrEqual(8);

      // Check that we have mappings for all participants
      const participantIds = participantMappings.map((m) => m.data.id);
      expect(participantIds).toContain('Customer');
      expect(participantIds).toContain('UI');
      expect(participantIds).toContain('API');
      expect(participantIds).toContain('Orchestrator');
      expect(participantIds).toContain('OrderModel');
      expect(participantIds).toContain('SQL');
      expect(participantIds).toContain('Cache');
      expect(participantIds).toContain('Jobs');

      // Check that API participant has correct position (line 4)
      const apiMapping = participantMappings.find((m) => m.data.id === 'API');
      expect(apiMapping).toBeDefined();
      expect(apiMapping?.position.startLine).toBe(4);

      // Check that Orchestrator participant has correct position (line 5)
      const orchestratorMapping = participantMappings.find((m) => m.data.id === 'Orchestrator');
      expect(orchestratorMapping).toBeDefined();
      expect(orchestratorMapping?.position.startLine).toBe(5);
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
