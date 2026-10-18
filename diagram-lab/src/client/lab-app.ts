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
import '@shoelace-style/shoelace/dist/components/dialog/dialog.js';
import '@shoelace-style/shoelace/dist/components/button/button.js';
import '@shoelace-style/shoelace/dist/components/checkbox/checkbox.js';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';
import '@shoelace-style/shoelace/dist/components/input/input.js';
import '@shoelace-style/shoelace/dist/components/option/option.js';
import '@shoelace-style/shoelace/dist/components/select/select.js';
import '@shoelace-style/shoelace/dist/components/split-panel/split-panel.js';
import '@shoelace-style/shoelace/dist/components/switch/switch.js';
import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

// The Dev Explorer's CodeMirror wrapper, imported rather than copied.
//
// It is a generic Mermaid editor — syntax highlighting, history, a save
// keybinding — with nothing explorer-specific in it, and the alternative is a
// second copy of a 70-line highlight theme that would quietly drift from this
// one. Read-only reuse, the same arrangement as the esbuild build config this
// server borrows. Fork it here if the Dev Explorer's version ever grows
// behaviour the lab does not want.
import '../../../.esbuild/dev-explorer/code-editor.js';

import {
  deleteDiagram,
  fetchConfig,
  fetchCorpus,
  fetchDiagramSource,
  fetchStore,
  recordKey,
  renameDiagram,
  saveDiagramSource,
  saveToStore,
} from './api.js';
import type { CorpusEntry, DiagramStructureRecord, LayoutRecord } from './api.js';
import { mergeMetrics, splitMetrics } from '../metrics/index.js';
import { COLUMNS, compareRows, fmtRatio } from './columns.js';
import type { Row } from './columns.js';
import { tryRunDiagram } from './runner.js';

/**
 * Which layouts the lab offers comes from `diagram-lab/layouts.json`, not from
 * here — narrowing the set is a config edit, not a code edit. This is only the
 * fallback used before that config has arrived.
 */
const FALLBACK_LAYOUTS = ['dagre', 'elk'];

/**
 * Looks and themes on offer, mirroring the enums in `config.schema.yaml`.
 *
 * Unlike the layouts these are not server config: they are Mermaid's own fixed
 * sets, so a stale copy here would offer a value Mermaid rejects. Kept in the
 * schema's order so the lists read the same in both places.
 */
const LOOKS = ['classic', 'handDrawn', 'neo'];
const THEMES = [
  'default',
  'base',
  'dark',
  'forest',
  'neutral',
  'neo',
  'neo-dark',
  'redux',
  'redux-dark',
  'redux-color',
  'redux-dark-color',
];

const SCORE_MIN = 0;
const SCORE_MAX = 10;
/** Records are flushed in batches during a sweep so a long run is never lost. */
const SAVE_BATCH = 20;

function readUrlParam(name: string): string | null {
  return new URL(window.location.href).searchParams.get(name);
}

/**
 * First allowed value, or the stored/URL one when it is on the list.
 *
 * A hand-edited URL or a value left over from an older build must not reach
 * `mermaid.initialize`, which would reject it and fail every render with an
 * error that points nowhere near the cause.
 */
