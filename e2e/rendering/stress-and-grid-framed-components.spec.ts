import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/SUBGRAPH simple edges and orphan node.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`compact framed components and orphan: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(3);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const { layout, validation } = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidLastLayoutCapture: { layout: LayoutData };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number };
          };
        };
        return {
          layout: capture.mermaidLastLayoutCapture.layout,
          validation: capture.mermaidValidateLastLayout(),
        };
      });
      expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      const frames = layout.nodes.filter((node) => node.isGroup);
      const top = Math.min(...frames.map((node) => node.y! - node.height! / 2));
      const bottom = Math.max(...frames.map((node) => node.y! + node.height! / 2));
      const right = Math.max(...frames.map((node) => node.x! + node.width! / 2));
      expect(
        bottom - top - frames.reduce((sum, node) => sum + node.height!, 0)
      ).toBeLessThanOrEqual(96);
      const note = layout.nodes.find((node) => node.id === 'note')!;
      // Painted rough frames extend slightly beyond their modelled rectangle.
      expect(note.x! - note.width! / 2 - right).toBeGreaterThanOrEqual(110);
      expect(note.x! - note.width! / 2 - right).toBeLessThanOrEqual(125);
      expect(Math.abs(note.y! - note.height! / 2 - top)).toBeLessThanOrEqual(5);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('framed-components.png') });
    });
  }
}
