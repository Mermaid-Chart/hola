/**
 * Diagram Lab — a standalone dev server for studying diagram/layout pairs.
 *
 * Deliberately *not* wired into `.esbuild/server.ts`: the Dev Explorer keeps its
 * port, its routes and its behaviour untouched, and the two can run side by side
 * (`pnpm dev` and `pnpm lab`). The only thing shared is the esbuild build config
 * for the Mermaid bundles, which is read-only reuse.
 *
 * What it serves:
 *   /                  the lab UI
 *   /mermaid.esm.mjs   the same freshly-built Mermaid the Dev Explorer uses
 *   /api/*             corpus listing, diagram source, and the records store
 *
 * Start with `pnpm lab`. Port comes from MERMAID_LAB_PORT, else it is derived
 * from the worktree path so parallel checkouts do not collide.
 */

import chokidar from 'chokidar';
import cors from 'cors';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path, { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { context } from 'esbuild';
import express from 'express';
import type { Request, Response } from 'express';
import { packageOptions } from '../.build/common.js';
import { generateLangium } from '../.build/generateLangium.js';
import { defaultOptions, getBuildConfig } from '../.esbuild/util.js';
import {
  KNOWN_LAB_LAYOUTS,
  detectDiagramType,
  emptyStore,
  mergeRecord,
  mergeStructure,
  migrateStore,
  recordKey,
  resolveLayouts,
  storeToCsv,
} from './src/server-utils.js';
import type { DiagramStructureRecord, LabStore, LayoutRecord } from './src/server-utils.js';
import { LAYOUT_DEPENDENT_METRIC_KEYS } from './src/metrics/types.js';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

function resolveLabPort(): number {
  const override = process.env.MERMAID_LAB_PORT;
  if (override) {
    const parsed = Number.parseInt(override, 10);
    if (Number.isFinite(parsed) && parsed > 0 && parsed < 65536) {
      return parsed;
    }
    console.warn(`[lab] Ignoring invalid MERMAID_LAB_PORT=${override}`);
  }
  // 9200-block, so it can never land on the dev server's 9000-block port.
  const hash = createHash('sha1').update(process.cwd()).digest();
  return 9200 + (hash.readUInt16BE(0) % 100);
}

const labPort = resolveLabPort();

/**
 * Corpus root — the folder you drop the diagrams you want to study into.
 *
 * Deliberately the lab's own `diagrams/` folder rather than the repo's
 * 372-diagram example tree: the point of this tool is a small, deliberate set
 * you are actually investigating. Point `MERMAID_LAB_ROOT` somewhere else (for
 * example `e2e/platform/dev-diagrams`) to study an existing corpus instead.
 */
const corpusRootAbs = resolve(
  process.cwd(),
  process.env.MERMAID_LAB_ROOT ?? 'diagram-lab/diagrams'
);

const dataDir = resolve(__dirname, 'data');
const recordsPath = resolve(dataDir, process.env.MERMAID_LAB_RECORDS ?? 'records.json');

/** Which layouts the lab offers. See diagram-lab/layouts.json. */
const layoutsConfigPath = resolve(__dirname, 'layouts.json');
let labLayouts: string[] = [...KNOWN_LAB_LAYOUTS];

async function loadLayoutsConfig(): Promise<void> {
  let configured: unknown;
  try {
    const raw = await fs.readFile(layoutsConfigPath, 'utf-8');
    configured = (JSON.parse(raw) as { layouts?: unknown }).layouts;
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[lab] layouts.json could not be read; offering every known layout.', e);
    }
  }

  const resolved = resolveLayouts(configured, process.env.MERMAID_LAB_LAYOUTS);
  labLayouts = resolved.layouts;
  if (resolved.unknown.length > 0) {
    console.warn(
      `[lab] Ignoring unknown layout(s) in ${resolved.source === 'env' ? 'MERMAID_LAB_LAYOUTS' : 'layouts.json'}: ` +
        `${resolved.unknown.join(', ')}. Known: ${KNOWN_LAB_LAYOUTS.join(', ')}`
    );
  }
  console.log(`[lab] layouts (${resolved.source}): ${labLayouts.join(', ')}`);
}

const publicDir = resolve(__dirname, 'public');
const clientDistDir = resolve(__dirname, 'dist');
const clientEntry = resolve(__dirname, 'src/client/lab-app.ts');

