import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SUBGRAPH linear complexity.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`compact nested linear workflow: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(10);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number; totalBendPenalty: number; edges: { points: number }[] };
          };
        };
        return capture.mermaidValidateLastLayout();
      });
      expect(
        result.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(40);
      expect(result.breakdown.edges.every((edge) => edge.points <= 4)).toBe(true);
      await page
        .locator('svg')
        .screenshot({ path: testInfo.outputPath('nested-linear-workflow.png') });
    });
  }
}
