/**
 * Pure helpers used by the lab server.
 *
 * Kept out of `server.ts` because importing that module starts a server and
 * kicks off an esbuild build — which is fine for `pnpm lab` and useless in a test.
 *
 * ## Why the store has two halves
 *
 * Most of what the lab measures is a property of the *diagram*: node and edge
 * counts, degrees, planarity, tree-ness, subgraph containment. Those come out
 * identical whichever layout ran. Only the drawing box and the stress numbers
 * depend on where the layout put things.
 *
 * So structure is stored once per diagram, and layout metrics once per
 * (diagram, layout) pair. Switching layout in the UI therefore leaves every
 * structural column standing, and only the layout-dependent ones go blank until
 * that pair has been measured.
 *
 * Both halves carry the source hash they were measured from, so editing a
 * `.mmd` marks its numbers stale instead of leaving them quietly wrong.
 */

export type MetricBag = Record<string, unknown>;

/** Layout-independent measurement of one diagram. */
export interface DiagramStructureRecord {
  diagram: string;
  diagramType?: string;
  /** sha256 of the `.mmd` the structure was measured from. */
  sourceHash?: string;
  structure?: MetricBag;
  structureAt?: string;
  /** Which layout's render produced it. Recorded for traceability only. */
  measuredWith?: string;
}

/** Everything that belongs to one (diagram, layout) pair. */
export interface LayoutRecord {
  diagram: string;
  layout: string;
  /** sha256 of the `.mmd` the layout metrics were measured from. */
  sourceHash?: string;
  layoutMetrics?: MetricBag;
  metricsAt?: string;
  metricsError?: string;
  score?: number | null;
  /**
   * Your verdict on whether this layout is good enough to ship for this
   * diagram. Deliberately separate from the validator's `validationOk`, which
   * only says the layout is not broken — the interesting cases are the ones
   * where the two disagree.
   */
  acceptable?: boolean | null;
  notes?: string;
  scoredAt?: string;
}

export interface LabStore {
  version: 2;
  updatedAt: string;
  diagrams: Record<string, DiagramStructureRecord>;
  records: Record<string, LayoutRecord>;
}