function pickFrom(allowed: string[], candidate: string | null): string {
  return candidate !== null && allowed.includes(candidate) ? candidate : allowed[0];
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
    layouts: { state: true },
    corpusRoot: { state: true },
    structures: { state: true },
    records: { state: true },
    layout: { state: true },
    look: { state: true },
    theme: { state: true },
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
    renaming: { state: true },
    renameDraft: { state: true },
    confirmingDelete: { state: true },
    fileBusy: { state: true },
    showCode: { state: true },
    source: { state: true },
    sourceDraft: { state: true },
    savingSource: { state: true },
  };

  declare entries: CorpusEntry[];
  /** Layouts on offer, from the server's config. */
  declare layouts: string[];
  declare corpusRoot: string;
  /** Layout-independent half, keyed by diagram path. */
  declare structures: Record<string, DiagramStructureRecord>;
  /** Layout-dependent half plus scores, keyed by `layout::diagram`. */
  declare records: Record<string, LayoutRecord>;
  declare layout: string;
  /**
   * Render settings the measurements are taken under. Both change node sizing,
   * and so change every geometric metric in the table — see `#setRenderSetting`
   * for what that means for rows measured under a different pair.
   */
  declare look: string;
  declare theme: string;
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
  declare renaming: boolean;
  declare renameDraft: string;
  declare confirmingDelete: boolean;
  declare fileBusy: boolean;
  declare showCode: boolean;
  /** The diagram source as it is on disk. */
  declare source: string;
  /** What is in the editor, which may be ahead of the file. */
  declare sourceDraft: string;
  declare savingSource: boolean;

  #events?: EventSource;
  #cancelSweep = false;

  get #sourceDirty(): boolean {
    return this.sourceDraft !== this.source;
  }

  constructor() {
    super();
    this.entries = [];
    this.layouts = [...FALLBACK_LAYOUTS];
    this.corpusRoot = '';
    this.structures = {};
    this.records = {};
    this.layout = readUrlParam('layout') ?? readStorage('lab.layout') ?? FALLBACK_LAYOUTS[0];
    this.look = pickFrom(LOOKS, readUrlParam('look') ?? readStorage('lab.look'));
    this.theme = pickFrom(THEMES, readUrlParam('theme') ?? readStorage('lab.theme'));
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
    this.renaming = false;
    this.renameDraft = '';
    this.confirmingDelete = false;
    this.fileBusy = false;
    this.showCode = readStorage('lab.showCode') === '1';
    this.source = '';
    this.sourceDraft = '';
    this.savingSource = false;

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
      const [config, corpus, store] = await Promise.all([
        fetchConfig(),
        fetchCorpus(),
        fetchStore(),
      ]);
      this.layouts = config.layouts.length > 0 ? config.layouts : [...FALLBACK_LAYOUTS];
      // A layout remembered from a previous session may have since been filtered
      // out of layouts.json; fall back rather than leaving the bar with nothing
      // selected and every row unmeasurable.
      let clampedFrom: string | undefined;
      if (!this.layouts.includes(this.layout)) {
        clampedFrom = this.layout;
        this.layout = this.layouts[0];
        writeStorage('lab.layout', this.layout);
        setUrlParams({ layout: this.layout });
      }
      this.entries = corpus.entries;
      this.corpusRoot = corpus.rootAbs || corpus.root;
      this.structures = store.diagrams ?? {};
      this.records = store.records ?? {};
      this.status = clampedFrom
        ? `Layout "${clampedFrom}" is not in layouts.json — switched to "${this.layout}".`
        : `${corpus.entries.length} diagram(s) in ${corpus.root}`;
      // A deep link (?file=…) lands here with nothing loaded yet; a reload
      // triggered by a save already has both, so neither is redone.
      if (this.selectedPath && !this.source) {
        void this.#loadSource(this.selectedPath);
      }
      if (this.selectedPath && !this.previewSvg && !this.previewBusy) {
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
      rows.push(this.#buildRow(entry, record));
    }
    return rows.sort((a, b) => compareRows(a, b, this.sortKey, this.sortDirection));
  }

  /**
   * Recombine the stored halves for one corpus entry.
   *
   * Structure comes from the per-diagram half, so it is already there when the
   * layout changes; only the layout-dependent fields wait on a run under the
   * newly selected layout.
   */
  #buildRow(entry: CorpusEntry, record: LayoutRecord | undefined): Row {
    const structure = this.structures[entry.path];
    return {
      entry,
      structure,
      record,
      metrics: mergeMetrics(structure?.structure, record?.layoutMetrics),
      structureStale: Boolean(
        structure?.structure && structure.sourceHash && structure.sourceHash !== entry.sourceHash
      ),
      layoutStale: Boolean(
        record?.layoutMetrics && record.sourceHash && record.sourceHash !== entry.sourceHash
      ),
    };
  }

  get #diagramTypes(): string[] {
    return [...new Set(this.entries.map((entry) => entry.diagramType))].sort();
  }

  #selectedRow(): Row | undefined {
    return this.#rows.find((row) => row.entry.path === this.selectedPath);
  }

  #applySaved(saved: { diagrams?: DiagramStructureRecord[]; records?: LayoutRecord[] }): void {
    if (saved.diagrams?.length) {
      const next = { ...this.structures };
      for (const structure of saved.diagrams) {
        next[structure.diagram] = structure;
      }
      this.structures = next;
    }
    if (saved.records?.length) {
      const next = { ...this.records };
      for (const record of saved.records) {
        next[recordKey(record.diagram, record.layout)] = record;
      }
      this.records = next;
    }
  }

  // ── Measuring ──────────────────────────────────────────────────────────────

  /**
   * Measure one diagram under the current layout.
   *
   * One render yields both halves: the structural metrics (which belong to the
   * diagram) and the layout-dependent ones (which belong to this pair). Both
   * carry the source hash they were measured from, so a later edit to the
   * `.mmd` marks them stale rather than leaving them quietly wrong.
   */
  async #measure(
    entry: CorpusEntry,
    keepSvg: boolean
  ): Promise<{ structure?: DiagramStructureRecord; record: LayoutRecord }> {
    const source = await fetchDiagramSource(entry.path);
    const outcome = await tryRunDiagram(source, this.layout, {
      look: this.look,
      theme: this.theme,
    });
    const at = new Date().toISOString();

    if (keepSvg) {
      this.previewSvg = outcome.ok ? outcome.result.svg : '';
      this.previewError = outcome.ok ? '' : outcome.error;
    }

    if (!outcome.ok) {
      return {
        record: {
          diagram: entry.path,
          layout: this.layout,
          sourceHash: entry.sourceHash,
          metricsError: outcome.error,
          metricsAt: at,
        },
      };
    }

    const { structural, layout } = splitMetrics(outcome.result.metrics);
    return {
      structure: {
        diagram: entry.path,
        diagramType: entry.diagramType,
        sourceHash: entry.sourceHash,
        structure: structural,
        structureAt: at,
        measuredWith: this.layout,
      },
      record: {
        diagram: entry.path,
        layout: this.layout,
        sourceHash: entry.sourceHash,
        layoutMetrics: layout,
        metricsAt: at,
        metricsError: undefined,
      },
    };
  }

  /** Pull the file into the editor. Always from disk, never from a stale draft. */
  async #loadSource(path: string): Promise<void> {
    try {
      const text = await fetchDiagramSource(path);
      this.source = text;
      this.sourceDraft = text;
    } catch (e) {
      this.status = `Could not read source: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  /**
   * Write the editor's contents back and re-measure.
   *
   * The render deliberately runs off the *saved* file rather than the draft: a
   * metric recorded for text that is not on disk would not match the source
   * hash stored beside it, and the staleness check would then be lying.
   */
  async #saveSource(entry: CorpusEntry): Promise<void> {
    if (!this.#sourceDirty) {
      return;
    }
    this.savingSource = true;
    try {
      await saveDiagramSource(entry.path, this.sourceDraft);
      this.source = this.sourceDraft;
      // Re-read the corpus so the entry carries the new hash; otherwise the
      // measurement we are about to take would be stamped with the old one.
      await this.#load();
      this.status = `Saved ${entry.path}`;
      await this.#renderSelected();
    } catch (e) {
      this.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.savingSource = false;
    }
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
      const { structure, record } = await this.#measure(entry, true);
      const saved = await saveToStore({
        diagrams: structure ? [structure] : [],
        records: [record],
      });
      this.#applySaved(saved);
      this.notesDraft = saved.records[0]?.notes ?? '';
    } catch (e) {
      this.previewError = e instanceof Error ? e.message : String(e);
    } finally {
      this.previewBusy = false;
    }
  }

  /** Whether this row still needs a run under the currently selected layout. */
  #needsMeasure(row: Row): boolean {
    if (row.structureStale || row.layoutStale) {
      return true;
    }
    if (!row.structure?.structure) {
      return true;
    }
    return !row.record?.layoutMetrics && !row.record?.metricsError;
  }

  async #sweep(recomputeMeasured: boolean): Promise<void> {
    if (this.sweepState === 'running') {
      return;
    }
    const targets = this.#rows
      .filter((row) => recomputeMeasured || this.#needsMeasure(row))
      .map((row) => row.entry);

    if (targets.length === 0) {
      this.status = `Nothing to measure — every visible row has metrics for "${this.layout}".`;
      return;
    }

    this.#cancelSweep = false;
    this.sweepState = 'running';
    this.sweepTotal = targets.length;
    this.sweepDone = 0;

    let pendingStructures: DiagramStructureRecord[] = [];
    let pendingRecords: LayoutRecord[] = [];
    let failures = 0;

    const flush = async () => {
      if (pendingStructures.length === 0 && pendingRecords.length === 0) {
        return;
      }
      this.#applySaved(await saveToStore({ diagrams: pendingStructures, records: pendingRecords }));
      pendingStructures = [];
      pendingRecords = [];
    };

    try {
      for (const entry of targets) {
        if (this.#cancelSweep) {
          break;
        }
        this.sweepCurrent = entry.path;
        try {
          const { structure, record } = await this.#measure(entry, false);
          if (record.metricsError) {
            failures++;
          }
          if (structure) {
            pendingStructures.push(structure);
          }
          pendingRecords.push(record);
        } catch (e) {
          failures++;
          pendingRecords.push({
            diagram: entry.path,
            layout: this.layout,
            sourceHash: entry.sourceHash,
            metricsError: e instanceof Error ? e.message : String(e),
            metricsAt: new Date().toISOString(),
          });
        }
        this.sweepDone++;
        if (pendingRecords.length >= SAVE_BATCH) {
          await flush();
        }
      }
      await flush();
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

  // ── File operations ────────────────────────────────────────────────────────

  async #commitRename(entry: CorpusEntry): Promise<void> {
    const name = this.renameDraft.trim();
    if (!name || name === entry.name || name === `${entry.name}.mmd`) {
      this.renaming = false;
      return;
    }
    this.fileBusy = true;
    try {
      const { path: newPath } = await renameDiagram(entry.path, name);
      this.renaming = false;
      // The server moved the store entries across with the file, so a reload
      // brings back the same metrics under the new path.
      await this.#load();
      this.selectedPath = newPath;
      setUrlParams({ file: newPath });
      this.status = `Renamed to ${newPath}`;
    } catch (e) {
      this.status = `Rename failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.fileBusy = false;
    }
  }

  async #commitDelete(entry: CorpusEntry): Promise<void> {
    this.fileBusy = true;
    // Pick the neighbour to land on before the row disappears.
    const rows = this.#rows;
    const index = rows.findIndex((row) => row.entry.path === entry.path);
    const next = rows[index + 1] ?? rows[index - 1];
    try {
      await deleteDiagram(entry.path);
      this.confirmingDelete = false;
      await this.#load();
      const stillThere = this.entries.some((e) => e.path === next?.entry.path);
      this.selectedPath = stillThere ? next.entry.path : '';
      setUrlParams({ file: this.selectedPath });
      this.previewSvg = '';
      this.previewError = '';
      if (this.selectedPath) {
        void this.#renderSelected();
      }
      this.status = `Deleted ${entry.path}`;
    } catch (e) {
      this.status = `Delete failed: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
      this.fileBusy = false;
    }
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  /**
   * Save a judgement: score, acceptable flag, notes, or any combination.
   *
   * Every field is sent explicitly rather than merged client-side, so a save
   * cannot silently drop the other half of what you already recorded.
   */
  async #saveJudgement(
    entry: CorpusEntry,
    patch: { score?: number | null; acceptable?: boolean | null; notes?: string }
  ): Promise<void> {
    const current = this.records[recordKey(entry.path, this.layout)];
    const record: LayoutRecord = {
      diagram: entry.path,
      layout: this.layout,
      score: patch.score === undefined ? (current?.score ?? null) : patch.score,
      acceptable: patch.acceptable === undefined ? (current?.acceptable ?? null) : patch.acceptable,
      notes: patch.notes ?? current?.notes ?? '',
      scoredAt: new Date().toISOString(),
    };
    try {
      this.#applySaved(await saveToStore({ records: [record] }));
    } catch (e) {
      this.status = `Save failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  async #setScore(entry: CorpusEntry, score: number | null, notes?: string): Promise<void> {
    await this.#saveJudgement(entry, { score, notes });
    this.status = score === null ? `Cleared score for ${entry.name}` : `${entry.name} → ${score}`;
  }

  async #setAcceptable(entry: CorpusEntry, acceptable: boolean | null): Promise<void> {
    await this.#saveJudgement(entry, { acceptable });
    this.status =
      acceptable === null
        ? `Cleared acceptable for ${entry.name}`
        : `${entry.name} → ${acceptable ? 'acceptable' : 'not acceptable'}`;
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
    if (event.key === 'a' || event.key === 'A') {
      event.preventDefault();
      // Cycle unset -> acceptable -> not acceptable -> unset, so one key covers
      // the whole judgement without needing a second binding.
      const current = rows[index].record?.acceptable;
      const next = current === true ? false : current === false ? null : true;
      void this.#setAcceptable(rows[index].entry, next);
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
    if (
      this.#sourceDirty &&
      !window.confirm('Discard unsaved changes to the diagram source and switch?')
    ) {
      return;
    }
    this.selectedPath = row.entry.path;
    this.notesDraft = row.record?.notes ?? '';
    this.renaming = false;
    this.source = '';
    this.sourceDraft = '';
    setUrlParams({ file: row.entry.path });
    void this.#loadSource(row.entry.path);
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

  /**
   * Switch look or theme, and re-render what is on screen.
   *
   * Rows measured before the switch keep their old numbers: records are keyed
   * by (diagram, layout) only, so nothing here marks them stale and "Measure
   * missing" will skip them. Say so, because the alternative is a table that
   * silently mixes two sets of settings — "Re-measure all" is the way across.
   */
  #setRenderSetting(key: 'look' | 'theme', value: string): void {
    if (this[key] === value) {
      return;
    }
    this[key] = value;
    writeStorage(`lab.${key}`, value);
    setUrlParams({ [key]: value });
    const measured = Object.keys(this.records).length;
    this.status =
      measured === 0
        ? `Measuring with look "${this.look}", theme "${this.theme}".`
        : `Now measuring with look "${this.look}", theme "${this.theme}" — existing rows were ` +
          `measured under the previous settings. Use "Re-measure all" to bring them across.`;
    if (this.selectedPath) {
      void this.#renderSelected();
    }
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
        ${this.#renderToolbar()} ${this.#renderLayoutBar()}
        <sl-split-panel class="lab-split" position="58">
          <div slot="start" class="table-pane">${this.#renderTable()}</div>
          <div slot="end" class="detail-pane">${this.#renderDetail()}</div>
        </sl-split-panel>
        ${this.#renderStatusBar()}
      </div>
    `;
  }

  /**
   * Per-layout coverage over the rows currently visible.
   *
   * The tool exists to compare layouts, so the picker doubles as the scoreboard:
   * how many of the visible diagrams each layout has been measured on, how many
   * you have scored, and the mean of those scores.
   */
  #layoutSummary(layout: string): {
    measured: number;
    scored: number;
    acceptable: number;
    judged: number;
    meanScore: number | null;
    meanStress: number | null;
    meanValidation: number | null;
    total: number;
  } {
    const rows = this.#rows;
    let measured = 0;
    let acceptable = 0;
    let judged = 0;
    const scores: number[] = [];
    const stresses: number[] = [];
    const validations: number[] = [];
    for (const row of rows) {
      const record = this.records[recordKey(row.entry.path, layout)];
      if (record?.layoutMetrics) {
        measured++;
        const stress = record.layoutMetrics.stressNormalized;
        if (typeof stress === 'number' && Number.isFinite(stress)) {
          stresses.push(stress);
        }
        const validation = record.layoutMetrics.validationScore;
        if (typeof validation === 'number' && Number.isFinite(validation)) {
          validations.push(validation);
        }
      }
      if (typeof record?.score === 'number') {
        scores.push(record.score);
      }
      if (typeof record?.acceptable === 'boolean') {
        judged++;
        if (record.acceptable) {
          acceptable++;
        }
      }
    }
    const mean = (values: number[]) =>
      values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
    return {
      measured,
      scored: scores.length,
      acceptable,
      judged,
      meanScore: mean(scores),
      meanStress: mean(stresses),
      meanValidation: mean(validations),
      total: rows.length,
    };
  }

  #renderLayoutBar(): TemplateResult {
    const sweeping = this.sweepState === 'running';
    return html`
      <div class="layout-bar">
        <span class="layout-bar-label">Layout</span>
        <div class="layout-buttons" role="radiogroup" aria-label="Layout under evaluation">
          ${this.layouts.map((name) => {
            const summary = this.#layoutSummary(name);
            const active = name === this.layout;
            return html`
              <button
                type="button"
                role="radio"
                aria-checked=${active ? 'true' : 'false'}
                class=${active ? 'layout-chip active' : 'layout-chip'}
                ?disabled=${sweeping && !active}
                title=${`${name} — measured on ${summary.measured} of ${summary.total} visible diagram(s)` +
                (summary.meanValidation === null
                  ? ''
                  : `, mean validation ${summary.meanValidation.toFixed(0)}/1000`) +
                (summary.meanStress === null
                  ? ''
                  : `, mean stress ${summary.meanStress.toFixed(3)}`) +
                (summary.judged === 0
                  ? ''
                  : `, acceptable on ${summary.acceptable} of ${summary.judged} judged`) +
                (summary.meanScore === null
                  ? ''
                  : `, mean score ${summary.meanScore.toFixed(1)} over ${summary.scored}`)}
                @click=${() => this.#setLayout(name)}
              >
                <span class="layout-chip-name">${name}</span>
                <span class="layout-chip-stats">
                  <span
                    class=${summary.measured === summary.total && summary.total > 0
                      ? 'complete'
                      : ''}
                    >${summary.measured}/${summary.total}</span
                  >
                  ${summary.meanValidation === null
                    ? nothing
                    : html`<span class="layout-chip-valid"
                        >v ${summary.meanValidation.toFixed(0)}</span
                      >`}
                  ${summary.meanStress === null
                    ? nothing
                    : html`<span class="layout-chip-stress"
                        >σ ${summary.meanStress.toFixed(3)}</span
                      >`}
                  ${summary.judged === 0
                    ? nothing
                    : html`<span class="layout-chip-accept"
                        >✓ ${summary.acceptable}/${summary.judged}</span
                      >`}
                  ${summary.meanScore === null
                    ? nothing
                    : html`<span class="layout-chip-score"
                        >★ ${summary.meanScore.toFixed(1)}</span
                      >`}
                </span>
              </button>
            `;
          })}
        </div>
      </div>
    `;
  }

  #renderToolbar(): TemplateResult {
    const sweeping = this.sweepState === 'running';
    return html`
      <div class="toolbar">
        <div class="brand">Diagram Lab</div>

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

        <label class="control narrow">
          <span>Look</span>
          <sl-select
            size="small"
            value=${this.look}
            ?disabled=${sweeping}
            @sl-change=${(e: Event) =>
              this.#setRenderSetting('look', (e.target as HTMLInputElement).value)}
          >
            ${LOOKS.map((look) => html`<sl-option value=${look}>${look}</sl-option>`)}
          </sl-select>
        </label>

        <label class="control narrow">
          <span>Theme</span>
          <sl-select
            size="small"
            value=${this.theme}
            ?disabled=${sweeping}
            @sl-change=${(e: Event) =>
              this.#setRenderSetting('theme', (e.target as HTMLInputElement).value)}
          >
            ${THEMES.map((theme) => html`<sl-option value=${theme}>${theme}</sl-option>`)}
          </sl-select>
        </label>

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
                    class=${[
                      column.numeric ? 'num' : '',
                      column.layoutDependent ? 'layout-dep' : '',
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    title=${column.layoutDependent
                      ? `${column.title}\n\nDepends on the layout — re-measured per (diagram, layout) pair.`
                      : `${column.title}\n\nProperty of the diagram — kept when you switch layout.`}
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
        ${rows.length === 0 ? this.#renderEmptyState() : nothing}
      </div>
    `;
  }

  #renderEmptyState(): TemplateResult {
    if (this.entries.length === 0) {
      return html`
        <div class="empty">
          <p><strong>No diagrams yet.</strong></p>
          <p>Drop the <code>.mmd</code> files you want to study into:</p>
          <pre class="corpus-path">${this.corpusRoot || 'diagram-lab/diagrams'}</pre>
          <p class="muted">
            One flat folder is the intended shape, but subfolders are picked up too. The list
            refreshes on reload. To study an existing corpus instead, start the server with
            <code>MERMAID_LAB_ROOT=e2e/platform/dev-diagrams pnpm lab</code>.
          </p>
        </div>
      `;
    }
    return html`<div class="empty">No diagrams match the current filters.</div>`;
  }

  #renderRow(row: Row): TemplateResult {
    const selected = row.entry.path === this.selectedPath;
    const failed = Boolean(row.record?.metricsError);
    const stale = row.structureStale || row.layoutStale;
    return html`
      <tr
        class=${[selected ? 'selected' : '', failed ? 'failed' : '', stale ? 'stale' : '']
          .filter(Boolean)
          .join(' ')}
        @click=${() => this.#select(row)}
      >
        ${COLUMNS.map((column) => {
          if (column.key === 'score') {
            return html`<td class="num score-cell">${this.#renderScoreInput(row)}</td>`;
          }
          if (column.key === 'acceptable') {
            return html`<td class="num accept-cell">${this.#renderAcceptToggle(row)}</td>`;
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
              ${stale
                ? html`<sl-badge
                    variant="warning"
                    pill
                    title="The .mmd changed since these numbers were measured"
                    >stale</sl-badge
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

  /** Tri-state, because "not judged yet" and "judged unacceptable" are different answers. */
  #renderAcceptToggle(row: Row): TemplateResult {
    const value = row.record?.acceptable;
    const next = value === true ? false : value === false ? null : true;
    const label = value === true ? '✓' : value === false ? '✗' : '—';
    return html`
      <button
        type="button"
        class=${['accept-toggle', value === true ? 'yes' : value === false ? 'no' : '']
          .filter(Boolean)
          .join(' ')}
        title="Acceptable? click to cycle (unset → yes → no)"
        @click=${(e: Event) => {
          e.stopPropagation();
          void this.#setAcceptable(row.entry, next);
        }}
      >
        ${label}
      </button>
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
          = 10 · <kbd>a</kbd> acceptable · <kbd>⌫</kbd> clear
        </div>
      </div>`;
    }

    return html`
      <div class="detail">
        <div class="detail-head">
          ${this.renaming
            ? html`
                <input
                  class="rename-input"
                  .value=${this.renameDraft}
                  ?disabled=${this.fileBusy}
                  spellcheck="false"
                  autofocus
                  @input=${(e: Event) => (this.renameDraft = (e.target as HTMLInputElement).value)}
                  @keydown=${(e: KeyboardEvent) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void this.#commitRename(row.entry);
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      this.renaming = false;
                    }
                  }}
                />
                <button
                  type="button"
                  class="icon-btn"
                  title="Save name (Enter)"
                  ?disabled=${this.fileBusy}
                  @click=${() => void this.#commitRename(row.entry)}
                >
                  ✓
                </button>
                <button
                  type="button"
                  class="icon-btn"
                  title="Cancel (Esc)"
                  @click=${() => (this.renaming = false)}
                >
                  ✕
                </button>
              `
            : html`
                <button
                  type="button"
                  class="detail-title as-button"
                  title=${`${row.entry.path} — click to rename`}
                  @click=${() => {
                    this.renameDraft = row.entry.name;
                    this.renaming = true;
                  }}
                >
                  ${row.entry.path}<span class="rename-hint">✎</span>
                </button>
              `}
          <sl-badge variant="neutral" pill>${this.layout}</sl-badge>
          ${row.structureStale || row.layoutStale
            ? html`<sl-badge
                variant="warning"
                pill
                title="The .mmd changed since these numbers were measured — re-run to refresh"
                >stale</sl-badge
              >`
            : nothing}
          <div class="spacer"></div>
          <sl-switch
            size="small"
            class="code-switch"
            ?checked=${this.showCode}
            title="Show the diagram source, and edit it"
            @sl-change=${(e: Event) => {
              this.showCode = (e.target as HTMLInputElement).checked;
              writeStorage('lab.showCode', this.showCode ? '1' : '0');
            }}
            >Code</sl-switch
          >
          ${this.showCode && this.#sourceDirty
            ? html`<sl-button
                size="small"
                variant="primary"
                ?loading=${this.savingSource}
                @click=${() => void this.#saveSource(row.entry)}
              >
                Save
              </sl-button>`
            : nothing}
          <sl-button
            size="small"
            ?loading=${this.previewBusy}
            @click=${() => void this.#renderSelected()}
          >
            Re-run
          </sl-button>
          <sl-button
            size="small"
            variant="danger"
            outline
            ?disabled=${this.fileBusy}
            @click=${() => (this.confirmingDelete = true)}
          >
            Delete
          </sl-button>
        </div>

        <sl-dialog
          label="Delete this diagram?"
          ?open=${this.confirmingDelete}
          @sl-request-close=${() => (this.confirmingDelete = false)}
        >
          <p>
            <code>${row.entry.path}</code> will be removed from <code>diagram-lab/diagrams</code>,
            along with every measurement and score recorded for it under any layout.
          </p>
          <p class="muted">This cannot be undone from here.</p>
          <sl-button slot="footer" @click=${() => (this.confirmingDelete = false)}
            >No, keep it</sl-button
          >
          <sl-button
            slot="footer"
            variant="danger"
            ?loading=${this.fileBusy}
            @click=${() => void this.#commitDelete(row.entry)}
          >
            Yes, delete
          </sl-button>
        </sl-dialog>

        ${this.showCode
          ? html`
              <sl-split-panel class="code-split" vertical position="42">
                <div slot="start" class="code-pane">${this.#renderCodeEditor(row)}</div>
                <div slot="end" class="diagram-pane">${this.#renderDiagramFrame()}</div>
              </sl-split-panel>
            `
          : this.#renderDiagramFrame()}
        ${this.#renderLayoutComparison(row)} ${this.#renderScorePanel(row)}
        ${this.#renderMetricsDetail(row)}
      </div>
    `;
  }

  #renderDiagramFrame(): TemplateResult {
    return html`
      <div class="diagram-frame">
        ${this.previewError
          ? html`<pre class="render-error">${this.previewError}</pre>`
          : this.previewSvg
            ? unsafeHTML(this.previewSvg)
            : html`<div class="detail-empty">${this.previewBusy ? 'Rendering…' : ''}</div>`}
      </div>
    `;
  }

  /**
   * The source, editable.
   *
   * Saving is explicit rather than live: the metrics beside the diagram are
   * stamped with the hash of the file on disk, so measuring a draft would record
   * numbers that the staleness check could never verify.
   */
  #renderCodeEditor(row: Row): TemplateResult {
    return html`
      <div class="code-wrap">
        <div class="code-bar">
          <span class="code-path">${row.entry.path}</span>
          <span class=${this.#sourceDirty ? 'code-state dirty' : 'code-state'}>
            ${this.savingSource
              ? 'saving…'
              : this.#sourceDirty
                ? 'unsaved — ⌘S / Ctrl+S to save'
                : 'saved'}
          </span>
          <div class="spacer"></div>
          ${this.#sourceDirty
            ? html`<button
                type="button"
                class="icon-btn"
                title="Discard changes"
                @click=${() => (this.sourceDraft = this.source)}
              >
                Revert
              </button>`
            : nothing}
        </div>
        <dev-code-editor
          class="code-editor"
          .value=${this.sourceDraft}
          @code-change=${(e: CustomEvent<{ value: string }>) => (this.sourceDraft = e.detail.value)}
          @save-code=${() => void this.#saveSource(row.entry)}
        ></dev-code-editor>
      </div>
    `;
  }

  /**
   * How every layout did on *this* diagram.
   *
   * The structural columns are the same on every line by construction, so they
   * are left out: what differs between layouts is the placement, which is
   * exactly `stress` and the drawing box. Clicking a line switches to that
   * layout, so comparing is one click rather than a round trip through a menu.
   */
  #renderLayoutComparison(row: Row): TemplateResult {
    const lines = this.layouts.map((name) => {
      const record = this.records[recordKey(row.entry.path, name)];
      return { name, record, metrics: record?.layoutMetrics };
    });
    const measured = lines.filter((line) => line.metrics);
    // Highlight the calmest drawing, but only when there is something to compare.
    const best =
      measured.length < 2
        ? null
        : measured.reduce((a, b) =>
            (a.metrics?.stressNormalized ?? Infinity) <= (b.metrics?.stressNormalized ?? Infinity)
              ? a
              : b
          ).name;

    return html`
      <div class="layout-compare">
        <div class="layout-compare-head">
          <span>Layouts on this diagram</span>
          <span class="muted">valid · stress · size · score · ok?</span>
        </div>
        ${lines.map(
          ({ name, record, metrics }) => html`
            <button
              type="button"
              class=${[
                'layout-compare-row',
                name === this.layout ? 'active' : '',
                name === best ? 'best' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              title=${name === best ? 'Lowest stress of the measured layouts' : name}
              @click=${() => this.#setLayout(name)}
            >
              <span class="lc-name">${name}</span>
              <span
                class=${['lc-valid', metrics?.validationOk === false ? 'invalid' : '']
                  .filter(Boolean)
                  .join(' ')}
                >${metrics?.validationScore ?? '—'}</span
              >
              <span class="lc-stress">${fmtRatio(metrics?.stressNormalized ?? null, 3)}</span>
              <span class="lc-size"
                >${metrics?.drawingWidth == null || metrics?.drawingHeight == null
                  ? '—'
                  : `${Math.round(metrics.drawingWidth)}×${Math.round(metrics.drawingHeight)}`}</span
              >
              <span class="lc-score">${record?.score ?? '—'}</span>
              ${record?.metricsError
                ? html`<span class="lc-error" title=${record.metricsError}>error</span>`
                : nothing}
            </button>
          `
        )}
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

          <span class="accept-group" title="Is this layout good enough to ship for this diagram?">
            <span class="accept-label">acceptable</span>
            <button
              type="button"
              class=${row.record?.acceptable === true ? 'accept-btn yes active' : 'accept-btn yes'}
              @click=${() => void this.#setAcceptable(row.entry, true)}
            >
              ✓ yes
            </button>
            <button
              type="button"
              class=${row.record?.acceptable === false ? 'accept-btn no active' : 'accept-btn no'}
              @click=${() => void this.#setAcceptable(row.entry, false)}
            >
              ✗ no
            </button>
            <button
              type="button"
              class="accept-btn clear"
              title="Clear"
              @click=${() => void this.#setAcceptable(row.entry, null)}
            >
              ✕
            </button>
          </span>
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
      [
        'validation',
        metrics.validationScore === null
          ? '—'
          : `${metrics.validationScore} / 1000${metrics.validationOk === false ? ' (invalid)' : ''}`,
      ],
      [
        'validator issues',
        metrics.validationIssues === null
          ? '—'
          : `${metrics.validationIssues} (${metrics.validationHardIssues ?? 0} hard)`,
      ],
      ['crossings', metrics.crossings === null ? '—' : String(metrics.crossings)],
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
    const rows = this.#rows;
    const withStructure = rows.filter((row) => row.structure?.structure).length;
    const withLayout = rows.filter((row) => row.record?.layoutMetrics).length;
    return html`
      <div class="status-bar">
        ${sweeping
          ? html`<span class="sweep"
              >Measuring ${this.sweepDone}/${this.sweepTotal} — ${this.sweepCurrent}</span
            >`
          : html`<span>${this.status}</span>`}
        <div class="spacer"></div>
        <span class="muted"
          >${rows.length} rows · ${withStructure} with structure · ${withLayout} measured on
          ${this.layout} · ${scored} scored</span
        >
      </div>
    `;
  }
}

customElements.define('diagram-lab-app', DiagramLabApp);
