import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/VERBOSE converted from event modelling.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`compact verbose continuation spacing: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
      await page.waitForFunction(
        () => (window as unknown as { rendered: boolean }).rendered === true
      );
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(39);
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
      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      const verticalGaps = layout.edges.flatMap((edge) => {
        const source = nodes.get(edge.start!)!;
        const target = nodes.get(edge.end!)!;
        return Math.abs(source.x! - target.x!) < 1
          ? [Math.abs(source.y! - target.y!) - (source.height! + target.height!) / 2]
          : [];
      });
      expect(verticalGaps.length).toBeGreaterThan(20);
      expect(Math.max(...verticalGaps)).toBeLessThanOrEqual(120);
      const height =
        Math.max(...layout.nodes.map((node) => node.y! + node.height! / 2)) -
        Math.min(...layout.nodes.map((node) => node.y! - node.height! / 2));
      expect(height).toBeLessThan(4000);
      expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBe(0);
      await page
        .locator('svg')
        .screenshot({ path: testInfo.outputPath('compact-verbose-continuations.png') });
    });
  }
}
