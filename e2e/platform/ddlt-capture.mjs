import { chromium } from 'playwright';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const DIR = fileURLToPath(new URL('./dev-diagrams/layout-tests/Loop Fixtures/', import.meta.url));
const BASE = process.env.MERMAID_CAPTURE_URL ?? `http://localhost:${process.env.MERMAID_PORT ?? 9000}`;
const REL = 'dev-diagrams/layout-tests/Loop Fixtures';
const only = process.argv.slice(2);

const files = readdirSync(DIR);
let targets = files
  .filter((f) => f.endsWith('.mmd'))
  .map((f) => f.replace(/\.mmd$/, ''))
  .filter((n) => !files.includes(`${n}.sizes.json`) && !files.includes(`${n}.json`))
  .sort();
if (only.length) targets = targets.filter((n) => only.includes(n));

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1600, height: 1200 } });

const ok = [], failed = [];
for (const name of targets) {
  const url = `${BASE}/ddlt-capture.html?f=${encodeURIComponent(`/${REL}/${name}.mmd`)}`;
  try {
    await page.goto(url, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__captureDone === true, null, { timeout: 60000 });
    const err = await page.evaluate(() => window.__captureError);
    if (err) throw new Error(err.split('\n')[0]);
    const entry = await page.evaluate(() => window.mermaidLastCapturedSizes ?? null);
    if (!entry || !entry.sizes || !Array.isArray(entry.sizes.nodes) || entry.sizes.nodes.length === 0) {
      throw new Error('no sizes captured (empty or undefined)');
    }
    const src = readFileSync(join(DIR, `${name}.mmd`));
    const out = {
      nodes: entry.sizes.nodes,
      metadata: {
        captureVersion: entry.sizes.metadata?.captureVersion ?? 1,
        sourceSha256: createHash('sha256').update(src).digest('hex'),
        capturedAt: new Date().toISOString(),
        capturedFrom: `ddlt-capture.html ${REL}/${name}.mmd theme=default look=classic layout=dagre`,
      },
    };
    writeFileSync(join(DIR, `${name}.sizes.json`), JSON.stringify(out, null, 2) + '\n');
    ok.push(`${name} (${out.nodes.length} nodes)`);
    console.log(`OK    ${name} — ${out.nodes.length} nodes`);
  } catch (e) {
    failed.push(`${name}: ${String(e.message).slice(0, 160)}`);
    console.log(`FAIL  ${name} — ${String(e.message).slice(0, 160)}`);
  }
}
await browser.close();
console.log(`\n=== captured ${ok.length}/${targets.length} ===`);
if (failed.length) { console.log('FAILURES:'); for (const f of failed) console.log('  ' + f); }
