import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/VERBOSE three paths.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`straight verbose terminal branches: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(9);
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
              edges: {
                id: string;
                start: string;
                end: string;
                x: number;
                y: number;
                width: number;
                height: number;
                points: { x: number; y: number }[];
              }[];
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
      for (const id of ['L_D_L_0', 'L_F_K_0']) {
        const edge = result.layout.edges.find((candidate) => candidate.id === id)!;
        const source = node(edge.start);
        const target = node(edge.end);
        const sign = Math.sign(target.x - source.x);
        expect(edge.points).toEqual([
          { x: source.x + (sign * source.width) / 2, y: source.y },
          { x: target.x - (sign * target.width) / 2, y: target.y },
        ]);
        expect(edge.y).toBe(source.y);
        expect(edge.x).toBeCloseTo((edge.points[0].x + edge.points[1].x) / 2, 6);
      }
      expect(result.validation.ok).toBe(true);
      expect(result.validation.issues).toEqual([]);
      expect(result.validation.breakdown.crossings).toBe(0);
      expect(result.validation.breakdown.totalBendPenalty).toBe(0);
      expect(result.validation.score).toBe(1000);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('three-paths.png') });
    });
  }
}