export function emptyStore(): LabStore {
  return { version: 2, updatedAt: new Date().toISOString(), diagrams: {}, records: {} };
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
 * Merge an incoming structure record into an existing one.
 *
 * A record that carries no `structure` is a no-op rather than an erasure —
 * callers send partial updates.
 */
export function mergeStructure(
  existing: DiagramStructureRecord | undefined,
  incoming: DiagramStructureRecord
): DiagramStructureRecord {
  const merged: DiagramStructureRecord = { ...existing, ...incoming, diagram: incoming.diagram };
  if (incoming.structure === undefined && existing) {
    merged.structure = existing.structure;
    merged.structureAt = existing.structureAt;
    merged.sourceHash = incoming.sourceHash ?? existing.sourceHash;
    merged.measuredWith = existing.measuredWith;
  }
  return merged;
}

/**
 * Merge an incoming layout record into an existing one.
 *
 * A metrics-only update must not wipe a score typed earlier, and a score-only
 * update must not wipe metrics — the two arrive from different places (a sweep
 * and a keystroke) and routinely overlap.
 */
export function mergeRecord(
  existing: LayoutRecord | undefined,
  incoming: LayoutRecord
): LayoutRecord {
  const merged: LayoutRecord = {
    ...existing,
    ...incoming,
    diagram: incoming.diagram,
    layout: incoming.layout,
  };
  // The judgement fields travel together and are only ever sent by a deliberate
  // edit, so a metrics-only update must leave all of them alone.
  if (incoming.score === undefined && incoming.acceptable === undefined && existing) {
    merged.score = existing.score;
    merged.acceptable = existing.acceptable;
    merged.notes = existing.notes;
    merged.scoredAt = existing.scoredAt;
  } else if (existing) {
    merged.score = incoming.score === undefined ? existing.score : incoming.score;
    merged.acceptable =
      incoming.acceptable === undefined ? existing.acceptable : incoming.acceptable;
  }
  if (incoming.layoutMetrics === undefined && existing) {
    merged.layoutMetrics = existing.layoutMetrics;
    merged.metricsAt = existing.metricsAt;
    merged.metricsError = incoming.metricsError ?? existing.metricsError;
    merged.sourceHash = incoming.sourceHash ?? existing.sourceHash;
  }
  return merged;
}

/** A v1 store, from before structure and layout metrics were split apart. */
interface LegacyRecord {
  diagram?: string;
  layout?: string;
  diagramType?: string;
  metrics?: MetricBag;
  metricsAt?: string;
  metricsError?: string;
  score?: number | null;
  acceptable?: boolean | null;
  notes?: string;
  scoredAt?: string;
}

/**
 * Read any store version into the current shape.
 *
 * A v1 file held one flat metric bag per pair. Splitting it needs the same key
 * list the client splits by, which is passed in rather than imported so this
 * module stays free of the metrics package.
 */
export function migrateStore(raw: unknown, layoutMetricKeys: readonly string[]): LabStore {
  const store = emptyStore();
  if (!raw || typeof raw !== 'object') {
    return store;
  }
  const candidate = raw as Partial<LabStore> & {
    version?: number;
    records?: Record<string, LegacyRecord | LayoutRecord>;
  };

  if (candidate.version === 2 && candidate.diagrams && candidate.records) {
    return {
      version: 2,
      updatedAt: candidate.updatedAt ?? store.updatedAt,
      diagrams: candidate.diagrams,
      records: candidate.records as Record<string, LayoutRecord>,
    };
  }

  const layoutKeys = new Set(layoutMetricKeys);
  for (const value of Object.values(candidate.records ?? {})) {
    const entry = value as LegacyRecord;
    if (!entry?.diagram || !entry.layout) {
      continue;
    }
    const structural: MetricBag = {};
    const layoutMetrics: MetricBag = {};
    for (const [key, metric] of Object.entries(entry.metrics ?? {})) {
      (layoutKeys.has(key) ? layoutMetrics : structural)[key] = metric;
    }

    if (entry.metrics) {
      store.diagrams[entry.diagram] = mergeStructure(store.diagrams[entry.diagram], {
        diagram: entry.diagram,
        diagramType: entry.diagramType,
        structure: structural,
        structureAt: entry.metricsAt,
        measuredWith: entry.layout,
      });
    }
    store.records[recordKey(entry.diagram, entry.layout)] = {
      diagram: entry.diagram,
      layout: entry.layout,
      layoutMetrics: entry.metrics ? layoutMetrics : undefined,
      metricsAt: entry.metricsAt,
      metricsError: entry.metricsError,
      score: entry.score,
      acceptable: entry.acceptable,
      notes: entry.notes,
      scoredAt: entry.scoredAt,
    };
  }
  return store;
}

export const CSV_COLUMNS = [
  'diagram',
  'layout',
  'diagramType',
  'score',
  'acceptable',
  'nodeCount',
  'edgeCount',
  'groupCount',
  'degreeMax',
  'degreeMedian',
  'edgeNodeRatio',
  'labeledEdgeRatio',
  'nonPlanar',
  'isTree',
  'isForest',
  'componentCount',
  'hasSubgraphs',
  'subgraphBoundaryEdgeCount',
  'hasSubgraphBoundaryEdges',
  'drawingWidth',
  'drawingHeight',
  'drawingArea',
  'stress',
  'stressNormalized',
  'stressOptimalEdgeLength',
  'stressNodeCount',
  'validationScore',
  'validationOk',
  'validationIssues',
  'validationHardIssues',
  'crossings',
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

/** Flatten the two halves back into one row per (diagram, layout) pair. */
export function storeToCsv(store: LabStore, layout?: string): string {
  const rows = Object.values(store.records)
    .filter((record) => !layout || record.layout === layout)
    .sort((a, b) => a.diagram.localeCompare(b.diagram) || a.layout.localeCompare(b.layout));

  const lines = [CSV_COLUMNS.join(',')];
  for (const record of rows) {
    const structure = store.diagrams[record.diagram];
    const flat: MetricBag = {
      ...(structure?.structure ?? {}),
      ...(record.layoutMetrics ?? {}),
      diagram: record.diagram,
      layout: record.layout,
      diagramType: structure?.diagramType,
      score: record.score,
      acceptable: record.acceptable,
      notes: record.notes,
    };
    lines.push(CSV_COLUMNS.map((column) => csvCell(flat[column])).join(','));
  }
  return `${lines.join('\n')}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Layout selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every layout the lab knows how to measure.
 *
 * All of these route through the shared layout renderer, which is what makes
 * the structure and position captures available. A name outside this list would
 * render (or fail) without producing a capture, and the lab would record an
 * error rather than metrics — so unknown names are dropped rather than offered.
 */
export const KNOWN_LAB_LAYOUTS = [
  'dagre',
  'elk',
  'domus',
  'ipsep-cola',
  'gipsec',
  'hola',
  'swimlane',
] as const;

export interface ResolvedLayouts {
  layouts: string[];
  /** Names that were asked for but are not measurable; reported, not offered. */
  unknown: string[];
  source: 'env' | 'file' | 'default';
}

/**
 * Work out which layouts to offer.
 *
 * `MERMAID_LAB_LAYOUTS` wins over the config file, which wins over "all of
 * them". Order is preserved as written, duplicates collapse, and an empty
 * result falls back to the full list rather than leaving the lab with no layout
 * to select.
 */
export function resolveLayouts(
  configured: unknown,
  envValue?: string,
  known: readonly string[] = KNOWN_LAB_LAYOUTS
): ResolvedLayouts {
  const fromEnv = (envValue ?? '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);

  let requested: string[];
  let source: ResolvedLayouts['source'];
  if (fromEnv.length > 0) {
    requested = fromEnv;
    source = 'env';
  } else if (Array.isArray(configured)) {
    requested = configured.filter((name): name is string => typeof name === 'string');
    source = 'file';
  } else {
    requested = [];
    source = 'default';
  }

  const knownSet = new Set(known);
  const seen = new Set<string>();
  const layouts: string[] = [];
  const unknown: string[] = [];
  for (const name of requested) {
    const trimmed = name.trim();
    if (!trimmed || seen.has(trimmed)) {
      continue;
    }
    seen.add(trimmed);
    if (knownSet.has(trimmed)) {
      layouts.push(trimmed);
    } else {
      unknown.push(trimmed);
    }
  }

  if (layouts.length === 0) {
    return { layouts: [...known], unknown, source: unknown.length > 0 ? source : 'default' };
  }
  return { layouts, unknown, source };
}
