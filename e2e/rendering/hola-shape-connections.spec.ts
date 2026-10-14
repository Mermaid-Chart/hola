import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/SIMPLE knsv2-17-flowchart-dagre-lr-shapes.mmd',
    import.meta.url
  ),
  'utf8'
);

const cases = [
  { name: 'reported diamond and rounded node', diagram: code },
  {
    name: 'TB diamond and circle',
    diagram: 'flowchart TB\n A{Decision} --> B((Result))\n A --- B',
  },
  {
    name: 'parallel connectors beside a branch',
    diagram:
      'flowchart LR\n A{Decision} --> B((Result))\n A --- B\n A --> C[Branch]\n B --> D[Next]',
  },
];

for (const { name, diagram } of cases) {
  test(`HOLA shape connections: ${name}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
    });
    await page.goto(
      mermaidUrl(diagram, { layout: 'hola', look: 'classic', theme: 'default' }, false)
    );
    await page.waitForFunction(
      () => (window as unknown as { rendered: boolean }).rendered === true
    );
    const result = await page.evaluate(() => {
      const capture = window as unknown as {
        mermaidValidateLastLayout: () => { ok: boolean; issues: unknown[] };
      };
      return capture.mermaidValidateLastLayout();
    });
    await page.locator('svg').screenshot({ path: testInfo.outputPath('shape-connections.png') });
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  });
}
