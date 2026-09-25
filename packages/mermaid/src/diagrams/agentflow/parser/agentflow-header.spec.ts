/**
 * Diagram header keyword (issue #159).
 *
 * The agentflow diagram type is selected by either `agentflow-beta` (the
 * documented keyword, which signals that the syntax may still change) or the
 * plain `agentflow` keyword that every diagram written against the 11.15
 * line already starts with. Both headers must parse the same body to the
 * same db state, and headers that merely look similar (`agentflowX`,
 * `flowchart`) must still not be taken for agentflow.
 */

import { AgentFlowDB } from '../agentflowDb.js';
import { setConfig } from '../../../config.js';
import plugin from '../afDetector.js';
import agentflow from './agentflowParser.js';

setConfig({
  securityLevel: 'strict',
});

const parse = (src: string) => {
  const db = new AgentFlowDB();
  agentflow.parser.yy = db;
  db.clear();
  db.setGen('gen-2');
  agentflow.parser.parse(src);
  return db;
};

const body = `
  flow reviewer["Review Agent"]
    changes["Gather changes"]@{ shape: input }
    analyse["Analyse diff"]@{ shape: task }
    lint["run_linter"]@{ shape: tool }
    ok["Clean?"]@{ shape: decision }

    changes --> analyse --> lint --> ok
    ok -- yes --> done["Approve"]
    ok -- no --> fix["Request changes"]
    fix -.- guide["Style guide"]@{ shape: refdoc }
    lint --x failed["Lint failed"]
  end
  reviewer --> audit["Audit log"]
`;

describe('agentflow header keyword', () => {
  describe('detector', () => {
    const { detector } = plugin;

    it.each(['agentflow-beta TB', 'agentflow TB', '  agentflow\n  a --> b', 'agentflow'])(
      'detects %j',
      (text) => {
        expect(detector(text)).toBe(true);
      }
    );

    it.each(['agentflowX TB', 'agentflowchart TB', 'flowchart TB', 'graph TB', 'swimlane-beta TB'])(
      'does not detect %j',
      (text) => {
        expect(detector(text)).toBe(false);
      }
    );
  });

  describe('parser', () => {
    it('parses the same body identically under both headers', () => {
      const beta = parse(`agentflow-beta TB${body}`);
      const plain = parse(`agentflow TB${body}`);

      const betaData = beta.getData();
      expect(betaData.nodes.length).toBeGreaterThan(0);
      expect(betaData.edges.length).toBeGreaterThan(0);

      expect(plain.getData()).toEqual(betaData);
      expect(plain.getElementMappings()).toEqual(beta.getElementMappings());
      expect(plain.getDiagnostics()).toEqual(beta.getDiagnostics());
      expect(plain.getSemanticModel()).toEqual(beta.getSemanticModel());
      expect(plain.getDirection()).toEqual(beta.getDirection());
    });

    it('accepts the plain header with every direction', () => {
      for (const dir of ['TB', 'TD', 'BT', 'LR', 'RL']) {
        const db = parse(`agentflow ${dir}\n  a --> b`);
        expect(db.getDirection()).toBe(parse(`agentflow-beta ${dir}\n  a --> b`).getDirection());
        expect(db.getData().edges).toHaveLength(1);
      }
    });

    it('accepts the plain header without a direction', () => {
      const db = parse(`agentflow
  a --> b`);
      expect(db.getData().nodes).toHaveLength(2);
      expect(db.getData().edges).toHaveLength(1);
    });

    it('accepts the plain header with only a newline after it', () => {
      const db = parse(`agentflow
`);
      expect(db.getData().nodes).toHaveLength(0);
    });

    it('rejects a header that merely starts with agentflow', () => {
      expect(() => parse(`agentflowX TB\n  a --> b`)).toThrow();
    });

    it('rejects a header that merely starts with agentflow-beta', () => {
      // The detector's `\b` lets the plain keyword through here, so the
      // parser is what refuses the trailing `X`: it is not a direction.
      expect(() => parse(`agentflow-betaX TB\n  a --> b`)).toThrow();
    });
  });
});
