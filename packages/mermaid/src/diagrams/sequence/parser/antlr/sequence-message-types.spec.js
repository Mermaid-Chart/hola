import { describe, it, expect, beforeAll } from 'vitest';
import { Diagram } from '../../../../Diagram.js';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';

/**
 * Comprehensive test suite for all sequence diagram message types via ANTLR parser
 * Tests all LINETYPE constants to ensure proper parsing and DB storage
 */

beforeAll(() => {
  // Register all diagrams including sequence diagram
  addDiagrams();
});

describe('Sequence ANTLR Parser - Basic Message Types', () => {
  it('should parse SOLID arrow (->>) - LINETYPE.SOLID (0)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice->>Bob: Hello
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[0].type).toBe(0);
  });

  it('should parse DOTTED arrow (-->>) - LINETYPE.DOTTED (1)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-->>Bob: Hello
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.DOTTED);
    expect(messages[0].type).toBe(1);
  });

  it('should parse SOLID_OPEN arrow (->) - LINETYPE.SOLID_OPEN (5)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice->Bob: Hello
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_OPEN);
    expect(messages[0].type).toBe(5);
  });

  it('should parse DOTTED_OPEN arrow (-->) - LINETYPE.DOTTED_OPEN (6)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-->Bob: Hello
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.DOTTED_OPEN);
    expect(messages[0].type).toBe(6);
  });

  it('should parse SOLID_CROSS arrow (-x) - LINETYPE.SOLID_CROSS (3)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-xBob: Terminate
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_CROSS);
    expect(messages[0].type).toBe(3);
  });

  it('should parse DOTTED_CROSS arrow (--x) - LINETYPE.DOTTED_CROSS (4)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--xBob: Terminate
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.DOTTED_CROSS);
    expect(messages[0].type).toBe(4);
  });

  it('should parse SOLID_POINT arrow (-)) - LINETYPE.SOLID_POINT (24)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-)Bob: Point
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_POINT);
    expect(messages[0].type).toBe(24);
  });

  it('should parse DOTTED_POINT arrow (--)) - LINETYPE.DOTTED_POINT (25)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--)Bob: Point
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.DOTTED_POINT);
    expect(messages[0].type).toBe(25);
  });
});

describe('Sequence ANTLR Parser - Bidirectional Message Types', () => {
  it('should parse BIDIRECTIONAL_SOLID arrow (<<->>) - LINETYPE.BIDIRECTIONAL_SOLID (33)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice<<->>Bob: Bidirectional
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.BIDIRECTIONAL_SOLID);
    expect(messages[0].type).toBe(33);
  });

  it('should parse BIDIRECTIONAL_DOTTED arrow (<<-->>) - LINETYPE.BIDIRECTIONAL_DOTTED (34)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice<<-->>Bob: Bidirectional dotted
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.BIDIRECTIONAL_DOTTED);
    expect(messages[0].type).toBe(34);
  });
});

describe('Sequence ANTLR Parser - Solid Half-Arrow Types', () => {
  it('should parse SOLID_TOP arrow (-|\\) - LINETYPE.SOLID_TOP (41)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-|\\Bob: Solid top
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_TOP);
    expect(messages[0].type).toBe(41);
  });

  it('should parse SOLID_BOTTOM arrow (-|/) - LINETYPE.SOLID_BOTTOM (42)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-|/Bob: Solid bottom
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_BOTTOM);
    expect(messages[0].type).toBe(42);
  });

  it('should parse SOLID_ARROW_TOP_REVERSE arrow (/|-) - LINETYPE.SOLID_ARROW_TOP_REVERSE (45)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice/|-Bob: Solid top reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_TOP_REVERSE);
    expect(messages[0].type).toBe(45);
  });

  it('should parse SOLID_ARROW_BOTTOM_REVERSE arrow (\\|-) - LINETYPE.SOLID_ARROW_BOTTOM_REVERSE (46)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice\\|-Bob: Solid bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE);
    expect(messages[0].type).toBe(46);
  });
});

describe('Sequence ANTLR Parser - Stick Half-Arrow Types', () => {
  it('should parse STICK_TOP arrow (-\\\\) - LINETYPE.STICK_TOP (43)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-\\\\Bob: Stick top
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_TOP);
    expect(messages[0].type).toBe(43);
  });

  it('should parse STICK_BOTTOM arrow (-//) - LINETYPE.STICK_BOTTOM (44)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-//Bob: Stick bottom
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_BOTTOM);
    expect(messages[0].type).toBe(44);
  });

  it('should parse STICK_ARROW_TOP_REVERSE arrow (//-) - LINETYPE.STICK_ARROW_TOP_REVERSE (47)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice//-Bob: Stick top reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_ARROW_TOP_REVERSE);
    expect(messages[0].type).toBe(47);
  });

  it('should parse STICK_ARROW_BOTTOM_REVERSE arrow (\\\\-) - LINETYPE.STICK_ARROW_BOTTOM_REVERSE (48)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice\\\\-Bob: Stick bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_ARROW_BOTTOM_REVERSE);
    expect(messages[0].type).toBe(48);
  });
});