console.log('');
console.log('================================================================');
console.log(`  Diagram Lab starting on http://localhost:${labPort}`);
console.log(`  corpus:  ${path.relative(process.cwd(), corpusRootAbs) || '.'}`);
console.log(`  records: ${path.relative(process.cwd(), recordsPath)}`);
console.log('================================================================');
console.log('');

// ─────────────────────────────────────────────────────────────────────────────
// Corpus
// ─────────────────────────────────────────────────────────────────────────────

export interface CorpusEntry {
  /** Posix path relative to the corpus root. */
  path: string;
  /** Immediate folder, or `''` at the root. */
  dir: string;
  name: string;
  /** Diagram keyword from the source, e.g. `flowchart`, `sequenceDiagram`. */
  diagramType: string;
  /** sha256 of the file, so the client can tell stored metrics from stale ones. */
  sourceHash: string;
  bytes: number;
  lineCount: number;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
}

/** Line endings normalised first, so a checkout on another platform is not "a change". */
function hashSource(source: string): string {
  return createHash('sha256').update(source.replace(/\r\n/g, '\n')).digest('hex');
}

async function walkCorpus(dir: string, acc: CorpusEntry[]): Promise<void> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const abs = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
        continue;
      }
      await walkCorpus(abs, acc);
    } else if (entry.isFile() && entry.name.endsWith('.mmd')) {
      const source = await fs.readFile(abs, 'utf-8');
      const rel = toPosix(path.relative(corpusRootAbs, abs));
      acc.push({
        path: rel,
        dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
        name: entry.name.replace(/\.mmd$/, ''),
        diagramType: detectDiagramType(source),
        sourceHash: hashSource(source),
        bytes: Buffer.byteLength(source, 'utf-8'),
        lineCount: source.split('\n').length,
      });
    }
  }
}

