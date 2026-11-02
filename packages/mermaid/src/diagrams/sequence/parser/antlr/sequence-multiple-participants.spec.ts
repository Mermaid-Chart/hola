import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';
import type { ParticipantData, SequenceStatement } from '../../types.js';

// Type guard function to check if a statement is a participant statement
function isParticipantStatement(
  stmt: SequenceStatement
): stmt is SequenceStatement & { data: ParticipantData } {
  return (
    (stmt.type === 'participant' || stmt.type === 'actor') &&
    typeof stmt.data === 'object' &&
    stmt.data !== null &&
    'id' in stmt.data
  );
}

describe('Multiple participant declarations', () => {
  it('should parse all 7 participant declarations with type metadata', () => {
    const input = `sequenceDiagram
    participant Alice
    participant API@{ "type": "boundary" }
    participant Orchestrator@{ "type": "control" }
    participant OrderModel@{ "type": "entity" }
    participant SQL@{ "type": "database" }
    participant Cache@{ "type": "collections" }
    participant Jobs@{ "type": "queue" }

    Alice-//Bob: 21`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines and messages for this test
    const participantStatements = ast.statements.filter(isParticipantStatement);

    // Check that we have exactly 7 participant statements
    expect(participantStatements).toHaveLength(7);

    // Verify each participant has the correct ID
    const participantIds = participantStatements.map((s) => s.data.id);
    expect(participantIds).toEqual([
      'Alice',
      'API',
      'Orchestrator',
      'OrderModel',
      'SQL',
      'Cache',
      'Jobs',
    ]);

    // Verify Alice (without type metadata)
    const aliceStatement = participantStatements[0];
    expect(aliceStatement.data.id).toBe('Alice');
    expect(aliceStatement.data.type).toBeUndefined();
    expect(aliceStatement.sourceLine).toBe('participant Alice');

    // Verify API (with boundary type)
    const apiStatement = participantStatements[1];
    expect(apiStatement.data.id).toBe('API');
    expect(apiStatement.data.type).toBe('boundary');
    expect(apiStatement.sourceLine).toBe('participant API@{ "type": "boundary" }');

    // Verify Orchestrator (with control type)
    const orchestratorStatement = participantStatements[2];
    expect(orchestratorStatement.data.id).toBe('Orchestrator');
    expect(orchestratorStatement.data.type).toBe('control');
    expect(orchestratorStatement.sourceLine).toBe('participant Orchestrator@{ "type": "control" }');

    // Verify OrderModel (with entity type)
    const orderModelStatement = participantStatements[3];
    expect(orderModelStatement.data.id).toBe('OrderModel');
    expect(orderModelStatement.data.type).toBe('entity');
    expect(orderModelStatement.sourceLine).toBe('participant OrderModel@{ "type": "entity" }');

    // Verify SQL (with database type)
    const sqlStatement = participantStatements[4];
    expect(sqlStatement.data.id).toBe('SQL');
    expect(sqlStatement.data.type).toBe('database');
    expect(sqlStatement.sourceLine).toBe('participant SQL@{ "type": "database" }');

    // Verify Cache (with collections type)
    const cacheStatement = participantStatements[5];
    expect(cacheStatement.data.id).toBe('Cache');
    expect(cacheStatement.data.type).toBe('collections');
    expect(cacheStatement.sourceLine).toBe('participant Cache@{ "type": "collections" }');

    // Verify Jobs (with queue type)
    const jobsStatement = participantStatements[6];
    expect(jobsStatement.data.id).toBe('Jobs');
    expect(jobsStatement.data.type).toBe('queue');
    expect(jobsStatement.sourceLine).toBe('participant Jobs@{ "type": "queue" }');
  });

  it('should parse participant with type and alias', () => {
    const input = `sequenceDiagram
    participant API1@{ "type": "boundary" } as First API
    participant API2@{ "type": "boundary" } as Second API
    API1->API2: request`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines and messages for this test
    const participantStatements = ast.statements.filter(isParticipantStatement);

    // Check that we have exactly 2 participant statements
    expect(participantStatements).toHaveLength(2);

    // Verify API1 (with boundary type and alias)
    const api1Statement = participantStatements[0];
    expect(api1Statement.data.id).toBe('API1');
    expect(api1Statement.data.type).toBe('boundary');
    expect(api1Statement.data.alias).toBe('First API');
    expect(api1Statement.sourceLine).toBe('participant API1@{ "type": "boundary" } as First API');

    // Verify API2 (with boundary type and alias)
    const api2Statement = participantStatements[1];
    expect(api2Statement.data.id).toBe('API2');
    expect(api2Statement.data.type).toBe('boundary');
    expect(api2Statement.data.alias).toBe('Second API');
    expect(api2Statement.sourceLine).toBe('participant API2@{ "type": "boundary" } as Second API');
  });

  it('should parse mixed participants with and without aliases', () => {
    const input = `sequenceDiagram
    participant API1@{ "type": "boundary" }
    participant API2@{ "type": "boundary" } as Second
    participant C@{ "type": "control" } as Controller
    participant E@{ "type": "entity" }`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    // Filter out blank lines for this test
    const participantStatements = ast.statements.filter(isParticipantStatement);

    // Check that we have exactly 4 participant statements
    expect(participantStatements).toHaveLength(4);

    // Verify API1 (without alias)
    expect(participantStatements[0].data.id).toBe('API1');
    expect(participantStatements[0].data.type).toBe('boundary');
    expect(participantStatements[0].data.alias).toBeUndefined();

    // Verify API2 (with alias)
    expect(participantStatements[1].data.id).toBe('API2');
    expect(participantStatements[1].data.type).toBe('boundary');
    expect(participantStatements[1].data.alias).toBe('Second');

    // Verify C (with alias)
    expect(participantStatements[2].data.id).toBe('C');
    expect(participantStatements[2].data.type).toBe('control');
    expect(participantStatements[2].data.alias).toBe('Controller');

    // Verify E (without alias)
    expect(participantStatements[3].data.id).toBe('E');
    expect(participantStatements[3].data.type).toBe('entity');
    expect(participantStatements[3].data.alias).toBeUndefined();
  });

  it('should parse all participant types with aliases', () => {
    const input = `sequenceDiagram
    participant B@{ "type": "boundary" } as Boundary Layer
    participant C@{ "type": "control" } as Control Layer
    participant E@{ "type": "entity" } as Entity Model
    participant D@{ "type": "database" } as Database
    participant L@{ "type": "collections" } as Cache Layer
    participant Q@{ "type": "queue" } as Message Queue`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const participantStatements = ast.statements.filter(isParticipantStatement);

    expect(participantStatements).toHaveLength(6);

    // Verify all participants have correct type and alias
    expect(participantStatements[0].data).toMatchObject({
      id: 'B',
      type: 'boundary',
      alias: 'Boundary Layer',
    });
    expect(participantStatements[1].data).toMatchObject({
      id: 'C',
      type: 'control',
      alias: 'Control Layer',
    });
    expect(participantStatements[2].data).toMatchObject({
      id: 'E',
      type: 'entity',
      alias: 'Entity Model',
    });
    expect(participantStatements[3].data).toMatchObject({
      id: 'D',
      type: 'database',
      alias: 'Database',
    });
    expect(participantStatements[4].data).toMatchObject({
      id: 'L',
      type: 'collections',
      alias: 'Cache Layer',
    });
    expect(participantStatements[5].data).toMatchObject({
      id: 'Q',
      type: 'queue',
      alias: 'Message Queue',
    });
  });

  it('should parse participant declared with type then re-declared with alias', () => {
    const input = `sequenceDiagram
    participant API@{ "type": "boundary" }
    participant API as Second`;

    const inputStream = CharStream.fromString(input);
    const lexer = new SequenceLexer(inputStream);
    const tokenStream = new CommonTokenStream(lexer);
    const parser = new SequenceParser(tokenStream);
    const tree = parser.start();

    const generator = new SequenceASTBuilder(input);
    const { ast } = generator.generateAST(tree);

    const participantStatements = ast.statements.filter(isParticipantStatement);

    // Should have 2 participant statements (both for same participant)
    expect(participantStatements).toHaveLength(2);

    // First declaration: with type, no alias
    expect(participantStatements[0].data).toMatchObject({
      id: 'API',
      type: 'boundary',
    });
    expect(participantStatements[0].data.alias).toBeUndefined();

    // Second declaration: no type (should be preserved), with alias
    expect(participantStatements[1].data).toMatchObject({
      id: 'API',
    });
    expect(participantStatements[1].data.alias).toBe('Second');
    expect(participantStatements[1].data.type).toBeUndefined(); // AST doesn't have type on second declaration
  });
});