describe('Sequence ANTLR Parser - Dotted Solid Half-Arrow Types', () => {
  it('should parse SOLID_TOP_DOTTED arrow (--|\\) - LINETYPE.SOLID_TOP_DOTTED (51)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--|\\Bob: Dotted solid top
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_TOP_DOTTED);
    expect(messages[0].type).toBe(51);
  });

  it('should parse SOLID_BOTTOM_DOTTED arrow (--|/) - LINETYPE.SOLID_BOTTOM_DOTTED (52)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--|/Bob: Dotted solid bottom
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_BOTTOM_DOTTED);
    expect(messages[0].type).toBe(52);
  });

  it('should parse SOLID_ARROW_TOP_REVERSE_DOTTED arrow (/|--) - LINETYPE.SOLID_ARROW_TOP_REVERSE_DOTTED (55)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice/|--Bob: Dotted solid top reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_TOP_REVERSE_DOTTED);
    expect(messages[0].type).toBe(55);
  });

  it('should parse SOLID_ARROW_BOTTOM_REVERSE_DOTTED arrow (\\|--) - LINETYPE.SOLID_ARROW_BOTTOM_REVERSE_DOTTED (56)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice\\|--Bob: Dotted solid bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE_DOTTED);
    expect(messages[0].type).toBe(56);
  });
});

describe('Sequence ANTLR Parser - Dotted Stick Half-Arrow Types', () => {
  it('should parse STICK_TOP_DOTTED arrow (--\\\\) - LINETYPE.STICK_TOP_DOTTED (53)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--\\\\Bob: Dotted stick top
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_TOP_DOTTED);
    expect(messages[0].type).toBe(53);
  });

  it('should parse STICK_BOTTOM_DOTTED arrow (--//) - LINETYPE.STICK_BOTTOM_DOTTED (54)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--//Bob: Dotted stick bottom
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_BOTTOM_DOTTED);
    expect(messages[0].type).toBe(54);
  });

  it('should parse STICK_ARROW_TOP_REVERSE_DOTTED arrow (//--) - LINETYPE.STICK_ARROW_TOP_REVERSE_DOTTED (57)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice//--Bob: Dotted stick top reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_ARROW_TOP_REVERSE_DOTTED);
    expect(messages[0].type).toBe(57);
  });

  it('should parse STICK_ARROW_BOTTOM_REVERSE_DOTTED arrow (\\\\--) - LINETYPE.STICK_ARROW_BOTTOM_REVERSE_DOTTED (58)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice\\\\--Bob: Dotted stick bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.STICK_ARROW_BOTTOM_REVERSE_DOTTED);
    expect(messages[0].type).toBe(58);
  });
});

