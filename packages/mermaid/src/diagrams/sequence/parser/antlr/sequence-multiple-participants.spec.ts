import { describe, it, expect } from 'vitest';
import { CharStream, CommonTokenStream } from 'antlr4ng';
import { SequenceLexer } from './generated/SequenceLexer.js';
import { SequenceParser } from './generated/SequenceParser.js';
import { SequenceASTBuilder } from './SequenceASTBuilder.js';

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
    const participantStatements = ast.statements.filter((s) => s.type === 'participant');

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
});
