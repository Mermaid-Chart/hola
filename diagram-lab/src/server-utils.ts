/**
 * Pure helpers used by the lab server.
 *
 * Kept out of `server.ts` because importing that module starts a server and
 * kicks off an esbuild build — which is fine for `pnpm lab` and useless in a test.
 */

export interface LabRecord {
  diagram: string;
  layout: string;
  diagramType?: string;
  metrics?: Record<string, unknown>;
  metricsAt?: string;
  metricsError?: string;
  score?: number | null;
  notes?: string;
  scoredAt?: string;
}

export function recordKey(diagram: string, layout: string): string {
  return `${layout}::${diagram}`;
}

/**
 * The diagram keyword, read the way Mermaid's detectors do: after frontmatter,
 * directives and comments are skipped, the first word of the first real line.
 *
 * `graph` is folded into `flowchart` — they are the same diagram under two
 * spellings, and splitting them would split the lab's corpus filter too.
 */
export function detectDiagramType(source: string): string {
  // Strip a BOM without a regex, so no lint autofixer can turn the escape into
  // a literal zero-width character in the source.
  let text = source.codePointAt(0) === 0xfe_ff ? source.slice(1) : source;
  const frontmatter = /^\s*---\r?\n[\S\s]*?\r?\n---[\t ]*\r?\n/.exec(text);
  if (frontmatter) {
    text = text.slice(frontmatter[0].length);
  }
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('%%')) {
      continue;
    }
    const keyword = /^[A-Za-z][\w-]*/.exec(line)?.[0] ?? 'unknown';
    return keyword === 'graph' ? 'flowchart' : keyword;
  }
  return 'unknown';
}

/**
 * Merge an incoming record into an existing one.
 *
 * A metrics-only update must not wipe a score typed earlier, and a score-only
 * update must not wipe metrics — the two arrive from different places (a sweep
 * and a keystroke) and routinely overlap.
 */
export function mergeRecord(existing: LabRecord | undefined, incoming: LabRecord): LabRecord {
  const merged: LabRecord = {
    ...existing,
    ...incoming,
    diagram: incoming.diagram,
    layout: incoming.layout,
  };
  if (incoming.score === undefined && existing) {
    merged.score = existing.score;
    merged.notes = existing.notes;
    merged.scoredAt = existing.scoredAt;
  }
  if (incoming.metrics === undefined && existing) {
    merged.metrics = existing.metrics;
    merged.metricsAt = existing.metricsAt;
    merged.metricsError = incoming.metricsError ?? existing.metricsError;
  }
  return merged;
}

export const CSV_COLUMNS = [
  'diagram',
  'layout',
  'diagramType',
  'score',
  'nodeCount',
  'edgeCount',
  'groupCount',
  'drawingWidth',
  'drawingHeight',
  'drawingArea',
  'degreeMax',
  'degreeMedian',
  'edgeNodeRatio',
  'labeledEdgeRatio',
  'nonPlanar',
  'isTree',
  'isForest',
  'componentCount',
  'stress',
  'stressNormalized',
  'stressOptimalEdgeLength',
  'stressNodeCount',
  'hasSubgraphs',
  'subgraphBoundaryEdgeCount',
  'hasSubgraphBoundaryEdges',
  'notes',
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  // Metrics are primitives, but `piercedSubgraphIds` is an array — and a cell
  // reading `[object Object]` would be worse than useless in a spreadsheet.
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else if (typeof value === 'number' || typeof value === 'boolean') {
    text = String(value);
  } else {
    text = JSON.stringify(value) ?? '';
  }
  return /[\n\r",]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function recordsToCsv(records: LabRecord[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const record of records) {
    const flat: Record<string, unknown> = {
      ...(record.metrics ?? {}),
      diagram: record.diagram,
      layout: record.layout,
      diagramType: record.diagramType,
      score: record.score,
      notes: record.notes,
    };
    lines.push(CSV_COLUMNS.map((column) => csvCell(flat[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}
