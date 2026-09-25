import { it, describe, expect } from 'vitest';
import { detectType } from './detectType.js';
import { addDiagrams } from './diagram-orchestration.js';

describe('diagram-orchestration', () => {
  it('should register diagrams', () => {
    expect(() => detectType('graph TD; A-->B')).toThrow();
    addDiagrams();
    expect(detectType('graph TD; A-->B')).toBe('flowchart-v2');
  });

  describe('proper diagram types should be detected', () => {
    beforeAll(() => {
      addDiagrams();
    });

    it.each([
      { text: 'graph TD;', expected: 'flowchart-v2' },
      { text: 'flowchart TD;', expected: 'flowchart-v2' },
      { text: 'flowchart-v2 TD;', expected: 'flowchart-v2' },
      { text: 'flowchart-elk TD;', expected: 'flowchart-elk' },
      { text: 'swimlane-beta TD;', expected: 'swimlane' },
      { text: 'agentflow-beta TD;', expected: 'agentflow' },
      { text: 'agentflow TD;', expected: 'agentflow' },
      { text: 'error', expected: 'error' },
      { text: 'C4Context;', expected: 'c4' },
      { text: 'classDiagram', expected: 'classDiagram' },
      { text: 'classDiagram-v2', expected: 'classDiagram' },
      { text: 'erDiagram', expected: 'er' },
      { text: 'journey', expected: 'journey' },
      { text: 'gantt', expected: 'gantt' },
      { text: 'pie', expected: 'pie' },
      { text: 'requirementDiagram', expected: 'requirement' },
      { text: 'info', expected: 'info' },
      { text: 'sequenceDiagram', expected: 'sequence' },
      { text: 'mindmap', expected: 'mindmap' },
      { text: 'timeline', expected: 'timeline' },
      { text: 'gitGraph', expected: 'gitGraph' },
      { text: 'stateDiagram', expected: 'stateDiagram' },
      { text: 'stateDiagram-v2', expected: 'stateDiagram' },
    ])(
      'should $text be detected as $expected',
      ({ text, expected }: { text: string; expected: string }) => {
        expect(detectType(text)).toBe(expected);
      }
    );

    it('routes both graph and flowchart to the unified flowchart', () => {
      // `graph` and `flowchart` are the same diagram. They used to differ only when a
      // renderer was configured, which is why `graph` had a legacy id of its own.
      expect(detectType('graph TD; A-->B')).toBe('flowchart-v2');
      expect(detectType('flowchart TD; A-->B')).toBe('flowchart-v2');
    });

    it('keeps flowchart-elk as its own explicit keyword', () => {
      // The only remaining way to ask for ELK by diagram type. Everything else asks with
      // `layout: elk`.
      expect(detectType('flowchart-elk TD; A-->B')).toBe('flowchart-elk');
      expect(detectType('swimlane-beta TD; A-->B')).toBe('swimlane');
    });

    it('routes classDiagram and stateDiagram to their unified diagrams', () => {
      expect(detectType('classDiagram')).toBe('classDiagram');
      expect(detectType('classDiagram-v2')).toBe('classDiagram');
      expect(detectType('stateDiagram\n  [*] --> A')).toBe('stateDiagram');
      expect(detectType('stateDiagram-v2\n  [*] --> A')).toBe('stateDiagram');
    });

    it('does not mistake other diagram types for a flowchart', () => {
      // These carried a `flowchart.defaultRenderer` block for years, which did nothing for
      // them except trip a side effect in the flowchart detector.
      expect(detectType('mindmap\n  root\n    Photograph\n      Waterfall')).toBe('mindmap');
      expect(
        detectType(`
          classDiagram
            class Person {
              +String name
              -Int id
            }
          `)
      ).toBe('classDiagram');
      expect(
        detectType(`
          erDiagram
            p[Photograph] {
              varchar(12) jobId
              date dateCreated
            }
          `)
      ).toBe('er');
    });

    it('should not detect flowchart if pie contains flowchart', () => {
      expect(
        detectType(`pie title: "flowchart"
      flowchart: 1 "pie" pie: 2 "pie"`)
      ).toBe('pie');
    });

    it('should detect proper diagram when the flowchart layout is elk', () => {
      expect(
        detectType('mindmap\n  root\n    Photograph\n      Waterfall', {
          flowchart: { layout: 'elk' },
        })
      ).toBe('mindmap');
      expect(
        detectType(
          `
          classDiagram
            class Person {
              +String name
              -Int id
              #double age
              +Text demographicProfile
            }
          `,
          { flowchart: { layout: 'elk' } }
        )
        // The fork's anchored detection answers `classDiagram` here, with or without the
        // elk config. The old `class` expectation came from `flowchart.defaultRenderer`,
        // which upstream removed once ELK became the default layout.
      ).toBe('classDiagram');
      expect(
        detectType(
          `
          erDiagram
            p[Photograph] {
              varchar(12) jobId
              date dateCreated
            }
          `,
          {
            flowchart: { layout: 'elk' },
          }
        )
      ).toBe('er');
    });

    it('should detect sequence/state even if config strings contain other diagram names', () => {
      // sequenceDiagram with config string mentioning stateDiagram
      expect(
        detectType(
          `---
title: Hello Title
config:
  theme: base
  themeVariables:
    primaryColor: "#00ff00"
---
sequenceDiagram\nA->B: hi`
        )
      ).toBe('sequence');
    });
  });
});
