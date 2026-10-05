import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/SUBGRAPH knsv2-24-flowchart-dagre-lr-subgraphs.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`nested BAPA containment: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(5);
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
      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      const bapa = nodes.get('s3')!;
      expect(bapa.parentId).toBe('s8');
      for (const parentId of ['s8', 's0']) {
        const parent = nodes.get(parentId)!;
        const inset = Math.min(
          bapa.x! - bapa.width! / 2 - (parent.x! - parent.width! / 2),
          parent.x! + parent.width! / 2 - (bapa.x! + bapa.width! / 2),
          bapa.y! - bapa.height! / 2 - (parent.y! - parent.height! / 2),
          parent.y! + parent.height! / 2 - (bapa.y! + bapa.height! / 2)
        );
        expect(inset).toBeGreaterThanOrEqual(8);
      }
      await page.locator('svg').screenshot({ path: testInfo.outputPath('nested-containment.png') });
    });
  }
}
