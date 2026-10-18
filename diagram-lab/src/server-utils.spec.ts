import { describe, expect, it } from 'vitest';
import { LAYOUT_DEPENDENT_METRIC_KEYS } from './metrics/types.js';
import {
  CSV_COLUMNS,
  KNOWN_LAB_LAYOUTS,
  detectDiagramType,
  emptyStore,
  mergeRecord,
  mergeStructure,
  migrateStore,
  recordKey,
  resolveLayouts,
  storeToCsv,
} from './server-utils.js';
import type { LabStore, LayoutRecord } from './server-utils.js';

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
  const layoutMetrics = { stress: 12, stressNormalized: 0.3 };

  it('keeps an existing score when only layout metrics arrive', () => {
    const existing: LayoutRecord = { diagram: 'a.mmd', layout: 'dagre', score: 7, notes: 'nice' };
    const merged = mergeRecord(existing, {
      diagram: 'a.mmd',
      layout: 'dagre',
      layoutMetrics,
      metricsAt: 'now',
    });
    expect(merged.score).toBe(7);
    expect(merged.notes).toBe('nice');
    expect(merged.layoutMetrics).toBe(layoutMetrics);
  });

  it('keeps existing layout metrics when only a score arrives', () => {
    const existing: LayoutRecord = {
      diagram: 'a.mmd',
      layout: 'dagre',
      layoutMetrics,
      metricsAt: 'then',
    };
    const merged = mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', score: 4 });
    expect(merged.layoutMetrics).toBe(layoutMetrics);
    expect(merged.metricsAt).toBe('then');
    expect(merged.score).toBe(4);
  });

  it('lets an explicit null clear a score', () => {
    const existing: LayoutRecord = { diagram: 'a.mmd', layout: 'dagre', score: 9 };
    expect(
      mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', score: null }).score
    ).toBeNull();
  });

  it('works with no existing record', () => {
    const merged = mergeRecord(undefined, { diagram: 'a.mmd', layout: 'elk', score: 2 });
    expect(merged).toEqual({ diagram: 'a.mmd', layout: 'elk', score: 2 });
  });

  it('keeps the acceptable flag when only layout metrics arrive', () => {
    const existing: LayoutRecord = { diagram: 'a.mmd', layout: 'dagre', acceptable: true };
    const merged = mergeRecord(existing, {
      diagram: 'a.mmd',
      layout: 'dagre',
      layoutMetrics,
      metricsAt: 'now',
    });
    expect(merged.acceptable).toBe(true);
  });

  it('keeps the score when only the acceptable flag arrives, and vice versa', () => {
    const existing: LayoutRecord = {
      diagram: 'a.mmd',
      layout: 'dagre',
      score: 8,
      acceptable: true,
    };
    expect(
      mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', acceptable: false })
    ).toMatchObject({ score: 8, acceptable: false });
    expect(mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', score: 3 })).toMatchObject({
      score: 3,
      acceptable: true,
    });
  });

  it('lets an explicit null clear the acceptable flag', () => {
    const existing: LayoutRecord = { diagram: 'a.mmd', layout: 'dagre', acceptable: false };
    expect(
      mergeRecord(existing, { diagram: 'a.mmd', layout: 'dagre', acceptable: null }).acceptable
    ).toBeNull();
  });
});

describe('mergeStructure', () => {
  const structure = { nodeCount: 3, edgeCount: 2 };

  it('replaces structure on a re-measure and records the source hash', () => {
    const merged = mergeStructure(
      { diagram: 'a.mmd', structure: { nodeCount: 1 }, sourceHash: 'old' },
      { diagram: 'a.mmd', structure, sourceHash: 'new', structureAt: 'now' }
    );
    expect(merged.structure).toEqual(structure);
    expect(merged.sourceHash).toBe('new');
  });

  it('is a no-op rather than an erasure when no structure is sent', () => {
    const merged = mergeStructure(
      { diagram: 'a.mmd', structure, structureAt: 'then', measuredWith: 'dagre' },
      { diagram: 'a.mmd', diagramType: 'flowchart' }
    );
    expect(merged.structure).toBe(structure);
    expect(merged.structureAt).toBe('then');
    expect(merged.measuredWith).toBe('dagre');
    expect(merged.diagramType).toBe('flowchart');
  });
});

