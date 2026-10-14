import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const diagram = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/MESSY hairy subgraphs.mmd', import.meta.url),
  'utf8'
);

const cases = ['LR', 'TB'].map((direction) => ({
  name: direction,
  source: diagram.replace('flowchart LR', `flowchart ${direction}`),
}));

for (const { name, source } of cases) {
  test(`HOLA separates parallel edges between grouped nodes: ${name}`, async ({
    page,
  }, testInfo) => {
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
    await page.locator('svg').screenshot({ path: testInfo.outputPath('hairy.png') });
    const bundle = captured.layout.edges.filter(
      (edge) => edge.start === 'N11' && edge.end === 'N22'
    );
    expect(bundle).toHaveLength(5);
    if (name === 'LR') {
      expect(captured.validation.score).toBeGreaterThan(950);
      expect(captured.validation.issues).toEqual([]);
      expect(bundle.every((edge) => edge.points?.length === 2)).toBe(true);
    }
    expect(captured.validation.breakdown.crossings).toBe(0);
    expect(captured.validation.ok, JSON.stringify(captured.validation.issues)).toBe(true);
    expect(
      captured.validation.issues.filter((issue) => issue.type === 'edge-shared-subpath')
    ).toEqual([]);
  });
}
