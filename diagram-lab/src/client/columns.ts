/**
 * The table's column model — one source of truth for the header, the cell, the
 * sort key and the tooltip that says what the number actually means.
 */

import { isLayoutDependentMetric } from '../metrics/index.js';
import type { DiagramMetrics } from '../metrics/index.js';
import type { CorpusEntry, DiagramStructureRecord, LayoutRecord } from './api.js';

export interface Row {
  entry: CorpusEntry;
  /** Layout-independent half — survives a layout change. */
  structure?: DiagramStructureRecord;
  /** The (diagram, layout) half for the layout currently selected. */
  record?: LayoutRecord;
  /** The two halves recombined for display. */
  metrics?: DiagramMetrics;
  /** The stored structure was measured from a different version of the file. */
  structureStale: boolean;
  /** The stored layout metrics were measured from a different version of the file. */
  layoutStale: boolean;
}

export type CellValue = string | number | boolean | null;

export interface Column {
  key: string;
  label: string;
  title: string;
  numeric: boolean;
  /**
   * Whether this column's value changes when the layout changes.
   *
   * Derived from the metrics package's own key list rather than restated here,
   * so the header marker can never drift from what the store actually splits.
   */
  layoutDependent: boolean;
  /** Sort key and CSV-ish value. `null` sorts last in both directions. */
  value: (row: Row) => CellValue;
  /** What the cell shows. */
  text: (row: Row) => string;
  /** Extra class for the cell, e.g. to colour a flag. */
  cellClass?: (row: Row) => string;
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—';
  }
  return value.toLocaleString(undefined, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function fmtRatio(value: number | null | undefined, digits = 2): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : value.toFixed(digits);
}

