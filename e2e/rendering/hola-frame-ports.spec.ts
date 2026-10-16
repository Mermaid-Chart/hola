import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const cases = [
  'SUBGRAPH knsv2-12-flowchart-dagre-tb-subgraphs',
  'SUBGRAPH knsv2-13-flowchart-dagre-tb-subgraphs',
  'SUBGRAPH multiple connection to external node',
].map((name) => ({
  name,
  source: readFileSync(
    new URL(`../platform/dev-diagrams/test-dataset/${name}.mmd`, import.meta.url),
    'utf8'
  ),
}));

cases.push({
  name: 'curved external node',
  source: cases[1].source.replace('nat\n', 'nat((nat))\n'),
});

cases.push({
  name: 'labelled nested frame connections',
  source: readFileSync(
    new URL(
      '../platform/dev-diagrams/layout-tests/Loop Fixtures/nested-sg-outgoing-3.mmd',
      import.meta.url
    ),
    'utf8'
  ),
});

for (const { name, source } of cases) {
  test(`HOLA connects subgraph frames away from corners: ${name}`, async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
    });
    await page.goto(
      mermaidUrl(source, { layout: 'hola', look: 'classic', theme: 'default' }, false)
    );
    await page.waitForFunction(
      () => (window as unknown as { rendered: boolean }).rendered === true
    );
    const captured = await page.evaluate(() => {
      const capture = window as unknown as {
        mermaidLastLayoutCapture: { layout: LayoutData };
        mermaidValidateLastLayout: () => {
          ok: boolean;
          score: number;
          issues: { type: string }[];
          breakdown: { crossings: number };
        };
      };
      return {
        layout: capture.mermaidLastLayoutCapture.layout,
        validation: capture.mermaidValidateLastLayout(),
      };
    });
    writeFileSync(testInfo.outputPath('layout.json'), JSON.stringify(captured, null, 2));
    await testInfo.attach('layout', {
      body: JSON.stringify(captured, null, 2),
      contentType: 'application/json',
    });
    await page.locator('svg').screenshot({ path: testInfo.outputPath('frame-ports.png') });
    expect(
      captured.validation.issues.filter((issue) =>
        ['edge-corner-connection', 'port-near-corner'].includes(issue.type)
      )
    ).toEqual([]);
    expect(captured.validation.breakdown.crossings).toBe(0);
    expect(captured.validation.ok, JSON.stringify(captured.validation.issues)).toBe(true);
    expect(
      captured.validation.issues.filter((issue) => issue.type === 'edge-shared-subpath')
    ).toEqual([]);
  });
}
