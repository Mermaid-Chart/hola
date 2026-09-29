/**
 * Diagram Lab — browse a diagram corpus, measure each diagram under a chosen
 * layout, and score the result by hand.
 *
 * One row per (diagram, layout) pair. Structural metrics are the same whichever
 * layout ran; `stress` and the drawing box are not, which is the whole reason
 * the pair — rather than the diagram alone — is the unit of study.
 */

import { LitElement, html, nothing } from 'lit';
import type { TemplateResult } from 'lit';
import { unsafeHTML } from 'lit/directives/unsafe-html.js';
import { setBasePath } from '@shoelace-style/shoelace/dist/utilities/base-path.js';
import { registerIconLibrary } from '@shoelace-style/shoelace/dist/utilities/icon-library.js';

import '@shoelace-style/shoelace/dist/components/badge/badge.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

import { fetchCorpus, fetchDiagramSource, fetchRecords, recordKey, saveRecords } from './api.js';
import type { CorpusEntry, LabRecord } from './api.js';
import { COLUMNS, compareRows, fmtRatio } from './columns.js';
import type { Row } from './columns.js';
import { tryRunDiagram } from './runner.js';

/**
 * Layouts the lab can measure. Every one of these routes through the shared
 * layout renderer, which is what makes the position capture available — a
 * layout that did not would render fine and measure as an error.
 */
const LAB_LAYOUTS = [
  'dagre',
  'elk',
  'domus',
  'ipsep-cola',
  'stress-and-grid',
  'hola',
  'swimlane',
] as const;

const SCORE_MIN = 0;
const SCORE_MAX = 10;
/** Records are flushed in batches during a sweep so a long run is never lost. */
const SAVE_BATCH = 20;

function readUrlParam(name: string): string | null {
  return new URL(window.location.href).searchParams.get(name);
}

function setUrlParams(pairs: Record<string, string | null>): void {
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(pairs)) {
    if (value === null || value === '') {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  history.replaceState(null, '', url);
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows and blocked site data: a remembered filter is not worth failing over.
  }
}

export class DiagramLabApp extends LitElement {
  static properties = {
    entries: { state: true },
    records: { state: true },
    layout: { state: true },
    typeFilter: { state: true },
    search: { state: true },
    onlyUnscored: { state: true },
    sortKey: { state: true },
    sortDirection: { state: true },
    selectedPath: { state: true },
    previewSvg: { state: true },
    previewError: { state: true },
    previewBusy: { state: true },
    sweepState: { state: true },
    sweepDone: { state: true },
    sweepTotal: { state: true },
    sweepCurrent: { state: true },
    status: { state: true },
    notesDraft: { state: true },
  };

  declare entries: CorpusEntry[];
  declare records: Record<string, LabRecord>;
  declare layout: string;
  declare typeFilter: string;
  declare search: string;
  declare onlyUnscored: boolean;
  declare sortKey: string;
  declare sortDirection: 1 | -1;
  declare selectedPath: string;
  declare previewSvg: string;
  declare previewError: string;
  declare previewBusy: boolean;
  declare sweepState: 'idle' | 'running';
  declare sweepDone: number;
  declare sweepTotal: number;
  declare sweepCurrent: string;
  declare status: string;
  declare notesDraft: string;

  #events?: EventSource;
  #cancelSweep = false;

  constructor() {
    super();
    this.entries = [];
    this.records = {};
    this.layout = readUrlParam('layout') ?? readStorage('lab.layout') ?? 'dagre';
    this.typeFilter = readUrlParam('type') ?? readStorage('lab.type') ?? 'flowchart';
    this.search = readUrlParam('q') ?? '';
    this.onlyUnscored = readStorage('lab.onlyUnscored') === '1';
    this.sortKey = readStorage('lab.sortKey') ?? 'diagram';
    this.sortDirection = readStorage('lab.sortDir') === '-1' ? -1 : 1;
    this.selectedPath = readUrlParam('file') ?? '';
    this.previewSvg = '';
    this.previewError = '';
    this.previewBusy = false;
    this.sweepState = 'idle';
    this.sweepDone = 0;
    this.sweepTotal = 0;
    this.sweepCurrent = '';
    this.status = '';
    this.notesDraft = '';

    setBasePath('/vendor/shoelace');
    registerIconLibrary('default', {
      resolver: (name) => `/vendor/shoelace/assets/icons/${name}.svg`,
    });
  }