function resolveWithinCorpus(requested: unknown): { absPath: string; relPath: string } {
  const raw = typeof requested === 'string' ? requested : '';
  if (raw.includes('\0')) {
    throw new Error('Invalid path');
  }
  const cleaned = raw.replaceAll('\\', '/').replace(/^\/+/, '');
  const absPath = resolve(corpusRootAbs, cleaned);
  const rel = path.relative(corpusRootAbs, absPath);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error('Path escapes the corpus root');
  }
  return { absPath, relPath: toPosix(rel) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Store
//
// Two halves, for the reason documented in src/server-utils.ts: structure is a
// property of the diagram and survives a layout change, layout metrics and the
// operator's score belong to the (diagram, layout) pair.
// ─────────────────────────────────────────────────────────────────────────────

let store: LabStore = emptyStore();

async function loadStore(): Promise<void> {
  try {
    const raw = await fs.readFile(recordsPath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    const before = (parsed as { version?: number })?.version;
    store = migrateStore(parsed, LAYOUT_DEPENDENT_METRIC_KEYS);
    const migrated = before !== 2;
    console.log(
      `[lab] Loaded ${Object.keys(store.diagrams).length} diagram(s) and ` +
        `${Object.keys(store.records).length} layout record(s)` +
        (migrated ? ' (migrated from an older store format).' : '.')
    );
    if (migrated) {
      await persistStore();
    }
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[lab] Could not read the store; starting empty.', e);
    }
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/** Serialised so two concurrent POSTs cannot interleave a read-modify-write. */
function persistStore(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    store.updatedAt = new Date().toISOString();
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${recordsPath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    await fs.rename(tmp, recordsPath);
  });
  return writeQueue;
}

function upsertRecord(incoming: LayoutRecord): LayoutRecord {
  const key = recordKey(incoming.diagram, incoming.layout);
  const merged = mergeRecord(store.records[key], incoming);
  store.records[key] = merged;
  return merged;
}

/**
 * Move every stored entry for `from` onto `to`.
 *
 * The store is keyed by diagram path, so a rename would otherwise orphan every
 * measurement and every score attached to the file.
 */
function renameInStore(from: string, to: string): void {
  const structure = store.diagrams[from];
  if (structure) {
    delete store.diagrams[from];
    store.diagrams[to] = { ...structure, diagram: to };
  }
  for (const [key, record] of Object.entries(store.records)) {
    if (record.diagram === from) {
      delete store.records[key];
      store.records[recordKey(to, record.layout)] = { ...record, diagram: to };
    }
  }
}

/** Forget a diagram entirely: its structure and every layout record for it. */
function forgetInStore(diagram: string): void {
  delete store.diagrams[diagram];
  for (const [key, record] of Object.entries(store.records)) {
    if (record.diagram === diagram) {
      delete store.records[key];
    }
  }
}

function upsertStructure(incoming: DiagramStructureRecord): DiagramStructureRecord {
  const merged = mergeStructure(store.diagrams[incoming.diagram], incoming);
  store.diagrams[incoming.diagram] = merged;
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Build + serve
// ─────────────────────────────────────────────────────────────────────────────

let clients: { id: number; response: Response }[] = [];

function sendReload(): void {
  for (const { response } of clients) {
    response.write(`data: ${Date.now()}\n\n`);
  }
}

function eventsHandler(request: Request, response: Response): void {
  response.writeHead(200, {
    'Content-Type': 'text/event-stream',
    Connection: 'keep-alive',
    'Cache-Control': 'no-cache',
  });
  const id = Date.now() + Math.random();
  clients.push({ id, response });
  request.on('close', () => {
    clients = clients.filter((client) => client.id !== id);
  });
}

async function buildMermaidBundles() {
  // The lab only needs Mermaid itself and the ELK layout plugin. ELK is built
  // from the core bundle, so the core context has to rebuild first — same
  // ordering constraint the Dev Explorer server documents.
  const coreContext = await context(
    getBuildConfig({
      ...defaultOptions,
      minify: false,
      core: true,
      profiling: false,
      options: packageOptions.mermaid,
    })
  );
  await coreContext.rebuild();

  const contexts = await Promise.all(
    [packageOptions.parser, packageOptions.mermaid, packageOptions['mermaid-layout-elk']].map(
      async (options) =>
        context(
          getBuildConfig({
            ...defaultOptions,
            minify: false,
            core: false,
            profiling: false,
            options,
          })
        )
    )
  );

  let counter = 0;
  const rebuildAll = async () => {
    const label = `[lab] rebuild ${++counter}`;
    console.time(label);
    await coreContext.rebuild();
    await Promise.all(contexts.map((ctx) => ctx.rebuild())).catch((e) => console.error(e));
    console.timeEnd(label);
  };

  await rebuildAll();
  return rebuildAll;
}

async function buildClientBundle(): Promise<void> {
  try {
    const clientContext = await context({
      absWorkingDir: process.cwd(),
      entryPoints: [clientEntry],
      bundle: true,
      format: 'esm',
      target: 'es2020',
      sourcemap: true,
      outdir: clientDistDir,
      // The metrics modules import each other with `.js` specifiers, the way
      // the rest of the repo does; esbuild rewrites those to `.ts` itself, and
      // this covers the extensionless Shoelace/Lit specifiers.
      resolveExtensions: ['.ts', '.js', '.json'],
      logLevel: 'info',
      plugins: [
        {
          name: 'lab-reload',
          setup(build) {
            build.onEnd(() => sendReload());
          },
        },
      ],
    });
    await clientContext.watch();
    await clientContext.rebuild();
  } catch (err) {
    console.error('[lab] Client bundle build failed.');
    console.error(err);
  }
}

async function createServer(): Promise<void> {
  // Make the drop folder exist, so a first run has somewhere obvious to put
  // diagrams rather than failing the corpus listing.
  await fs.mkdir(corpusRootAbs, { recursive: true });
  await generateLangium();
  await loadLayoutsConfig();
  await loadStore();

  const rebuildMermaid = await buildMermaidBundles();
  await buildClientBundle();

  let rebuildTimer: NodeJS.Timeout | undefined;
  chokidar
    .watch('**/src/**/*.{js,ts,langium,yaml,json}', {
      ignoreInitial: true,
      ignored: [/node_modules/, /dist/, /docs/, /coverage/],
    })
    .on('all', (event, changedPath) => {
      if (!['add', 'change'].includes(event)) {
        return;
      }
      console.log(`[lab] ${changedPath} changed. Rebuilding…`);
      clearTimeout(rebuildTimer);
      rebuildTimer = setTimeout(() => {
        void (async () => {
          if (changedPath.endsWith('.langium')) {
            await generateLangium();
          }
          await rebuildMermaid();
          sendReload();
        })();
      }, 150);
    });

  chokidar
    .watch(['public/**/*'], { cwd: __dirname, ignoreInitial: true })
    .on('all', () => sendReload());

  // Editing layouts.json should take effect without restarting the server.
  chokidar.watch(['layouts.json'], { cwd: __dirname, ignoreInitial: true }).on('all', () => {
    void (async () => {
      await loadLayoutsConfig();
      sendReload();
    })();
  });

  const app = express();
  app.use(cors());
  app.get('/events', eventsHandler);

  app.get('/api/config', (_req, res) => {
    res.json({ layouts: labLayouts, known: KNOWN_LAB_LAYOUTS });
  });

  app.get('/api/corpus', (_req, res) => {
    void (async () => {
      const entries: CorpusEntry[] = [];
      await walkCorpus(corpusRootAbs, entries);
      entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
      res.json({
        root: toPosix(path.relative(process.cwd(), corpusRootAbs)),
        rootAbs: corpusRootAbs,
        entries,
      });
    })();
  });

  app.get('/api/file', (req, res) => {
    void (async () => {
      try {
        const { absPath } = resolveWithinCorpus(req.query.path);
        if (!absPath.endsWith('.mmd')) {
          res.status(400).send('Only .mmd files are allowed');
          return;
        }
        res.type('text/plain').send(await fs.readFile(absPath, 'utf-8'));
      } catch {
        res.status(400).send('Invalid path');
      }
    })();
  });

  /**
   * Overwrite a diagram's source.
   *
   * Returns the new source hash so the client can tell its stored metrics are
   * now stale without a full corpus reload.
   */
  app.put('/api/file', express.text({ type: '*/*', limit: '4mb' }), (req, res) => {
    void (async () => {
      try {
        const { absPath, relPath } = resolveWithinCorpus(req.query.path);
        if (!absPath.endsWith('.mmd')) {
          res.status(400).json({ error: 'Only .mmd files are allowed' });
          return;
        }
        if (typeof req.body !== 'string') {
          res.status(400).json({ error: 'Expected a text/plain body' });
          return;
        }
        const stats = await fs.stat(absPath);
        if (!stats.isFile()) {
          res.status(400).json({ error: 'Not a file' });
          return;
        }
        await fs.writeFile(absPath, req.body, 'utf-8');
        console.log(`[lab] saved ${relPath} (${Buffer.byteLength(req.body, 'utf-8')} bytes)`);
        res.json({ path: relPath, sourceHash: hashSource(req.body) });
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
          res.status(404).json({ error: 'No such diagram' });
          return;
        }
        res.status(400).json({ error: 'Invalid path' });
      }
    })();
  });

  /**
   * Rename a diagram inside the corpus.
   *
   * Refuses to clobber an existing file, and keeps the corpus flat-ish by
   * rejecting a name that tries to climb out of the root. The store follows the
   * rename so measurements and scores are not orphaned.
   */
  app.post('/api/file/rename', express.json({ limit: '64kb' }), (req, res) => {
    void (async () => {
      const body = req.body as { path?: string; name?: string } | undefined;
      try {
        const { absPath, relPath } = resolveWithinCorpus(body?.path);
        const rawName = typeof body?.name === 'string' ? body.name.trim() : '';
        if (!rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('\0')) {
          res.status(400).json({ error: 'Name must be a bare filename' });
          return;
        }
        const newName = rawName.endsWith('.mmd') ? rawName : `${rawName}.mmd`;
        if (newName === '.mmd' || newName.startsWith('.')) {
          res.status(400).json({ error: 'Invalid filename' });
          return;
        }

        const dir = path.dirname(absPath);
        const target = resolve(dir, newName);
        // resolveWithinCorpus again, so a crafted name cannot escape the root.
        // Take its `absPath` rather than reusing `target` below: the two are the
        // same path (the validator resolves the relative form of `target` back
        // against the root, or throws), but the fs calls then read their path
        // straight out of the validator. CodeQL otherwise reports the rename as
        // uncontrolled-data-in-path-expression, because the guard's result and
        // the value reaching the sink are different variables.
        const { absPath: targetAbs, relPath: newRel } = resolveWithinCorpus(
          toPosix(path.relative(corpusRootAbs, target))
        );

        if (target === absPath) {
          res.json({ path: newRel, renamed: false });
          return;
        }
        try {
          await fs.access(targetAbs);
          res.status(409).json({ error: `${newName} already exists` });
          return;
        } catch {
          // ENOENT is what we want.
        }

        await fs.rename(absPath, targetAbs);
        renameInStore(relPath, newRel);
        await persistStore();
        console.log(`[lab] renamed ${relPath} -> ${newRel}`);
        res.json({ path: newRel, renamed: true });
      } catch {
        res.status(400).json({ error: 'Invalid path' });
      }
    })();
  });

  /** Delete a diagram from the corpus, and forget everything stored about it. */
  app.delete('/api/file', (req, res) => {
    void (async () => {
      try {
        const { absPath, relPath } = resolveWithinCorpus(req.query.path);
        if (!absPath.endsWith('.mmd')) {
          res.status(400).json({ error: 'Only .mmd files can be deleted' });
          return;
        }
        await fs.unlink(absPath);
        forgetInStore(relPath);
        await persistStore();
        console.log(`[lab] deleted ${relPath}`);
        res.json({ ok: true, path: relPath });
      } catch (e) {
        if ((e as NodeJS.ErrnoException)?.code === 'ENOENT') {
          res.status(404).json({ error: 'No such diagram' });
          return;
        }
        res.status(400).json({ error: 'Invalid path' });
      }
    })();
  });

  app.get('/api/store', (_req, res) => {
    res.json(store);
  });

  /**
   * Upsert either half of the store, or both.
   *
   * A sweep sends both (one render produces both); a keystroke sends only a
   * score. The merge helpers keep whichever half the payload leaves out.
   */
  app.post('/api/store', express.json({ limit: '32mb' }), (req, res) => {
    void (async () => {
      const body = req.body as
        | { diagrams?: DiagramStructureRecord[]; records?: LayoutRecord[] }
        | undefined;

      const savedDiagrams: DiagramStructureRecord[] = [];
      for (const incoming of body?.diagrams ?? []) {
        if (incoming && typeof incoming.diagram === 'string') {
          savedDiagrams.push(upsertStructure(incoming));
        }
      }

      const savedRecords: LayoutRecord[] = [];
      for (const incoming of body?.records ?? []) {
        if (
          incoming &&
          typeof incoming.diagram === 'string' &&
          typeof incoming.layout === 'string'
        ) {
          savedRecords.push(upsertRecord(incoming));
        }
      }

      if (savedDiagrams.length === 0 && savedRecords.length === 0) {
        res.status(400).json({ error: 'No valid diagrams or records in payload' });
        return;
      }
      await persistStore();
      res.json({ diagrams: savedDiagrams, records: savedRecords });
    })();
  });

  app.delete('/api/records', (req, res) => {
    void (async () => {
      const diagram = typeof req.query.diagram === 'string' ? req.query.diagram : undefined;
      const layout = typeof req.query.layout === 'string' ? req.query.layout : undefined;
      if (!diagram) {
        res.status(400).json({ error: 'diagram is required' });
        return;
      }
      if (layout) {
        delete store.records[recordKey(diagram, layout)];
      } else {
        // No layout named: forget the diagram entirely, both halves.
        delete store.diagrams[diagram];
        for (const key of Object.keys(store.records)) {
          if (store.records[key].diagram === diagram) {
            delete store.records[key];
          }
        }
      }
      await persistStore();
      res.json({ ok: true });
    })();
  });

  app.get('/api/export.csv', (req, res) => {
    const layout = typeof req.query.layout === 'string' ? req.query.layout : undefined;
    res.type('text/csv').attachment('diagram-lab.csv').send(storeToCsv(store, layout));
  });

  app.use(
    '/vendor/shoelace',
    express.static(resolve(process.cwd(), 'node_modules/@shoelace-style/shoelace/dist'))
  );
  app.use('/assets', express.static(clientDistDir));
  // Mermaid + ELK bundles, served from the packages the build just wrote.
  for (const { packageName } of Object.values(packageOptions)) {
    app.use(express.static(`./packages/${packageName}/dist`, { index: false }));
  }
  app.use(express.static(publicDir, { index: ['index.html'] }));

  app.listen(labPort, () => {
    console.log(`[lab] Listening on http://localhost:${labPort}`);
  });
}

void createServer();
