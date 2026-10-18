/** Thin wrappers over the lab server's JSON API. */

import type { LayoutMetrics, StructuralMetrics } from '../metrics/index.js';

export interface CorpusEntry {
  path: string;
  dir: string;
  name: string;
  diagramType: string;
  /** sha256 of the file as it is on disk right now. */
  sourceHash: string;
  bytes: number;
  lineCount: number;
}

/** Layout-independent measurement, stored once per diagram. */
export interface DiagramStructureRecord {
  diagram: string;
  diagramType?: string;
  sourceHash?: string;
  structure?: StructuralMetrics;
  structureAt?: string;
  measuredWith?: string;
}

/** Everything that belongs to one (diagram, layout) pair. */
export interface LayoutRecord {
  diagram: string;
  layout: string;
  sourceHash?: string;
  layoutMetrics?: LayoutMetrics;
  metricsAt?: string;
  metricsError?: string;
  score?: number | null;
  /** Your own verdict, separate from the validator's `validationOk`. */
  acceptable?: boolean | null;
  notes?: string;
  scoredAt?: string;
}

export interface LabStore {
  version: number;
  updatedAt: string;
  diagrams: Record<string, DiagramStructureRecord>;
  records: Record<string, LayoutRecord>;
}

export function recordKey(diagram: string, layout: string): string {
  return `${layout}::${diagram}`;
}

export async function fetchCorpus(): Promise<{
  root: string;
  rootAbs: string;
  entries: CorpusEntry[];
}> {
  const response = await fetch('/api/corpus');
  if (!response.ok) {
    throw new Error(`Corpus listing failed: ${response.status}`);
  }
  return (await response.json()) as { root: string; rootAbs: string; entries: CorpusEntry[] };
}

export async function fetchDiagramSource(diagramPath: string): Promise<string> {
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('path', diagramPath);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not read ${diagramPath}: ${response.status}`);
  }
  return response.text();
}

export async function fetchStore(): Promise<LabStore> {
  const response = await fetch('/api/store');
  if (!response.ok) {
    throw new Error(`Store load failed: ${response.status}`);
  }
  return (await response.json()) as LabStore;
}

/**
 * Upsert either half of the store, or both.
 *
 * The server merges rather than replaces, so a score-only save cannot wipe
 * metrics and a metrics-only save cannot wipe a score.
 */
export async function saveToStore(payload: {
  diagrams?: DiagramStructureRecord[];
  records?: LayoutRecord[];
}): Promise<{ diagrams: DiagramStructureRecord[]; records: LayoutRecord[] }> {
  const diagrams = payload.diagrams ?? [];
  const records = payload.records ?? [];
  if (diagrams.length === 0 && records.length === 0) {
    return { diagrams: [], records: [] };
  }
  const response = await fetch('/api/store', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ diagrams, records }),
  });
  if (!response.ok) {
    throw new Error(`Save failed: ${response.status}`);
  }
  return (await response.json()) as {
    diagrams: DiagramStructureRecord[];
    records: LayoutRecord[];
  };
}

/** Rename a diagram inside the corpus. `name` is a bare filename, not a path. */
export async function renameDiagram(
  diagramPath: string,
  name: string
): Promise<{ path: string; renamed: boolean }> {
  const response = await fetch('/api/file/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: diagramPath, name }),
  });
  const body = (await response.json()) as { path?: string; renamed?: boolean; error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `Rename failed: ${response.status}`);
  }
  return { path: body.path!, renamed: Boolean(body.renamed) };
}

/** Delete a diagram and everything stored about it. */
export async function deleteDiagram(diagramPath: string): Promise<void> {
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('path', diagramPath);
  const response = await fetch(url, { method: 'DELETE' });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Delete failed: ${response.status}`);
  }
}

/** Overwrite a diagram's source. Returns the file's new content hash. */
export async function saveDiagramSource(
  diagramPath: string,
  text: string
): Promise<{ sourceHash: string }> {
  const url = new URL('/api/file', window.location.origin);
  url.searchParams.set('path', diagramPath);
  const response = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'text/plain' },
    body: text,
  });
  const body = (await response.json().catch(() => ({}))) as {
    sourceHash?: string;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(body.error ?? `Save failed: ${response.status}`);
  }
  return { sourceHash: body.sourceHash! };
}

/** Which layouts the lab offers, per `diagram-lab/layouts.json`. */
export async function fetchConfig(): Promise<{ layouts: string[]; known: string[] }> {
  const response = await fetch('/api/config');
  if (!response.ok) {
    throw new Error(`Config load failed: ${response.status}`);
  }
  return (await response.json()) as { layouts: string[]; known: string[] };
}