  createRenderRoot() {
    // Light DOM so the stylesheet in public/styles.css reaches the table.
    return this;
  }

  connectedCallback(): void {
    super.connectedCallback();
    void this.#load();
    this.#events = new EventSource('/events');
    this.#events.onmessage = () => {
      // A rebuild replaced the Mermaid bundle under us; a reload is the only
      // way to pick it up, and mid-sweep is the one time that is unwelcome.
      if (this.sweepState === 'idle') {
        window.location.reload();
      }
    };
    window.addEventListener('keydown', this.#onKeyDown);
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#events?.close();
    window.removeEventListener('keydown', this.#onKeyDown);
  }

  // ── Data ───────────────────────────────────────────────────────────────────

  async #load(): Promise<void> {
    try {
      const [corpus, records] = await Promise.all([fetchCorpus(), fetchRecords()]);
      this.entries = corpus.entries;
      this.records = records.records;
      this.status = `${corpus.entries.length} diagrams under ${corpus.root}`;
      if (this.selectedPath) {
        void this.#renderSelected();
      }
    } catch (e) {
      this.status = `Load failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  get #rows(): Row[] {
    const needle = this.search.trim().toLowerCase();
    const rows: Row[] = [];
    for (const entry of this.entries) {
      if (this.typeFilter !== 'all' && entry.diagramType !== this.typeFilter) {
        continue;
      }
      if (needle && !entry.path.toLowerCase().includes(needle)) {
        continue;
      }
      const record = this.records[recordKey(entry.path, this.layout)];
      if (this.onlyUnscored && record?.score !== undefined && record.score !== null) {
        continue;
      }
      rows.push({ entry, record, metrics: record?.metrics });
    }
    return rows.sort((a, b) => compareRows(a, b, this.sortKey, this.sortDirection));
  }

  get #diagramTypes(): string[] {
    return [...new Set(this.entries.map((entry) => entry.diagramType))].sort();
  }

  #selectedRow(): Row | undefined {
    return this.#rows.find((row) => row.entry.path === this.selectedPath);
  }

  #applyRecords(saved: LabRecord[]): void {
    const next = { ...this.records };
    for (const record of saved) {
      next[recordKey(record.diagram, record.layout)] = record;
    }
    this.records = next;
  }

  // ── Measuring ──────────────────────────────────────────────────────────────

  /** Measure one diagram, store the result, and optionally keep the SVG. */
  async #measure(entry: CorpusEntry, keepSvg: boolean): Promise<LabRecord> {
    const source = await fetchDiagramSource(entry.path);
    const outcome = await tryRunDiagram(source, this.layout);

    const record: LabRecord = outcome.ok
      ? {
          diagram: entry.path,
          layout: this.layout,
          diagramType: entry.diagramType,
          metrics: outcome.result.metrics,
          metricsAt: new Date().toISOString(),
          metricsError: undefined,
        }
      : {
          diagram: entry.path,
          layout: this.layout,
          diagramType: entry.diagramType,
          metricsError: outcome.error,
          metricsAt: new Date().toISOString(),
        };

    if (keepSvg) {
      this.previewSvg = outcome.ok ? outcome.result.svg : '';
      this.previewError = outcome.ok ? '' : outcome.error;
    }
    return record;
  }

  async #renderSelected(): Promise<void> {
    const entry = this.entries.find((e) => e.path === this.selectedPath);
    if (!entry) {
      return;
    }
    this.previewBusy = true;
    this.previewSvg = '';
    this.previewError = '';
    try {
      const record = await this.#measure(entry, true);
      const saved = await saveRecords([record]);
      this.#applyRecords(saved);
      this.notesDraft = saved[0]?.notes ?? '';
    } catch (e) {
      this.previewError = e instanceof Error ? e.message : String(e);
    } finally {
      this.previewBusy = false;
    }
  }

  async #sweep(recomputeMeasured: boolean): Promise<void> {
    if (this.sweepState === 'running') {
      return;
    }
    const targets = this.#rows
      .map((row) => row.entry)
      .filter((entry) => {
        if (recomputeMeasured) {
          return true;
        }
        const record = this.records[recordKey(entry.path, this.layout)];
        return !record?.metrics && !record?.metricsError;
      });

    if (targets.length === 0) {
      this.status = 'Nothing to measure — every visible row already has metrics.';
      return;
    }

    this.#cancelSweep = false;
    this.sweepState = 'running';
    this.sweepTotal = targets.length;
    this.sweepDone = 0;

    let pending: LabRecord[] = [];
    let failures = 0;
    try {
      for (const entry of targets) {
        if (this.#cancelSweep) {
          break;
        }
        this.sweepCurrent = entry.path;
        try {
          const record = await this.#measure(entry, false);
          if (record.metricsError) {
            failures++;
          }
          pending.push(record);
        } catch (e) {
          failures++;
          pending.push({
            diagram: entry.path,
            layout: this.layout,
            diagramType: entry.diagramType,
            metricsError: e instanceof Error ? e.message : String(e),
            metricsAt: new Date().toISOString(),
          });
        }
        this.sweepDone++;
        if (pending.length >= SAVE_BATCH) {
          this.#applyRecords(await saveRecords(pending));
          pending = [];
        }
      }
      if (pending.length > 0) {
        this.#applyRecords(await saveRecords(pending));
      }
      const verb = this.#cancelSweep ? 'Stopped after' : 'Measured';
      this.status = `${verb} ${this.sweepDone}/${targets.length} with layout "${this.layout}"${
        failures > 0 ? ` — ${failures} failed` : ''
      }.`;
    } catch (e) {
      this.status = `Sweep failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.sweepState = 'idle';
      this.sweepCurrent = '';
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  async #setScore(entry: CorpusEntry, score: number | null, notes?: string): Promise<void> {
    const record: LabRecord = {
      diagram: entry.path,
      layout: this.layout,
      diagramType: entry.diagramType,
      score,
      notes: notes ?? this.records[recordKey(entry.path, this.layout)]?.notes ?? '',
      scoredAt: new Date().toISOString(),
    };
    try {
      this.#applyRecords(await saveRecords([record]));
      this.status = score === null ? `Cleared score for ${entry.name}` : `${entry.name} → ${score}`;
    } catch (e) {
      this.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  #onKeyDown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement | null;
    const tag = target?.tagName?.toLowerCase() ?? '';
    if (
      tag === 'input' ||
      tag === 'textarea' ||
      tag.startsWith('sl-input') ||
      tag.startsWith('sl-textarea') ||
      tag.startsWith('sl-select') ||
      target?.isContentEditable
    ) {
      return;
    }

    const rows = this.#rows;
    const index = rows.findIndex((row) => row.entry.path === this.selectedPath);

    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      this.#select(rows[Math.min(rows.length - 1, index + 1)]);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      this.#select(rows[Math.max(0, index - 1)]);
      return;
    }
    if (index < 0) {
      return;
    }
    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      void this.#setScore(rows[index].entry, Number(event.key));
      return;
    }
    // Shift+0 is the only way to reach the top of a single-keystroke 0–10 scale.
    if (event.key === ')' || (event.key === '0' && event.shiftKey)) {
      event.preventDefault();
      void this.#setScore(rows[index].entry, SCORE_MAX);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      void this.#setScore(rows[index].entry, null);
    }
  };