describe('migrateStore', () => {
  it('returns an empty store for junk', () => {
    expect(migrateStore(null, LAYOUT_DEPENDENT_METRIC_KEYS).records).toEqual({});
    expect(migrateStore('nope', LAYOUT_DEPENDENT_METRIC_KEYS).diagrams).toEqual({});
  });

  it('passes a v2 store through unchanged', () => {
    const store: LabStore = {
      version: 2,
      updatedAt: 'x',
      diagrams: { 'a.mmd': { diagram: 'a.mmd', structure: { nodeCount: 2 } } },
      records: { 'elk::a.mmd': { diagram: 'a.mmd', layout: 'elk', score: 3 } },
    };
    expect(migrateStore(store, LAYOUT_DEPENDENT_METRIC_KEYS)).toEqual(store);
  });

  it('splits a v1 flat metric bag into structure and layout halves', () => {
    const v1 = {
      version: 1,
      records: {
        'dagre::a.mmd': {
          diagram: 'a.mmd',
          layout: 'dagre',
          diagramType: 'flowchart',
          score: 5,
          notes: 'ok',
          metricsAt: '2026-01-01',
          metrics: {
            nodeCount: 4,
            edgeCount: 5,
            nonPlanar: true,
            stress: 99,
            stressNormalized: 0.25,
            drawingWidth: 300,
          },
        },
      },
    };

    const store = migrateStore(v1, LAYOUT_DEPENDENT_METRIC_KEYS);

    expect(store.version).toBe(2);
    expect(store.diagrams['a.mmd'].structure).toEqual({
      nodeCount: 4,
      edgeCount: 5,
      nonPlanar: true,
    });
    expect(store.diagrams['a.mmd'].measuredWith).toBe('dagre');

    const record = store.records['dagre::a.mmd'];
    expect(record.layoutMetrics).toEqual({ stress: 99, stressNormalized: 0.25, drawingWidth: 300 });
    // The score and note the operator typed survive the migration.
    expect(record.score).toBe(5);
    expect(record.notes).toBe('ok');
  });

  it('shares one structure entry across a diagram measured under several layouts', () => {
    const v1 = {
      version: 1,
      records: {
        'dagre::a.mmd': {
          diagram: 'a.mmd',
          layout: 'dagre',
          metrics: { nodeCount: 4, stress: 1 },
        },
        'elk::a.mmd': { diagram: 'a.mmd', layout: 'elk', metrics: { nodeCount: 4, stress: 2 } },
      },
    };
    const store = migrateStore(v1, LAYOUT_DEPENDENT_METRIC_KEYS);
    expect(Object.keys(store.diagrams)).toEqual(['a.mmd']);
    expect(Object.keys(store.records)).toHaveLength(2);
    expect(store.records['dagre::a.mmd'].layoutMetrics).toEqual({ stress: 1 });
    expect(store.records['elk::a.mmd'].layoutMetrics).toEqual({ stress: 2 });
  });

  it('keeps a score-only v1 record that never had metrics', () => {
    const store = migrateStore(
      { version: 1, records: { 'elk::a.mmd': { diagram: 'a.mmd', layout: 'elk', score: 8 } } },
      LAYOUT_DEPENDENT_METRIC_KEYS
    );
    expect(store.records['elk::a.mmd'].score).toBe(8);
    expect(store.diagrams['a.mmd']).toBeUndefined();
  });
});

