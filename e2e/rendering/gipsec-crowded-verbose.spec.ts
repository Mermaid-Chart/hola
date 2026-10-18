import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/SUBGRAPH crowded edges and verbose nodes.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`crowded verbose fan: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(4);
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
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        return {
          layout: capture.mermaidLastLayoutCapture.layout,
          validation: capture.mermaidValidateLastLayout(),
        };
      });
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(15);
      expect(layout.edges.every((edge) => edge.points!.length <= 4)).toBe(true);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('crowded-verbose.png') });
    });
  }
}
