import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SIMPLE crowded labels.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`captioned reciprocal edges have compact, separate lanes (${look}/${theme})`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(
        mermaidUrl(code, { layout: 'stress-and-grid', look, theme, handDrawnSeed: 1 }, false)
      );
      await page.waitForFunction(
        () => (window as unknown as { rendered: boolean }).rendered === true
      );
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(7);
      const { layout, validation } = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidLastLayoutCapture: { layout: LayoutData };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: unknown[];
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        return {
          layout: capture.mermaidLastLayoutCapture.layout,
          validation: capture.mermaidValidateLastLayout(),
        };
      });
      const source = layout.nodes.find((node) => node.id === 'USCompany')!;
      const target = layout.nodes.find((node) => node.id === 'HongKongCompany')!;
      const gap = Math.abs(target.y! - source.y!) - (source.height! + target.height!) / 2;
      expect(gap).toBeLessThan(150);
      expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBeLessThan(35);
      expect(
        layout.edges.find((edge) => edge.start === target.id && edge.end === source.id)!.points
      ).toHaveLength(2);
      await page
        .locator('svg')
        .screenshot({ path: testInfo.outputPath('captioned-reciprocal.png') });
    });
  }
}

test('multi-line captions retain measured height plus clearance while compacting', async ({
  page,
}, testInfo) => {
  const multiLine = code.replace(
    'fdhdfjkfdkjdjd',
    '"First line<br/>Second line<br/>Third line<br/>Fourth line<br/>Fifth line"'
  );
  await page.addInitScript(() => {
    (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
  });
  await page.goto(
    mermaidUrl(multiLine, { layout: 'stress-and-grid', look: 'classic', theme: 'default' }, false)
  );
  await page.waitForFunction(() => (window as unknown as { rendered: boolean }).rendered === true);
  const { layout, validation } = await page.evaluate(() => {
    const capture = window as unknown as {
      mermaidLastLayoutCapture: { layout: LayoutData };
      mermaidValidateLastLayout: () => {
        ok: boolean;
        issues: unknown[];
        breakdown: { crossings: number };
      };
    };
    return {
      layout: capture.mermaidLastLayoutCapture.layout,
      validation: capture.mermaidValidateLastLayout(),
    };
  });
  const source = layout.nodes.find((node) => node.id === 'USCompany')!;
  const target = layout.nodes.find((node) => node.id === 'HongKongCompany')!;
  const caption = layout.edges.find((edge) => edge.start === source.id && edge.end === target.id)!;
  const gap = Math.abs(target.y! - source.y!) - (source.height! + target.height!) / 2;
  expect(caption.height).toBeGreaterThan(100);
  expect(gap).toBeGreaterThanOrEqual(caption.height! + 24);
  expect(gap).toBeLessThan(200);
  expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
  expect(validation.breakdown.crossings).toBe(0);
  await page.locator('svg').screenshot({ path: testInfo.outputPath('multi-line-caption.png') });
});
