import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

for (const diagram of ['07', '08'] as const) {
  const code = readFileSync(
    new URL(
      `../platform/dev-diagrams/test-dataset/SUBGRAPH knsv2-${diagram}-flowchart-dagre-tb-subgraphs.mmd`,
      import.meta.url
    ),
    'utf8'
  );
  for (const look of ['classic', 'neo', 'handDrawn'] as const) {
    for (const theme of ['default', 'redux-color'] as const) {
      test(`nested sibling-frame labels ${diagram}: ${look}, ${theme}`, async ({
        page,
      }, testInfo) => {
        await page.addInitScript(() => {
          (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
            true;
        });
        await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
        await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(
          diagram === '08' ? 3 : 4
        );
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
        expect(
          validation.issues.filter(
            (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
          )
        ).toEqual([]);
        expect(validation.breakdown.crossings).toBe(0);
        expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
        await expect(page.getByText('via_AWSBatch', { exact: true })).toBeVisible();
        await expect(page.getByText('messages', { exact: true })).toBeVisible();
        for (const edge of layout.edges) {
          // Check captured label boxes against both content nodes and arrowheads
          // through the validator, then retain a rendered preview for inspection.
          expect(edge.width).toBeGreaterThan(0);
          expect(edge.height).toBeGreaterThan(0);
        }
        await page
          .locator('svg')
          .screenshot({ path: testInfo.outputPath('sibling-frame-labels.png') });
      });
    }
  }
}
