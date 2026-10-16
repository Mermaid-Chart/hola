import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/VERBOSE incremental-editing.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`aligned diamond continuation uses vertices: ${look}, ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(16);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidLastLayoutCapture: {
            layout: {
              nodes: { id: string; x: number; y: number; width: number; height: number }[];
              edges: { id: string; points: { x: number; y: number }[] }[];
            };
          };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: unknown[];
            score: number;
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        return {
          layout: capture.mermaidLastLayoutCapture.layout,
          validation: capture.mermaidValidateLastLayout(),
        };
      });
      const node = (id: string) => result.layout.nodes.find((candidate) => candidate.id === id)!;
      const edge = (id: string) =>
        result.layout.edges.find((candidate) => candidate.id === id)!.points;
      const diamond = node('overlap');
      const continuation = edge('L_overlap_done_0');
      expect(continuation).toEqual([
        { x: diamond.x, y: diamond.y + diamond.height / 2 },
        { x: node('done').x, y: node('done').y - node('done').height / 2 },
      ]);
      expect(edge('L_overlap_relayout_0')[0]).toEqual({
        x: diamond.x + diamond.width / 2,
        y: diamond.y,
      });
      expect(result.validation.ok).toBe(true);
      expect(result.validation.issues).toEqual([]);
      expect(result.validation.breakdown.crossings).toBe(0);
      expect(result.validation.breakdown.totalBendPenalty).toBeLessThan(15);
      expect(result.validation.score).toBeGreaterThan(985);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('incremental-vertex.png') });
    });
  }
}