describe('storeToCsv', () => {
  function store(): LabStore {
    const s = emptyStore();
    s.diagrams['flow/a.mmd'] = {
      diagram: 'flow/a.mmd',
      diagramType: 'flowchart',
      structure: { nodeCount: 4, edgeCount: 5, nonPlanar: false, isTree: false },
    };
    s.records['dagre::flow/a.mmd'] = {
      diagram: 'flow/a.mmd',
      layout: 'dagre',
      score: 6,
      acceptable: true,
      layoutMetrics: {
        stress: 12.5,
        stressNormalized: 0.2,
        validationScore: 880,
        validationOk: true,
        crossings: 2,
      },
    };
    s.records['elk::flow/a.mmd'] = {
      diagram: 'flow/a.mmd',
      layout: 'elk',
      acceptable: false,
      layoutMetrics: {
        stress: 9.5,
        stressNormalized: 0.1,
        validationScore: 940,
        validationOk: true,
        crossings: 0,
      },
    };
    return s;
  }

  /** Read a cell by column name, so adding a column cannot break these tests. */
  function cell(line: string, column: string): string {
    return line.split(',')[CSV_COLUMNS.indexOf(column as (typeof CSV_COLUMNS)[number])];
  }

  it('rejoins the two halves into one row per pair', () => {
    const lines = storeToCsv(store()).trim().split('\n');
    expect(lines[0]).toBe(CSV_COLUMNS.join(','));
    expect(lines).toHaveLength(3);

    // Structure is repeated on both rows; only the layout metrics differ.
    for (const line of lines.slice(1)) {
      expect(cell(line, 'diagram')).toBe('flow/a.mmd');
      expect(cell(line, 'diagramType')).toBe('flowchart');
      expect(cell(line, 'nodeCount')).toBe('4');
      expect(cell(line, 'edgeCount')).toBe('5');
    }
    expect(cell(lines[1], 'layout')).toBe('dagre');
    expect(cell(lines[1], 'score')).toBe('6');
    expect(cell(lines[1], 'acceptable')).toBe('true');
    expect(cell(lines[1], 'stress')).toBe('12.5');
    expect(cell(lines[1], 'validationScore')).toBe('880');

    expect(cell(lines[2], 'layout')).toBe('elk');
    expect(cell(lines[2], 'score')).toBe('');
    expect(cell(lines[2], 'acceptable')).toBe('false');
    expect(cell(lines[2], 'stress')).toBe('9.5');
  });

  it('carries the validator verdict and the acceptable flag', () => {
    const csv = storeToCsv(store());
    for (const column of ['acceptable', 'validationScore', 'validationOk', 'crossings']) {
      expect(CSV_COLUMNS).toContain(column);
    }
    expect(csv.split('\n')[1]).toContain('true');
  });

  it('filters to one layout', () => {
    const lines = storeToCsv(store(), 'elk').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(',elk,');
  });

  it('quotes cells containing commas, quotes or newlines', () => {
    const s = emptyStore();
    s.records['elk::a.mmd'] = {
      diagram: 'a.mmd',
      layout: 'elk',
      notes: 'wide, and "cramped"\nline two',
    };
    expect(storeToCsv(s)).toContain('"wide, and ""cramped""\nline two"');
  });

  it('leaves missing values empty rather than writing undefined', () => {
    const s = emptyStore();
    s.records['elk::a.mmd'] = { diagram: 'a.mmd', layout: 'elk' };
    const csv = storeToCsv(s);
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

describe('resolveLayouts', () => {
  it('uses the configured list, in the order written', () => {
    const r = resolveLayouts(['elk', 'dagre', 'ipsep-cola']);
    expect(r.layouts).toEqual(['elk', 'dagre', 'ipsep-cola']);
    expect(r.source).toBe('file');
    expect(r.unknown).toEqual([]);
  });

  it('drops names it cannot measure, and says which', () => {
    const r = resolveLayouts(['dagre', 'graphviz', 'elk', 'sugiyama']);
    expect(r.layouts).toEqual(['dagre', 'elk']);
    expect(r.unknown).toEqual(['graphviz', 'sugiyama']);
  });

  it('collapses duplicates and ignores blanks', () => {
    expect(resolveLayouts(['dagre', 'dagre', '  ', 'elk']).layouts).toEqual(['dagre', 'elk']);
  });

  it('falls back to every known layout when nothing is configured', () => {
    for (const configured of [undefined, null, [], 'nope', {}]) {
      const r = resolveLayouts(configured);
      expect(r.layouts).toEqual([...KNOWN_LAB_LAYOUTS]);
      expect(r.source).toBe('default');
    }
  });

  it('falls back rather than leaving no layout at all', () => {
    // Every requested name was unknown: offering an empty bar would make the
    // whole tool unusable, so the full list comes back instead.
    const r = resolveLayouts(['graphviz', 'sugiyama']);
    expect(r.layouts).toEqual([...KNOWN_LAB_LAYOUTS]);
    expect(r.unknown).toEqual(['graphviz', 'sugiyama']);
  });

  it('lets the environment override the file', () => {
    const r = resolveLayouts(['dagre', 'elk'], 'hola, gipsec');
    expect(r.layouts).toEqual(['hola', 'gipsec']);
    expect(r.source).toBe('env');
  });

  it('ignores an empty environment value', () => {
    expect(resolveLayouts(['dagre'], '').layouts).toEqual(['dagre']);
    expect(resolveLayouts(['dagre'], '  ,  ').layouts).toEqual(['dagre']);
  });
});