describe('Sequence ANTLR Parser - Central Connection Types', () => {
  it('should parse CENTRAL_CONNECTION (actor ->>() actor) - LINETYPE.CENTRAL_CONNECTION (59)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice ->>() Bob: Message with central connection
    `);
    const messages = diagram.db.getMessages();
    // Should have 2 messages: 1 actual message + 1 central connection marker
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[0].centralConnection).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[1].type).toBe(59);
  });

  it('should parse CENTRAL_CONNECTION_REVERSE (actor ()->> actor) - LINETYPE.CENTRAL_CONNECTION_REVERSE (60)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice ()->> Bob: Message with reverse central connection
    `);
    const messages = diagram.db.getMessages();
    // Should have 2 messages: 1 actual message + 1 reverse central connection marker
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[0].centralConnection).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_REVERSE);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_REVERSE);
    expect(messages[1].type).toBe(60);
  });

  it('should parse CENTRAL_CONNECTION_DUAL (actor ()->>() actor) - LINETYPE.CENTRAL_CONNECTION_DUAL (61)', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice ()->>() Bob: Message with dual central connection
    `);
    const messages = diagram.db.getMessages();
    // Should have 3 messages: 1 actual message + 2 central connection markers
    expect(messages).toHaveLength(3);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[0].centralConnection).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_DUAL);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[2].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_REVERSE);
  });
});

describe('Sequence ANTLR Parser - Combined Message Types', () => {
  it('should parse multiple different message types in one diagram', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice->>Bob: Solid arrow
      Bob-->>Alice: Dotted arrow
      Alice->Bob: Solid open
      Bob-->Alice: Dotted open
      Alice-xBob: Solid cross
      Bob--xAlice: Dotted cross
      Alice-)Bob: Solid point
      Bob--)Alice: Dotted point
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(8);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.DOTTED);
    expect(messages[2].type).toBe(diagram.db.LINETYPE.SOLID_OPEN);
    expect(messages[3].type).toBe(diagram.db.LINETYPE.DOTTED_OPEN);
    expect(messages[4].type).toBe(diagram.db.LINETYPE.SOLID_CROSS);
    expect(messages[5].type).toBe(diagram.db.LINETYPE.DOTTED_CROSS);
    expect(messages[6].type).toBe(diagram.db.LINETYPE.SOLID_POINT);
    expect(messages[7].type).toBe(diagram.db.LINETYPE.DOTTED_POINT);
  });

  it('should parse all half-arrow types in one diagram', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice-|\\Bob: Solid top
      Alice-|/Bob: Solid bottom
      Alice-\\\\Bob: Stick top
      Alice-//Bob: Stick bottom
      Alice/|-Bob: Solid top reverse
      Alice\\|-Bob: Solid bottom reverse
      Alice//-Bob: Stick top reverse
      Alice\\\\-Bob: Stick bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(8);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_TOP);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.SOLID_BOTTOM);
    expect(messages[2].type).toBe(diagram.db.LINETYPE.STICK_TOP);
    expect(messages[3].type).toBe(diagram.db.LINETYPE.STICK_BOTTOM);
    expect(messages[4].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_TOP_REVERSE);
    expect(messages[5].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE);
    expect(messages[6].type).toBe(diagram.db.LINETYPE.STICK_ARROW_TOP_REVERSE);
    expect(messages[7].type).toBe(diagram.db.LINETYPE.STICK_ARROW_BOTTOM_REVERSE);
  });

  it('should parse all dotted half-arrow types in one diagram', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice--|\\Bob: Dotted solid top
      Alice--|/Bob: Dotted solid bottom
      Alice--\\\\Bob: Dotted stick top
      Alice--//Bob: Dotted stick bottom
      Alice/|--Bob: Dotted solid top reverse
      Alice\\|--Bob: Dotted solid bottom reverse
      Alice//--Bob: Dotted stick top reverse
      Alice\\\\--Bob: Dotted stick bottom reverse
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(8);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID_TOP_DOTTED);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.SOLID_BOTTOM_DOTTED);
    expect(messages[2].type).toBe(diagram.db.LINETYPE.STICK_TOP_DOTTED);
    expect(messages[3].type).toBe(diagram.db.LINETYPE.STICK_BOTTOM_DOTTED);
    expect(messages[4].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_TOP_REVERSE_DOTTED);
    expect(messages[5].type).toBe(diagram.db.LINETYPE.SOLID_ARROW_BOTTOM_REVERSE_DOTTED);
    expect(messages[6].type).toBe(diagram.db.LINETYPE.STICK_ARROW_TOP_REVERSE_DOTTED);
    expect(messages[7].type).toBe(diagram.db.LINETYPE.STICK_ARROW_BOTTOM_REVERSE_DOTTED);
  });

  it('should parse central connections with different arrow types', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice ->>() Bob: Solid with central
      Alice -->>() Bob: Dotted with central
      Alice ()-> Bob: Open with reverse central
      Alice ()-->>() Bob: Dotted with dual central
    `);
    const messages = diagram.db.getMessages();
    // 4 actual messages + 5 central connection markers (1+1+1+2)
    expect(messages).toHaveLength(9);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.SOLID);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[2].type).toBe(diagram.db.LINETYPE.DOTTED);
    expect(messages[3].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[4].type).toBe(diagram.db.LINETYPE.SOLID_OPEN);
    expect(messages[5].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_REVERSE);
    expect(messages[6].type).toBe(diagram.db.LINETYPE.DOTTED);
    expect(messages[7].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION);
    expect(messages[8].type).toBe(diagram.db.LINETYPE.CENTRAL_CONNECTION_REVERSE);
  });

  it('should parse bidirectional arrows', async () => {
    const diagram = await Diagram.fromText(`
      sequenceDiagram
      Alice<<->>Bob: Bidirectional solid
      Alice<<-->>Bob: Bidirectional dotted
    `);
    const messages = diagram.db.getMessages();
    expect(messages).toHaveLength(2);
    expect(messages[0].type).toBe(diagram.db.LINETYPE.BIDIRECTIONAL_SOLID);
    expect(messages[1].type).toBe(diagram.db.LINETYPE.BIDIRECTIONAL_DOTTED);
  });
});
