import { describe, it, expect, beforeEach } from 'vitest';
import { SequenceElementMapper, ElementMappingUtils } from './SequenceElementMapper.js';
import type { SequenceAST, ElementMapping, ParticipantData, MessageData } from '../../types.ts';

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

    it('should prefer message mapping when cursor is on participant name in message line', () => {
      expect(sampleAST).toBeDefined();
      const mapper = new SequenceElementMapper(sampleAST!);

      // Line 4: "    Alice->>Bob: Hello Bob"
      // When cursor is on "Alice" (column 9), should return message mapping, not participant
      const elementOnAlice = mapper.getElementAtPosition(4, 9);
      expect(elementOnAlice).toBeDefined();
      expect(elementOnAlice?.type).toBe('message');

      // When cursor is on "Bob" (column 17), should return message mapping, not participant
      const elementOnBob = mapper.getElementAtPosition(4, 17);
      expect(elementOnBob).toBeDefined();
      expect(elementOnBob?.type).toBe('message');

      // When cursor is on arrow "->>" (column 14), should return message mapping
      const elementOnArrow = mapper.getElementAtPosition(4, 14);
      expect(elementOnArrow).toBeDefined();
      expect(elementOnArrow?.type).toBe('message');

      // When cursor is on message text "Hello Bob" (column 24), should return message mapping
      const elementOnMessage = mapper.getElementAtPosition(4, 24);
      expect(elementOnMessage).toBeDefined();
      expect(elementOnMessage?.type).toBe('message');
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

      // Should have 24 message mappings total (2 per message: full-line + text-only)
      // There are 12 actual messages in the diagram
      expect(messageMappings.length).toBe(24);

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

  describe('Comprehensive Actor/Participant Syntax Variations', () => {
    const comprehensiveCode = `sequenceDiagram
  %% only Actor
  actor A

  %% Actor with alias
  actor B as Bob

  %% Only Participant
  participant C

  %% Participant with Alias
  participant D as Charlie

  %% New participant type syntax
  participant E@{ "type" : "boundary" }

  %% New participant type syntax with Alias
  participant F@{ "type" : "boundary" } as Flea

  %% new actor with 'create'
  create actor G

  %% new actor with 'create' and alias
  create actor H as Han

  %% new participant with 'create'
  create participant I

  %% new participant with 'create' and alias
  create participant J as Jan

  %% Activate
  activate A

  %% Deactivate
  deactivate A

  %% destroy actor
  destroy G

  %% destroy participant
  destroy I

  A->>B: Message`;

    it('should create element mappings for all participant/actor syntax variations', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get all participant-related mappings
      const participants = mapper.getParticipants();

      // We should have mappings for:
      // - A (actor)
      // - B (actor with alias) - 2 mappings (ID + alias)
      // - C (participant)
      // - D (participant with alias) - 2 mappings (ID + alias)
      // - E (participant with type)
      // - F (participant with type and alias) - 2 mappings (ID + alias)
      // - G (create actor)
      // - H (create actor with alias) - 2 mappings (ID + alias)
      // - I (create participant)
      // - J (create participant with alias) - 2 mappings (ID + alias)
      // Total: 16 mappings (6 simple + 5 with aliases * 2)
      expect(participants.length).toBeGreaterThanOrEqual(10);

      // Verify we have mappings for each participant ID
      const participantIds = participants.filter(isParticipantMapping).map((m) => m.data.id);

      expect(participantIds).toContain('A');
      expect(participantIds).toContain('B');
      expect(participantIds).toContain('C');
      expect(participantIds).toContain('D');
      expect(participantIds).toContain('E');
      expect(participantIds).toContain('F');
      expect(participantIds).toContain('G');
      expect(participantIds).toContain('H');
      expect(participantIds).toContain('I');
      expect(participantIds).toContain('J');
    });

    it('should find actor by cursor position', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find actor A (line 3, column ~8)
      const element = mapper.getElementAtPosition(3, 8);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'A');
    });

    it('should find actor with alias by cursor on ID', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find actor B (line 6, column ~8)
      const element = mapper.getElementAtPosition(6, 8);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'B');
    });

    it('should find actor with alias by cursor on alias', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find actor B by alias "Bob" (line 6, column ~13)
      const element = mapper.getElementAtPosition(6, 13);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'B');
      expect(element?.data).toHaveProperty('alias', 'Bob');
    });

    it('should find participant by cursor position', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find participant C (line 9, column ~15)
      const element = mapper.getElementAtPosition(9, 15);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'C');
    });

    it('should find participant with alias by cursor on alias', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find participant D by alias "Charlie" (line 12, column ~18)
      const element = mapper.getElementAtPosition(12, 18);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'D');
      expect(element?.data).toHaveProperty('alias', 'Charlie');
    });

    it('should find participant with type config by cursor position', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find participant E with type config (line 15, column ~15)
      const element = mapper.getElementAtPosition(15, 15);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'E');
    });

    it('should find participant with type config and alias by cursor on alias', async () => {
      const ast = await parseCode(comprehensiveCode);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Find participant F by alias "Flea" (line 18, column 45 - middle of "Flea")
      const element = mapper.getElementAtPosition(18, 45);
      expect(element).toBeDefined();
      expect(element?.type).toBe('participant');
      expect(element?.data).toHaveProperty('id', 'F');
      expect(element?.data).toHaveProperty('alias', 'Flea');
    });
  });

  describe('Full-Line Mapping for Messages', () => {
    it('should create full-line mapping for message statement (from column 0 to end of line)', async () => {
      const code = `sequenceDiagram
  A->>B: Hello
  B->>A: Hi`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Find the full-line mapping for the first message (line 2)
      const messageMappings = ast!.elementMappings?.filter(
        (m) => m.type === 'message' && m.position.startLine === 2 && m.position.startColumn === 0
      );

      // Should have at least one full-line mapping starting at column 0
      expect(messageMappings!.length).toBeGreaterThan(0);

      // The full-line mapping should cover the entire line
      const fullLineMapping = messageMappings![0];
      expect(fullLineMapping.position.startColumn).toBe(0); // Start of line
      expect(fullLineMapping.position.endLine).toBe(2);
      expect(fullLineMapping.position.startLine).toBe(2);
    });

    it('should create full-line mapping for message with leading spaces', async () => {
      const code = `sequenceDiagram
    A->>B: Hello with leading spaces`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Find the full-line mapping for the message (line 2)
      const messageMappings = ast!.elementMappings?.filter(
        (m) => m.type === 'message' && m.position.startLine === 2 && m.position.startColumn === 0
      );

      // Should have at least one full-line mapping starting at column 0
      expect(messageMappings!.length).toBeGreaterThan(0);

      // The full-line mapping should start at column 0 (covering leading spaces)
      const fullLineMapping = messageMappings![0];
      expect(fullLineMapping.position.startColumn).toBe(0);
      expect(fullLineMapping.position.endColumn).toBe(36); // Length of "    A->>B: Hello with leading spaces"
    });

    it('should highlight message when cursor is at any position on the line', async () => {
      const code = `sequenceDiagram
  A->>B: Test message`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      if (!ast?.getElementAtPosition) {
        return; // Type guard for TypeScript
      }

      const line = 2;
      // Test cursor at various positions on the line
      const positions = [0, 1, 2, 5, 8, 10, 15, 21]; // Various positions including start, middle, end

      for (const column of positions) {
        const element = ast.getElementAtPosition(line, column);
        expect(element).toBeDefined();
        expect(element!.type).toBe('message');
        expect(element!.position.startLine).toBe(line);
      }
    });
  });

  describe('Full-Line Mapping for Participants with Aliases', () => {
    it('should create only ONE full-line mapping for participant with alias (not separate ID and alias mappings)', async () => {
      const code = `sequenceDiagram
  actor B as Bob
  B->>B: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Find all mappings for participant B on line 2 (the declaration line)
      const participantMappings = ast!.elementMappings?.filter(
        (m) =>
          m.type === 'participant' &&
          'id' in m.data &&
          m.data.id === 'B' &&
          m.position.startLine === 2
      );

      // Should have exactly ONE mapping for the participant declaration on line 2
      expect(participantMappings).toHaveLength(1);

      // The mapping should cover the full line
      const mapping = participantMappings![0];
      expect(mapping.position.startColumn).toBe(0); // Start of line
      expect(mapping.position.endColumn).toBe(16); // End of line "  actor B as Bob"
      expect(mapping.position.startLine).toBe(2);
      expect(mapping.position.endLine).toBe(2);

      // The mapping should have the alias in the data
      expect(mapping.data).toHaveProperty('alias', 'Bob');
    });

    it('should create only ONE full-line mapping for participant with type config and alias', async () => {
      const code = `sequenceDiagram
  participant F@{ "type" : "boundary" } as Flea
  F->>F: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Find all mappings for participant F on line 2 (the declaration line)
      const participantMappings = ast!.elementMappings?.filter(
        (m) =>
          m.type === 'participant' &&
          'id' in m.data &&
          m.data.id === 'F' &&
          m.position.startLine === 2
      );

      // Should have exactly ONE mapping for the participant declaration on line 2
      expect(participantMappings).toHaveLength(1);

      // The mapping should cover the full line
      const mapping = participantMappings![0];
      expect(mapping.position.startColumn).toBe(0); // Start of line
      expect(mapping.position.startLine).toBe(2);
      expect(mapping.position.endLine).toBe(2);

      // The mapping should have the alias in the data
      expect(mapping.data).toHaveProperty('alias', 'Flea');
      expect(mapping.data).toHaveProperty('type', 'boundary');
    });

    it('should create only ONE full-line mapping for create participant with alias', async () => {
      const code = `sequenceDiagram
  create participant J as Jan
  J->>J: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Find all mappings for participant J on line 2 (the declaration line)
      const participantMappings = ast!.elementMappings?.filter(
        (m) =>
          m.type === 'participant' &&
          'id' in m.data &&
          m.data.id === 'J' &&
          m.position.startLine === 2
      );

      // Should have exactly ONE mapping for the participant declaration on line 2
      expect(participantMappings).toHaveLength(1);

      // The mapping should cover the full line
      const mapping = participantMappings![0];
      expect(mapping.position.startColumn).toBe(0); // Start of line
      expect(mapping.position.startLine).toBe(2);
      expect(mapping.position.endLine).toBe(2);

      // The mapping should have the alias in the data
      expect(mapping.data).toHaveProperty('alias', 'Jan');
    });
  });

  describe('Cursor Position Anywhere on Actor/Participant Line', () => {
    it('should find actor B when cursor is anywhere on the line "actor B as Bob"', async () => {
      const code = `sequenceDiagram
  actor B as Bob
  B->>B: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: "  actor B as Bob"
      // Test various cursor positions on this line
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "a" in "actor"' },
        { col: 5, desc: 'at "r" in "actor"' },
        { col: 7, desc: 'space after "actor"' },
        { col: 8, desc: 'at "B"' },
        { col: 9, desc: 'space before "as"' },
        { col: 10, desc: 'at "a" in "as"' },
        { col: 12, desc: 'space after "as"' },
        { col: 13, desc: 'at "B" in "Bob"' },
        { col: 15, desc: 'at "b" in "Bob"' },
        { col: 16, desc: 'end of "Bob"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'B');
      }
    });

    it('should find participant D when cursor is anywhere on the line "participant D as Charlie"', async () => {
      const code = `sequenceDiagram
  participant D as Charlie
  D->>D: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: "  participant D as Charlie"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "p" in "participant"' },
        { col: 10, desc: 'at "p" in "participant"' },
        { col: 13, desc: 'space after "participant"' },
        { col: 14, desc: 'at "D"' },
        { col: 15, desc: 'space before "as"' },
        { col: 18, desc: 'space after "as"' },
        { col: 19, desc: 'at "C" in "Charlie"' },
        { col: 25, desc: 'at "e" in "Charlie"' },
        { col: 26, desc: 'end of "Charlie"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'D');
      }
    });

    it('should find participant E when cursor is anywhere on the line with type config', async () => {
      const code = `sequenceDiagram
  participant E@{ "type" : "boundary" }
  E->>E: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: '  participant E@{ "type" : "boundary" }'
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "p" in "participant"' },
        { col: 13, desc: 'space after "participant"' },
        { col: 14, desc: 'at "E"' },
        { col: 15, desc: 'at "@"' },
        { col: 20, desc: 'inside type config' },
        { col: 30, desc: 'at "boundary"' },
        { col: 38, desc: 'at closing brace' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'E');
      }
    });

    it('should find participant F when cursor is anywhere on the line with type config and alias', async () => {
      const code = `sequenceDiagram
  participant F@{ "type" : "boundary" } as Flea
  F->>F: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: '  participant F@{ "type" : "boundary" } as Flea'
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "p" in "participant"' },
        { col: 13, desc: 'space after "participant"' },
        { col: 14, desc: 'at "F"' },
        { col: 15, desc: 'at "@"' },
        { col: 20, desc: 'inside type config' },
        { col: 38, desc: 'at closing brace' },
        { col: 40, desc: 'at "a" in "as"' },
        { col: 43, desc: 'at "F" in "Flea"' },
        { col: 46, desc: 'at "a" in "Flea"' },
        { col: 47, desc: 'end of "Flea"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'F');
      }
    });

    it('should find participant G when cursor is anywhere on the line "create actor G"', async () => {
      const code = `sequenceDiagram
  create actor G
  G->>G: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: "  create actor G"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "c" in "create"' },
        { col: 7, desc: 'at "e" in "create"' },
        { col: 9, desc: 'space after "create"' },
        { col: 10, desc: 'at "a" in "actor"' },
        { col: 14, desc: 'at "r" in "actor"' },
        { col: 15, desc: 'space before "G"' },
        { col: 16, desc: 'at "G"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'G');
      }
    });

    it('should find participant H when cursor is anywhere on the line "create actor H as Han"', async () => {
      const code = `sequenceDiagram
  create actor H as Han
  H->>H: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 2: "  create actor H as Han"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "c" in "create"' },
        { col: 9, desc: 'space after "create"' },
        { col: 15, desc: 'space after "actor"' },
        { col: 16, desc: 'at "H"' },
        { col: 17, desc: 'space before "as"' },
        { col: 18, desc: 'at "a" in "as"' },
        { col: 21, desc: 'at "H" in "Han"' },
        { col: 23, desc: 'at "n" in "Han"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(2, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'H');
      }
    });

    it('should find participant A when cursor is anywhere on the line "activate A"', async () => {
      const code = `sequenceDiagram
  actor A
  activate A
  A->>A: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 3: "  activate A"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "a" in "activate"' },
        { col: 9, desc: 'at "e" in "activate"' },
        { col: 10, desc: 'space after "activate"' },
        { col: 11, desc: 'at "A"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(3, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'A');
      }
    });

    it('should find participant A when cursor is anywhere on the line "deactivate A"', async () => {
      const code = `sequenceDiagram
  actor A
  activate A
  deactivate A
  A->>A: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 4: "  deactivate A"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "d" in "deactivate"' },
        { col: 11, desc: 'at "e" in "deactivate"' },
        { col: 12, desc: 'space after "deactivate"' },
        { col: 13, desc: 'at "A"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(4, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'A');
      }
    });

    it('should find participant G when cursor is anywhere on the line "destroy G"', async () => {
      const code = `sequenceDiagram
  create actor G
  destroy G
  G->>G: test`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Line 3: "  destroy G"
      const testPositions = [
        { col: 0, desc: 'start of line (whitespace)' },
        { col: 2, desc: 'at "d" in "destroy"' },
        { col: 8, desc: 'at "y" in "destroy"' },
        { col: 9, desc: 'space after "destroy"' },
        { col: 10, desc: 'at "G"' },
      ];

      for (const { col, desc } of testPositions) {
        const element = mapper.getElementAtPosition(3, col);
        expect(element, `Failed at column ${col} (${desc})`).toBeDefined();
        expect(element?.type, `Wrong type at column ${col} (${desc})`).toBe('participant');
        expect(element?.data, `Wrong data at column ${col} (${desc})`).toHaveProperty('id', 'G');
      }
    });
  });

  describe('Message statements with activation/deactivation markers', () => {
    it('should correctly map messages with activation markers (+) and deactivation markers (-)', async () => {
      const code = `sequenceDiagram

Alice->>+Bob: Hi Bob
A --> B: hello1
Bob->>-Alice: Hi Alice
A --> B: hello2
A --> B: hello3`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get all message mappings (includes full-line mappings)
      // Each message creates 2 mappings: full-line mapping + fine-grained mapping
      const messageMappings = mapper.getAllMappings().filter((m) => m.type === 'message');

      // We should have 10 message mappings (2 per message line: full-line + fine-grained)
      expect(messageMappings.length).toBe(10);

      // Get only the full-line mappings (they start at column 0)
      const fullLineMappings = messageMappings.filter((m) => m.position.startColumn === 0);
      expect(fullLineMappings.length).toBe(5);

      // Check that each full-line message mapping has the correct svgId
      // The svgId should match the DB index, which accounts for activation/deactivation

      // Message 1: "Alice->>+Bob: Hi Bob" (line 3)
      // DB creates 2 entries: message (id=0) + ACTIVE_START (id=1)
      // So the message should have DB index 0
      const msg1 = fullLineMappings.find((m) => m.position.startLine === 3);
      expect(msg1).toBeDefined();
      expect(msg1?.svgId).toContain('message_0'); // svgId contains the DB index

      // Message 2: "A --> B: hello1" (line 4)
      // DB creates 1 entry: message (id=2)
      // So the message should have DB index 2
      const msg2 = fullLineMappings.find((m) => m.position.startLine === 4);
      expect(msg2).toBeDefined();
      expect(msg2?.svgId).toContain('message_2'); // svgId contains the DB index

      // Message 3: "Bob->>-Alice: Hi Alice" (line 5)
      // DB creates 2 entries: message (id=3) + ACTIVE_END (id=4)
      // So the message should have DB index 3
      const msg3 = fullLineMappings.find((m) => m.position.startLine === 5);
      expect(msg3).toBeDefined();
      expect(msg3?.svgId).toContain('message_3'); // svgId contains the DB index

      // Message 4: "A --> B: hello2" (line 6)
      // DB creates 1 entry: message (id=5)
      // So the message should have DB index 5
      const msg4 = fullLineMappings.find((m) => m.position.startLine === 6);
      expect(msg4).toBeDefined();
      expect(msg4?.svgId).toContain('message_5'); // svgId contains the DB index

      // Message 5: "A --> B: hello3" (line 7)
      // DB creates 1 entry: message (id=6)
      // So the message should have DB index 6
      const msg5 = fullLineMappings.find((m) => m.position.startLine === 7);
      expect(msg5).toBeDefined();
      expect(msg5?.svgId).toContain('message_6'); // svgId contains the DB index
    });

    it('should highlight correct SVG element when clicking on message with activation marker', async () => {
      const code = `sequenceDiagram
Alice->>+Bob: Hi Bob
A --> B: hello1`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Click anywhere on line 2 ("Alice->>+Bob: Hi Bob")
      const element = mapper.getElementAtPosition(2, 5);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
      expect(element?.svgId).toContain('message_0'); // Should map to the first message in DB (index 0)
    });
  });

  describe('Messages with empty text', () => {
    it('should create element mappings for message with empty text after colon', async () => {
      const code = `sequenceDiagram
Alice->>John:
Bob->>Alice: Hello`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get all message mappings
      const messageMappings = mapper.getAllMappings().filter((m) => m.type === 'message');

      // Should have 4 message mappings (2 per message: full-line + fine-grained)
      expect(messageMappings.length).toBe(4);

      // Get only the full-line mappings (they start at column 0)
      const fullLineMappings = messageMappings.filter((m) => m.position.startColumn === 0);
      expect(fullLineMappings.length).toBe(2);

      // Check the first message with empty text (line 2)
      const msg1 = fullLineMappings.find((m) => m.position.startLine === 2);
      expect(msg1).toBeDefined();
      expect(msg1?.svgId).toContain('message_0');
      if (msg1 && 'message' in msg1.data) {
        expect(msg1.data.message).toBe('');
      }

      // Check the second message with text (line 3)
      const msg2 = fullLineMappings.find((m) => m.position.startLine === 3);
      expect(msg2).toBeDefined();
      expect(msg2?.svgId).toContain('message_1');
      if (msg2 && 'message' in msg2.data) {
        expect(msg2.data.message).toBe('Hello');
      }
    });

    it('should create element mappings for messages with activation/deactivation and empty text', async () => {
      const code = `sequenceDiagram
Alice->>+John: Hello John
John-->>-Alice:
Bob->>Alice: Hi Alice`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get all message mappings
      const messageMappings = mapper.getAllMappings().filter((m) => m.type === 'message');

      // Should have 6 message mappings (2 per message: full-line + fine-grained)
      expect(messageMappings.length).toBe(6);

      // Get only the full-line mappings (they start at column 0)
      const fullLineMappings = messageMappings.filter((m) => m.position.startColumn === 0);
      expect(fullLineMappings.length).toBe(3);

      // Message 1: "Alice->>+John: Hello John" (line 2)
      // DB creates 2 entries: message (id=0) + ACTIVE_START (id=1)
      const msg1 = fullLineMappings.find((m) => m.position.startLine === 2);
      expect(msg1).toBeDefined();
      expect(msg1?.svgId).toContain('message_0');
      if (msg1 && 'message' in msg1.data) {
        expect(msg1.data.message).toBe('Hello John');
      }

      // Message 2: "John-->>-Alice:" (line 3) - empty text with deactivation
      // DB creates 2 entries: message (id=2) + ACTIVE_END (id=3)
      const msg2 = fullLineMappings.find((m) => m.position.startLine === 3);
      expect(msg2).toBeDefined();
      expect(msg2?.svgId).toContain('message_2');
      if (msg2 && 'message' in msg2.data) {
        expect(msg2.data.message).toBe('');
      }

      // Message 3: "Bob->>Alice: Hi Alice" (line 4)
      // DB creates 1 entry: message (id=4)
      const msg3 = fullLineMappings.find((m) => m.position.startLine === 4);
      expect(msg3).toBeDefined();
      expect(msg3?.svgId).toContain('message_4');
      if (msg3 && 'message' in msg3.data) {
        expect(msg3.data.message).toBe('Hi Alice');
      }
    });

    it('should find message with empty text by cursor position', async () => {
      const code = `sequenceDiagram
Alice->>John:
Bob->>Alice: Hello`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Click on the message with empty text (line 2, anywhere on the line)
      const element = mapper.getElementAtPosition(2, 5);
      expect(element).toBeDefined();
      expect(element?.type).toBe('message');
      if (element && 'message' in element.data) {
        expect(element.data.message).toBe('');
      }
    });

    it('should create correct SVG selectors for messages with empty text', async () => {
      const code = `sequenceDiagram
Alice->>John:
John-->>Alice:`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      const messageMappings = mapper.getAllMappings().filter((m) => m.type === 'message');

      // Each message should have a valid SVG selector
      for (const mapping of messageMappings) {
        expect(mapping.svgSelector).toBeDefined();
        expect(mapping.svgSelector).toContain('[data-et="message"]');
        expect(mapping.svgSelector).toContain('[data-id="i');
      }
    });
  });

  describe('Messages with autonumber statement', () => {
    it('should correctly map messages when autonumber is present at the top', async () => {
      const code = `sequenceDiagram
autonumber
actor Alice
actor Bob
Alice->>Bob: Hi Bob
Bob->>Alice: Hi Alice`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();
      const mapper = new SequenceElementMapper(ast!);

      // Get all message mappings (includes full-line mappings)
      const messageMappings = mapper.getAllMappings().filter((m) => m.type === 'message');

      // Should have 4 message mappings (2 per message: full-line + fine-grained)
      expect(messageMappings.length).toBe(4);

      // Get only the full-line mappings (they start at column 0)
      const fullLineMappings = messageMappings.filter((m) => m.position.startColumn === 0);
      expect(fullLineMappings.length).toBe(2);

      // Message 1: "Alice->>Bob: Hi Bob" (line 5)
      const msg1 = fullLineMappings.find((m) => m.position.startLine === 5);
      expect(msg1).toBeDefined();
      expect(msg1?.position.startLine).toBe(5);
      expect(msg1?.position.endLine).toBe(5);
      if (msg1 && msg1.type === 'message') {
        const msgData = msg1.data as MessageData;
        expect(msgData.message).toBe('Hi Bob');
        expect(msgData.from).toBe('Alice');
        expect(msgData.to).toBe('Bob');
      }

      // Message 2: "Bob->>Alice: Hi Alice" (line 6)
      const msg2 = fullLineMappings.find((m) => m.position.startLine === 6);
      expect(msg2).toBeDefined();
      expect(msg2?.position.startLine).toBe(6);
      expect(msg2?.position.endLine).toBe(6);
      if (msg2 && msg2.type === 'message') {
        const msgData = msg2.data as MessageData;
        expect(msgData.message).toBe('Hi Alice');
        expect(msgData.from).toBe('Bob');
        expect(msgData.to).toBe('Alice');
      }

      // Test cursor position mapping
      // When cursor is on line 6 (Bob->>Alice: Hi Alice), it should find the second message
      const elementAtLine6 = mapper.getElementAtPosition(6, 5);
      expect(elementAtLine6).toBeDefined();
      expect(elementAtLine6?.type).toBe('message');
      expect(elementAtLine6?.position.startLine).toBe(6);
      if (elementAtLine6 && 'message' in elementAtLine6.data) {
        expect(elementAtLine6.data.message).toBe('Hi Alice');
      }

      // When cursor is on line 5 (Alice->>Bob: Hi Bob), it should find the first message
      const elementAtLine5 = mapper.getElementAtPosition(5, 5);
      expect(elementAtLine5).toBeDefined();
      expect(elementAtLine5?.type).toBe('message');
      expect(elementAtLine5?.position.startLine).toBe(5);
      if (elementAtLine5 && 'message' in elementAtLine5.data) {
        expect(elementAtLine5.data.message).toBe('Hi Bob');
      }
    });

    it('should have correct dbIndex for messages when autonumber is present', async () => {
      const code = `sequenceDiagram
autonumber
actor Alice
actor Bob
Alice->>Bob: Hi Bob
Bob->>Alice: Hi Alice`;

      const ast = await parseCode(code);
      expect(ast).toBeDefined();

      // Check the AST statements
      const messages = ast!.statements.filter((s) => s.type === 'message');
      expect(messages.length).toBe(2);

      // When autonumber is present, the DB adds an entry at index 0, so messages start at index 1
      // First message should have dbIndex 1 (not 0)
      expect(messages[0].dbIndex).toBe(1);
      if ('message' in messages[0].data) {
        expect(messages[0].data.message).toBe('Hi Bob');
      }

      // Second message should have dbIndex 2 (not 1)
      expect(messages[1].dbIndex).toBe(2);
      if ('message' in messages[1].data) {
        expect(messages[1].data.message).toBe('Hi Alice');
      }
    });
  });
});
