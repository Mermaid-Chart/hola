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
import { detectDiagramType, mergeRecord, recordKey, recordsToCsv } from './src/server-utils.js';
import type { LabRecord } from './src/server-utils.js';

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

/** Corpus root. Defaults to the same dev-diagrams tree the Dev Explorer browses. */
const corpusRootAbs = resolve(
  process.cwd(),
  process.env.MERMAID_LAB_ROOT ??
    process.env.MERMAID_DEV_EXPLORER_ROOT ??
    'e2e/platform/dev-diagrams'
);

const dataDir = resolve(__dirname, 'data');
const recordsPath = resolve(dataDir, process.env.MERMAID_LAB_RECORDS ?? 'records.json');

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
  bytes: number;
  lineCount: number;
}

function toPosix(p: string): string {
  return p.split(path.sep).join('/');
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
// Records store
//
// One record per (diagram, layout) pair: the computed metrics plus whatever
// score and note the operator typed. Kept as a single JSON file — the whole
// point of the tool is that the table is small enough to read.
// ─────────────────────────────────────────────────────────────────────────────

interface RecordsFile {
  version: 1;
  updatedAt: string;
  records: Record<string, LabRecord>;
}

let store: RecordsFile = { version: 1, updatedAt: new Date().toISOString(), records: {} };

async function loadRecords(): Promise<void> {
  try {
    const raw = await fs.readFile(recordsPath, 'utf-8');
    const parsed = JSON.parse(raw) as RecordsFile;
    if (parsed && typeof parsed === 'object' && parsed.records) {
      store = { version: 1, updatedAt: parsed.updatedAt ?? '', records: parsed.records };
      console.log(`[lab] Loaded ${Object.keys(store.records).length} record(s).`);
      return;
    }
    console.warn('[lab] records file has an unexpected shape; starting empty.');
  } catch (e) {
    if ((e as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.warn('[lab] Could not read records file; starting empty.', e);
    }
  }
}

let writeQueue: Promise<void> = Promise.resolve();

/** Serialised so two concurrent POSTs cannot interleave a read-modify-write. */
function persistRecords(): Promise<void> {
  writeQueue = writeQueue.then(async () => {
    store.updatedAt = new Date().toISOString();
    await fs.mkdir(dataDir, { recursive: true });
    const tmp = `${recordsPath}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(store, null, 2)}\n`, 'utf-8');
    await fs.rename(tmp, recordsPath);
  });
  return writeQueue;
}

function upsertRecord(incoming: LabRecord): LabRecord {
  const key = recordKey(incoming.diagram, incoming.layout);
  const merged = mergeRecord(store.records[key], incoming);
  store.records[key] = merged;
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
  await generateLangium();
  await loadRecords();

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

  const app = express();
  app.use(cors());
  app.get('/events', eventsHandler);

  app.get('/api/corpus', (_req, res) => {
    void (async () => {
      const entries: CorpusEntry[] = [];
      await walkCorpus(corpusRootAbs, entries);
      entries.sort((a, b) => a.path.localeCompare(b.path, undefined, { sensitivity: 'base' }));
      res.json({
        root: toPosix(path.relative(process.cwd(), corpusRootAbs)),
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

  app.get('/api/records', (_req, res) => {
    res.json(store);
  });

  app.post('/api/records', express.json({ limit: '32mb' }), (req, res) => {
    void (async () => {
      const body = req.body as { records?: LabRecord[] } | undefined;
      const incoming = Array.isArray(body?.records) ? body.records : [];
      const saved: LabRecord[] = [];
      for (const record of incoming) {
        if (!record || typeof record.diagram !== 'string' || typeof record.layout !== 'string') {
          continue;
        }
        saved.push(upsertRecord(record));
      }
      if (saved.length === 0) {
        res.status(400).json({ error: 'No valid records in payload' });
        return;
      }
      await persistRecords();
      res.json({ saved: saved.length, records: saved });
    })();
  });

  app.delete('/api/records', (req, res) => {
    void (async () => {
      const diagram = typeof req.query.diagram === 'string' ? req.query.diagram : undefined;
      const layout = typeof req.query.layout === 'string' ? req.query.layout : undefined;
      if (!diagram || !layout) {
        res.status(400).json({ error: 'diagram and layout are required' });
        return;
      }
      delete store.records[recordKey(diagram, layout)];
      await persistRecords();
      res.json({ ok: true });
    })();
  });

  app.get('/api/export.csv', (req, res) => {
    const layout = typeof req.query.layout === 'string' ? req.query.layout : undefined;
    const rows = Object.values(store.records)
      .filter((record) => !layout || record.layout === layout)
      .sort((a, b) => a.diagram.localeCompare(b.diagram) || a.layout.localeCompare(b.layout));
    res.type('text/csv').attachment('diagram-lab.csv').send(recordsToCsv(rows));
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
