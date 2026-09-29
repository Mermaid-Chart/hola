/** Thin wrappers over the lab server's JSON API. */

import type { DiagramMetrics } from '../metrics/index.js';

export interface CorpusEntry {
  path: string;
  dir: string;
  name: string;
  diagramType: string;
  bytes: number;
  lineCount: number;
}

export interface LabRecord {
  diagram: string;
  layout: string;
  diagramType?: string;
  metrics?: DiagramMetrics;
  metricsAt?: string;
  metricsError?: string;
  score?: number | null;
  notes?: string;
  scoredAt?: string;
}

export interface RecordsFile {
  version: number;
  updatedAt: string;
  records: Record<string, LabRecord>;
}

export function recordKey(diagram: string, layout: string): string {
  return `${layout}::${diagram}`;
}

export async function fetchCorpus(): Promise<{ root: string; entries: CorpusEntry[] }> {
  const response = await fetch('/api/corpus');
  if (!response.ok) {
    throw new Error(`Corpus listing failed: ${response.status}`);
  }
  return (await response.json()) as { root: string; entries: CorpusEntry[] };
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

export async function fetchRecords(): Promise<RecordsFile> {
  const response = await fetch('/api/records');
  if (!response.ok) {
    throw new Error(`Records load failed: ${response.status}`);
  }
  return (await response.json()) as RecordsFile;
}

export async function saveRecords(records: LabRecord[]): Promise<LabRecord[]> {
  if (records.length === 0) {
    return [];
  }
  const response = await fetch('/api/records', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ records }),
  });
  if (!response.ok) {
    throw new Error(`Records save failed: ${response.status}`);
  }
  const body = (await response.json()) as { records: LabRecord[] };
  return body.records;
}
