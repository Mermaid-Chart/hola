import { describe, expect, it } from 'vitest';
import { detectDiagramType, mergeRecord, recordKey, recordsToCsv } from './server-utils.js';
import type { LabRecord } from './server-utils.js';

describe('detectDiagramType', () => {
  it('reads the leading keyword', () => {
    expect(detectDiagramType('flowchart TD\n  A --> B\n')).toBe('flowchart');
    expect(detectDiagramType('sequenceDiagram\n  A ->> B: hi\n')).toBe('sequenceDiagram');
    expect(detectDiagramType('stateDiagram-v2\n  [*] --> a\n')).toBe('stateDiagram-v2');
  });

  it('folds the legacy `graph` spelling into flowchart', () => {
    expect(detectDiagramType('graph LR\n  A --> B\n')).toBe('flowchart');
  });

  it('skips blank lines and %% comments', () => {
    expect(detectDiagramType('\n\n%% a note\n%%{init: {}}%%\nflowchart TD\n  A --> B\n')).toBe(
      'flowchart'
    );
  });

  it('skips YAML frontmatter', () => {
    const source = [
      '---',
      'title: Example',
      'config:',
      '  layout: elk',
      '---',
      'flowchart LR',
      '  A --> B',
    ].join('\n');
    expect(detectDiagramType(source)).toBe('flowchart');
  });

  it('skips a byte-order mark', () => {
    expect(detectDiagramType('﻿flowchart TD\n A-->B')).toBe('flowchart');
  });

  it('reports unknown for an empty file', () => {
    expect(detectDiagramType('')).toBe('unknown');
    expect(detectDiagramType('   \n\n')).toBe('unknown');
  });
});

describe('mergeRecord', () => {
  const metrics = { nodeCount: 3 };

  it('keeps an existing score when only metrics arrive', () => {
    const existing: LabRecord = { diagram: 'a.mmd', layout: 'dagre', score: 7, notes: 'nice' };
    const merged = mergeRecord(existing, {
      diagram: 'a.mmd',
      layout: 'dagre',
      metrics,
      metricsAt: 'now',
    });
    expect(merged.score).toBe(7);
    expect(merged.notes).toBe('nice');
    expect(merged.metrics).toBe(metrics);
  });

  it('keeps existing metrics when only a score arrives', () => {
    const existing: LabRecord = { diagram: 'a.mmd', layout: 'dagre', metrics, metricsAt: 'then' };
    const merged = mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', score: 4 });
    expect(merged.metrics).toBe(metrics);
    expect(merged.metricsAt).toBe('then');
    expect(merged.score).toBe(4);
  });

  it('lets an explicit null clear a score', () => {
    const existing: LabRecord = { diagram: 'a.mmd', layout: 'dagre', score: 9 };
    expect(
      mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', score: null }).score
    ).toBeNull();
  });

  it('replaces metrics on a re-measure', () => {
    const existing: LabRecord = { diagram: 'a.mmd', layout: 'dagre', metrics: { nodeCount: 1 } };
    const merged = mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', metrics });
    expect(merged.metrics).toEqual({ nodeCount: 3 });
  });

  it('works with no existing record', () => {
    const merged = mergeRecord(undefined, { diagram: 'a.mmd', layout: 'elk', score: 2 });
    expect(merged).toEqual({ diagram: 'a.mmd', layout: 'elk', score: 2 });
  });
});

describe('recordsToCsv', () => {
  it('emits a header and flattens metrics into columns', () => {
    const csv = recordsToCsv([
      {
        diagram: 'flow/a.mmd',
        layout: 'dagre',
        diagramType: 'flowchart',
        score: 6,
        metrics: { nodeCount: 4, edgeCount: 5, nonPlanar: false, isTree: false },
      },
    ]);
    const [header, row] = csv.trim().split('\n');
    expect(header.startsWith('diagram,layout,diagramType,score,nodeCount')).toBe(true);
    expect(row.startsWith('flow/a.mmd,dagre,flowchart,6,4,5')).toBe(true);
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    const csv = recordsToCsv([
      { diagram: 'a.mmd', layout: 'elk', notes: 'wide, and "cramped"\nline two' },
    ]);
    expect(csv).toContain('"wide, and ""cramped""\nline two"');
  });

  it('leaves missing values empty rather than writing undefined', () => {
    const csv = recordsToCsv([{ diagram: 'a.mmd', layout: 'elk' }]);
    expect(csv).not.toContain('undefined');
    expect(csv.trim().split('\n')[1].startsWith('a.mmd,elk,,')).toBe(true);
  });
});

describe('recordKey', () => {
  it('is unique per (diagram, layout) pair', () => {
    expect(recordKey('a.mmd', 'dagre')).not.toBe(recordKey('a.mmd', 'elk'));
    expect(recordKey('a.mmd', 'dagre')).toBe(recordKey('a.mmd', 'dagre'));
  });
});
