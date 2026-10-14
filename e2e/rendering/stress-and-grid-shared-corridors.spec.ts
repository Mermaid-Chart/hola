import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/MESSY hairy subgraphs.mmd', import.meta.url),
  'utf8'
);

for (const [look, theme] of [
  ['classic', 'default'],
  ['neo', 'default'],
  ['handDrawn', 'redux-color'],
] as const) {
  test(`shared fan and parallel corridors remain unbraided (${look}/${theme})`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
    });
    await page.goto(
      mermaidUrl(code, { layout: 'stress-and-grid', look, theme, handDrawnSeed: 1 }, false)
    );
    await page.waitForFunction(
      () => (window as unknown as { rendered: boolean }).rendered === true
    );
    await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(11);
    const { layout, validation } = await page.evaluate(() => {
      const capture = window as unknown as {
        mermaidLastLayoutCapture: { layout: LayoutData };
        mermaidValidateLastLayout: () => {
          ok: boolean;
          issues: { type: string }[];
          breakdown: { crossings: number; totalBendPenalty: number };
        };
      };
      return {
        layout: capture.mermaidLastLayoutCapture.layout,
        validation: capture.mermaidValidateLastLayout(),
      };
    });
    expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
    expect(validation.breakdown.crossings).toBe(0);
    expect(validation.breakdown.totalBendPenalty).toBeLessThan(55);
    if (look === 'classic') {
      const bundle = layout.edges.filter((edge) => edge.start === 'N11' && edge.end === 'N22');
      expect(bundle).toHaveLength(5);
      expect(bundle.every((edge) => edge.points!.length === 3)).toBe(true);
      expect(layout.edges.find((edge) => edge.end === 'N05')!.points!.length).toBeLessThan(6);
    }
    await page.locator('svg').screenshot({ path: testInfo.outputPath('shared-corridors.png') });
  });
}