export function fmtPercent(value: number | null | undefined): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value * 100)}%`;
}

function flag(value: boolean | undefined, yes: string, no = '·'): string {
  if (value === undefined) {
    return '—';
  }
  return value ? yes : no;
}

function metric<K extends keyof DiagramMetrics>(row: Row, key: K): DiagramMetrics[K] | undefined {
  return row.metrics?.[key];
}

type ColumnSpec = Omit<Column, 'layoutDependent'>;

const COLUMN_SPECS: ColumnSpec[] = [
  {
    key: 'diagram',
    label: 'Diagram',
    title: 'Path of the .mmd file, relative to the corpus root',
    numeric: false,
    value: (row) => row.entry.path,
    text: (row) => row.entry.path,
  },
  {
    key: 'diagramType',
    label: 'Type',
    title: 'Diagram keyword from the source (graph is folded into flowchart)',
    numeric: false,
    value: (row) => row.entry.diagramType,
    text: (row) => row.entry.diagramType,
  },
  {
    key: 'score',
    label: 'Score',
    title: 'Your judgement of this layout on this diagram, 0–10. Edit in place.',
    numeric: true,
    value: (row) => (row.record?.score ?? null) as CellValue,
    text: (row) =>
      row.record?.score === null || row.record?.score === undefined
        ? '—'
        : String(row.record.score),
    cellClass: (row) =>
      row.record?.score === null || row.record?.score === undefined ? '' : 'has-score',
  },
  {
    key: 'acceptable',
    label: 'ok?',
    title:
      'Your verdict: is this layout good enough to ship for this diagram? Separate from the validator, which only says the drawing is not broken.',
    numeric: true,
    value: (row) => (row.record?.acceptable ?? null) as CellValue,
    text: (row) =>
      row.record?.acceptable === undefined || row.record?.acceptable === null
        ? '—'
        : row.record.acceptable
          ? '✓'
          : '✗',
    cellClass: (row) =>
      row.record?.acceptable === true
        ? 'flag-ok'
        : row.record?.acceptable === false
          ? 'flag-bad'
          : '',
  },
  {
    key: 'nodeCount',
    label: 'N',
    title: 'Pure nodes — subgraph containers and edge-label placeholders excluded',
    numeric: true,
    value: (row) => metric(row, 'nodeCount') ?? null,
    text: (row) => fmtNumber(metric(row, 'nodeCount')),
  },
  {
    key: 'edgeCount',
    label: 'E',
    title: 'Connections between nodes, after edge-label placeholder nodes are collapsed away',
    numeric: true,
    value: (row) => metric(row, 'edgeCount') ?? null,
    text: (row) => fmtNumber(metric(row, 'edgeCount')),
  },
  {
    key: 'edgeNodeRatio',
    label: 'E/N',
    title: 'Edges per pure node. Above 1 means the graph carries cycles.',
    numeric: true,
    value: (row) => metric(row, 'edgeNodeRatio') ?? null,
    text: (row) => fmtRatio(metric(row, 'edgeNodeRatio')),
  },
  {
    key: 'degreeMax',
    label: 'deg max',
    title: 'Highest number of edges touching any single node (self-loops count twice)',
    numeric: true,
    value: (row) => metric(row, 'degreeMax') ?? null,
    text: (row) => fmtNumber(metric(row, 'degreeMax')),
  },
  {
    key: 'degreeMedian',
    label: 'deg med',
    title: 'Median number of edges touching a node',
    numeric: true,
    value: (row) => metric(row, 'degreeMedian') ?? null,
    text: (row) => fmtRatio(metric(row, 'degreeMedian'), 1),
  },
  {
    key: 'labeledEdgeRatio',
    label: 'lbl %',
    title: 'Share of edges carrying a label',
    numeric: true,
    value: (row) => metric(row, 'labeledEdgeRatio') ?? null,
    text: (row) => fmtPercent(metric(row, 'labeledEdgeRatio')),
  },
  {
    key: 'nonPlanar',
    label: 'non-planar',
    title:
      'The graph has no planar embedding, so every drawing of it must cross at least one edge (left-right planarity test)',
    numeric: true,
    value: (row) => (metric(row, 'nonPlanar') ?? null) as CellValue,
    text: (row) => flag(metric(row, 'nonPlanar'), 'yes'),
    cellClass: (row) => (metric(row, 'nonPlanar') ? 'flag-warn' : ''),
  },
  {
    key: 'isTree',
    label: 'tree',
    title:
      'Connected and acyclic, read as an undirected graph. Parallel edges and self-loops are collapsed first, so A-->B plus B-->A is one edge here even though E counts two.',
    numeric: true,
    value: (row) => (metric(row, 'isTree') ?? null) as CellValue,
    text: (row) => flag(metric(row, 'isTree'), 'yes'),
    cellClass: (row) => (metric(row, 'isTree') ? 'flag-ok' : ''),
  },
  {
    key: 'componentCount',
    label: 'comp',
    title: 'Connected components',
    numeric: true,
    value: (row) => metric(row, 'componentCount') ?? null,
    text: (row) => fmtNumber(metric(row, 'componentCount')),
  },
  {
    key: 'groupCount',
    label: 'sub',
    title: 'Number of subgraphs',
    numeric: true,
    value: (row) => metric(row, 'groupCount') ?? null,
    text: (row) => fmtNumber(metric(row, 'groupCount')),
    cellClass: (row) => ((metric(row, 'groupCount') ?? 0) > 0 ? 'flag-ok' : ''),
  },
  {
    key: 'subgraphBoundaryEdgeCount',
    label: 'pierced',
    title:
      'Edges with exactly one endpoint inside a subgraph — they have to cross its frame to be drawn',
    numeric: true,
    value: (row) => metric(row, 'subgraphBoundaryEdgeCount') ?? null,
    text: (row) => fmtNumber(metric(row, 'subgraphBoundaryEdgeCount')),
    cellClass: (row) => ((metric(row, 'subgraphBoundaryEdgeCount') ?? 0) > 0 ? 'flag-warn' : ''),
  },
  {
    key: 'stressNormalized',
    label: 'stress',
    title:
      'Normalised stress in [0,1] at the best uniform scale — how far the drawing is from realising its graph distances. Lower is better.',
    numeric: true,
    value: (row) => metric(row, 'stressNormalized') ?? null,
    text: (row) => fmtRatio(metric(row, 'stressNormalized'), 3),
  },
  {
    key: 'validationScore',
    label: 'valid',
    title:
      'validateLayout score in [0, 1000] — the same number the Dev Explorer validation panel and the DDLT sweep read by. Zero when the layout is invalid. Higher is better.',
    numeric: true,
    value: (row) => metric(row, 'validationScore') ?? null,
    text: (row) => fmtNumber(metric(row, 'validationScore')),
    cellClass: (row) => {
      const score = metric(row, 'validationScore');
      if (score === null || score === undefined) {
        return '';
      }
      if (metric(row, 'validationOk') === false) {
        return 'flag-bad';
      }
      return score >= 900 ? 'flag-ok' : score >= 700 ? 'flag-warn' : 'flag-bad';
    },
  },
  {
    key: 'validationHardIssues',
    label: 'hard',
    title:
      'Issues that make the layout invalid, as opposed to merely lowering the score. Any above zero means validationOk is false.',
    numeric: true,
    value: (row) => metric(row, 'validationHardIssues') ?? null,
    text: (row) => fmtNumber(metric(row, 'validationHardIssues')),
    cellClass: (row) => ((metric(row, 'validationHardIssues') ?? 0) > 0 ? 'flag-bad' : ''),
  },
  {
    key: 'crossings',
    label: 'cross',
    title:
      'Edge crossings the validator counted. Read next to non-planar: a non-planar graph must cross at least once, so crossings above that floor are the layout\u2019s own doing.',
    numeric: true,
    value: (row) => metric(row, 'crossings') ?? null,
    text: (row) => fmtNumber(metric(row, 'crossings')),
    cellClass: (row) => ((metric(row, 'crossings') ?? 0) > 0 ? 'flag-warn' : ''),
  },
  {
    key: 'drawingArea',
    label: 'size',
    title: 'Bounding box of the drawing, width × height in layout px',
    numeric: true,
    value: (row) => metric(row, 'drawingArea') ?? null,
    text: (row) => {
      const width = metric(row, 'drawingWidth');
      const height = metric(row, 'drawingHeight');
      if (width == null || height == null) {
        return '—';
      }
      return `${Math.round(width)}×${Math.round(height)}`;
    },
  },
];

/** Columns that belong to the (diagram, layout) pair but are not metric keys. */
const EXTRA_LAYOUT_DEPENDENT = new Set(['score', 'acceptable']);

export const COLUMNS: Column[] = COLUMN_SPECS.map((spec) => ({
  ...spec,
  layoutDependent: isLayoutDependentMetric(spec.key) || EXTRA_LAYOUT_DEPENDENT.has(spec.key),
}));

export const SORTABLE_KEYS = new Set(COLUMNS.map((column) => column.key));

export function compareRows(a: Row, b: Row, key: string, direction: 1 | -1): number {
  const column = COLUMNS.find((c) => c.key === key);
  if (!column) {
    return 0;
  }
  const left = column.value(a);
  const right = column.value(b);

  // Unmeasured rows sort last whichever way the column is pointing, so a sort
  // never buries the rows you still have to run.
  if (left === null && right === null) {
    return a.entry.path.localeCompare(b.entry.path);
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }

  const normalize = (value: CellValue) => (typeof value === 'boolean' ? Number(value) : value);
  const l = normalize(left);
  const r = normalize(right);
  const cmp =
    typeof l === 'number' && typeof r === 'number'
      ? l - r
      : String(l).localeCompare(String(r), undefined, { sensitivity: 'base', numeric: true });
  return cmp === 0 ? a.entry.path.localeCompare(b.entry.path) : cmp * direction;
}