  #select(row: Row | undefined): void {
    if (!row || row.entry.path === this.selectedPath) {
      return;
    }
    this.selectedPath = row.entry.path;
    this.notesDraft = row.record?.notes ?? '';
    setUrlParams({ file: row.entry.path });
    void this.#renderSelected();
  }

  #toggleSort(key: string): void {
    if (this.sortKey === key) {
      this.sortDirection = this.sortDirection === 1 ? -1 : 1;
    } else {
      this.sortKey = key;
      this.sortDirection = 1;
    }
    writeStorage('lab.sortKey', this.sortKey);
    writeStorage('lab.sortDir', String(this.sortDirection));
  }

  #setLayout(layout: string): void {
    this.layout = layout;
    writeStorage('lab.layout', layout);
    setUrlParams({ layout });
    this.notesDraft = this.#selectedRow()?.record?.notes ?? '';
    if (this.selectedPath) {
      void this.#renderSelected();
    }
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render(): TemplateResult {
    return html`
      <div class="lab">
        ${this.#renderToolbar()}
        <sl-split-panel class="lab-split" position="58">
          <div slot="start" class="table-pane">${this.#renderTable()}</div>
          <div slot="end" class="detail-pane">${this.#renderDetail()}</div>
        </sl-split-panel>
        ${this.#renderStatusBar()}
      </div>
    `;
  }

  #renderToolbar(): TemplateResult {
    const sweeping = this.sweepState === 'running';
    return html`
      <div class="toolbar">
        <div class="brand">Diagram Lab</div>

        <label class="control">
          <span>Layout</span>
          <sl-select
            size="small"
            value=${this.layout}
            ?disabled=${sweeping}
            @sl-change=${(e: Event) => this.#setLayout((e.target as HTMLInputElement).value)}
          >
            ${LAB_LAYOUTS.map((name) => html`<sl-option value=${name}>${name}</sl-option>`)}
          </sl-select>
        </label>

        <label class="control">
          <span>Diagram type</span>
          <sl-select
            size="small"
            value=${this.typeFilter}
            @sl-change=${(e: Event) => {
              this.typeFilter = (e.target as HTMLInputElement).value;
              writeStorage('lab.type', this.typeFilter);
              setUrlParams({ type: this.typeFilter });
            }}
          >
            <sl-option value="all">all</sl-option>
            ${this.#diagramTypes.map((type) => html`<sl-option value=${type}>${type}</sl-option>`)}
          </sl-select>
        </label>

        <label class="control grow">
          <span>Filter</span>
          <sl-input
            size="small"
            placeholder="path contains…"
            clearable
            value=${this.search}
            @sl-input=${(e: Event) => {
              this.search = (e.target as HTMLInputElement).value;
              setUrlParams({ q: this.search });
            }}
          ></sl-input>
        </label>

        <sl-checkbox
          size="small"
          ?checked=${this.onlyUnscored}
          @sl-change=${(e: Event) => {
            this.onlyUnscored = (e.target as HTMLInputElement).checked;
            writeStorage('lab.onlyUnscored', this.onlyUnscored ? '1' : '0');
          }}
          >unscored only</sl-checkbox
        >

        <div class="spacer"></div>

        ${sweeping
          ? html`<sl-button
              size="small"
              variant="danger"
              @click=${() => (this.#cancelSweep = true)}
            >
              Stop
            </sl-button>`
          : html`
              <sl-button size="small" variant="primary" @click=${() => void this.#sweep(false)}>
                Measure missing
              </sl-button>
              <sl-button size="small" @click=${() => void this.#sweep(true)}
                >Re-measure all</sl-button
              >
            `}
        <sl-button size="small" href=${`/api/export.csv?layout=${encodeURIComponent(this.layout)}`}>
          Export CSV
        </sl-button>
      </div>
    `;
  }

  #renderTable(): TemplateResult {
    const rows = this.#rows;
    return html`
      <div class="table-scroll">
        <table class="metrics-table">
          <thead>
            <tr>
              ${COLUMNS.map(
                (column) => html`
                  <th
                    class=${column.numeric ? 'num' : ''}
                    title=${column.title}
                    @click=${() => this.#toggleSort(column.key)}
                  >
                    ${column.label}
                    ${this.sortKey === column.key
                      ? html`<span class="sort">${this.sortDirection === 1 ? '▲' : '▼'}</span>`
                      : nothing}
                  </th>
                `
              )}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => this.#renderRow(row))}
          </tbody>
        </table>
        ${rows.length === 0
          ? html`<div class="empty">No diagrams match the current filters.</div>`
          : nothing}
      </div>
    `;
  }

  #renderRow(row: Row): TemplateResult {
    const selected = row.entry.path === this.selectedPath;
    const failed = Boolean(row.record?.metricsError);
    return html`
      <tr
        class=${[selected ? 'selected' : '', failed ? 'failed' : ''].filter(Boolean).join(' ')}
        @click=${() => this.#select(row)}
      >
        ${COLUMNS.map((column) => {
          if (column.key === 'score') {
            return html`<td class="num score-cell">${this.#renderScoreInput(row)}</td>`;
          }
          if (column.key === 'diagram') {
            return html`<td class="path-cell" title=${row.entry.path}>
              ${row.entry.dir ? html`<span class="dir">${row.entry.dir}/</span>` : nothing}<span
                class="name"
                >${row.entry.name}</span
              >
              ${failed
                ? html`<sl-badge variant="danger" pill title=${row.record?.metricsError ?? ''}
                    >error</sl-badge
                  >`
                : nothing}
            </td>`;
          }
          const extra = column.cellClass?.(row) ?? '';
          return html`<td class=${[column.numeric ? 'num' : '', extra].filter(Boolean).join(' ')}>
            ${column.text(row)}
          </td>`;
        })}
      </tr>
    `;
  }

  #renderScoreInput(row: Row): TemplateResult {
    const value = row.record?.score;
    return html`
      <input
        class="score-input"
        type="number"
        min=${SCORE_MIN}
        max=${SCORE_MAX}
        step="1"
        .value=${value === null || value === undefined ? '' : String(value)}
        @click=${(e: Event) => e.stopPropagation()}
        @change=${(e: Event) => {
          const raw = (e.target as HTMLInputElement).value.trim();
          if (raw === '') {
            void this.#setScore(row.entry, null);
            return;
          }
          const parsed = Number(raw);
          if (!Number.isFinite(parsed)) {
            return;
          }
          void this.#setScore(
            row.entry,
            Math.min(SCORE_MAX, Math.max(SCORE_MIN, Math.round(parsed)))
          );
        }}
      />
    `;
  }

  #renderDetail(): TemplateResult {
    const row = this.#selectedRow();
    if (!row) {
      return html`<div class="detail-empty">
        Pick a row to render it and score it.
        <div class="hint">
          <kbd>↑</kbd>/<kbd>↓</kbd> move · <kbd>0</kbd>–<kbd>9</kbd> score · <kbd>Shift</kbd>+<kbd
            >0</kbd
          >
          = 10 · <kbd>⌫</kbd> clear
        </div>
      </div>`;
    }

    return html`
      <div class="detail">
        <div class="detail-head">
          <div class="detail-title" title=${row.entry.path}>${row.entry.path}</div>
          <sl-badge variant="neutral" pill>${this.layout}</sl-badge>
          <div class="spacer"></div>
          <sl-button
            size="small"
            ?loading=${this.previewBusy}
            @click=${() => void this.#renderSelected()}
          >
            Re-run
          </sl-button>
        </div>

        <div class="diagram-frame">
          ${this.previewError
            ? html`<pre class="render-error">${this.previewError}</pre>`
            : this.previewSvg
              ? unsafeHTML(this.previewSvg)
              : html`<div class="detail-empty">${this.previewBusy ? 'Rendering…' : ''}</div>`}
        </div>

        ${this.#renderScorePanel(row)} ${this.#renderMetricsDetail(row)}
      </div>
    `;
  }

  #renderScorePanel(row: Row): TemplateResult {
    const score = row.record?.score;
    return html`
      <div class="score-panel">
        <div class="score-buttons">
          ${Array.from({ length: SCORE_MAX - SCORE_MIN + 1 }, (_, i) => i + SCORE_MIN).map(
            (value) => html`
              <button
                type="button"
                class=${value === score ? 'score-chip active' : 'score-chip'}
                @click=${() => void this.#setScore(row.entry, value)}
              >
                ${value}
              </button>
            `
          )}
          <button
            type="button"
            class="score-chip clear"
            title="Clear score"
            @click=${() => void this.#setScore(row.entry, null)}
          >
            ✕
          </button>
        </div>
        <sl-textarea
          size="small"
          rows="2"
          placeholder="notes on this diagram/layout pair…"
          resize="none"
          .value=${this.notesDraft}
          @sl-input=${(e: Event) => (this.notesDraft = (e.target as HTMLInputElement).value)}
          @sl-blur=${() => void this.#setScore(row.entry, score ?? null, this.notesDraft)}
        ></sl-textarea>
      </div>
    `;
  }

  #renderMetricsDetail(row: Row): TemplateResult {
    const metrics = row.metrics;
    if (!metrics) {
      return html`<div class="metrics-detail muted">
        ${row.record?.metricsError ?? 'Not measured yet.'}
      </div>`;
    }
    const cells: [string, string][] = [
      ['nodes', String(metrics.nodeCount)],
      ['edges', String(metrics.edgeCount)],
      ['edges / node', fmtRatio(metrics.edgeNodeRatio)],
      ['degree max', String(metrics.degreeMax)],
      ['degree median', fmtRatio(metrics.degreeMedian, 1)],
      ['labelled edges', fmtRatio(metrics.labeledEdgeRatio, 2)],
      ['non-planar', metrics.nonPlanar ? 'yes' : 'no'],
      ['tree', metrics.isTree ? 'yes' : metrics.isForest ? 'forest' : 'no'],
      ['components', String(metrics.componentCount)],
      ['subgraphs', String(metrics.groupCount)],
      ['pierced frames', `${metrics.subgraphBoundaryEdgeCount} edge(s)`],
      ['stress (norm.)', fmtRatio(metrics.stressNormalized, 4)],
      ['stress', fmtRatio(metrics.stress, 1)],
      ['ideal edge len', fmtRatio(metrics.stressOptimalEdgeLength, 1)],
      [
        'stress covers',
        metrics.stressNodeCount === null
          ? '—'
          : `${metrics.stressNodeCount} / ${metrics.nodeCount + metrics.groupCount} nodes`,
      ],
      [
        'drawing',
        metrics.drawingWidth === null || metrics.drawingHeight === null
          ? '—'
          : `${Math.round(metrics.drawingWidth)} × ${Math.round(metrics.drawingHeight)} px`,
      ],
    ];
    return html`
      <div class="metrics-detail">
        ${cells.map(
          ([label, value]) => html`
            <div class="metric">
              <span class="metric-label">${label}</span>
              <span class="metric-value">${value}</span>
            </div>
          `
        )}
        ${metrics.piercedSubgraphIds.length > 0
          ? html`<div class="metric wide">
              <span class="metric-label">pierced subgraphs</span>
              <span class="metric-value">${metrics.piercedSubgraphIds.join(', ')}</span>
            </div>`
          : nothing}
      </div>
    `;
  }

  #renderStatusBar(): TemplateResult {
    const sweeping = this.sweepState === 'running';
    const scored = Object.values(this.records).filter(
      (record) =>
        record.layout === this.layout && record.score !== null && record.score !== undefined
    ).length;
    return html`
      <div class="status-bar">
        ${sweeping
          ? html`<span class="sweep"
              >Measuring ${this.sweepDone}/${this.sweepTotal} — ${this.sweepCurrent}</span
            >`
          : html`<span>${this.status}</span>`}
        <div class="spacer"></div>
        <span class="muted">${this.#rows.length} rows · ${scored} scored on ${this.layout}</span>
      </div>
    `;
  }
}

customElements.define('diagram-lab-app', DiagramLabApp);
