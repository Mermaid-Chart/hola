import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SUBRAPH decision small.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`symmetric framed terminal fork: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme, handDrawnSeed: 1 }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(6);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidLastLayoutCapture: {
            layout: {
              nodes: { id: string; x: number; y: number; height: number }[];
              edges: { id: string; points: { x: number; y: number }[] }[];
            };
          };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        const node = (id: string) =>
          capture.mermaidLastLayoutCapture.layout.nodes.find((n) => n.id === id)!;
        const edge = (id: string) =>
          capture.mermaidLastLayoutCapture.layout.edges.find((e) => e.id === id)!;
        return {
          validation: capture.mermaidValidateLastLayout(),
          centerOffset: (node('J').x + node('K').x) / 2 - node('I').x,
          facingOffset: node('J').y - node('J').height / 2 - node('K').y + node('K').height / 2,
          entry: edge('L_D_F_0').points,
          predecessor: edge('L_C_D_0').points,
          first: edge('L_I_J_0').points,
          second: edge('L_I_K_0').points,
          forkX: node('I').x,
        };
      });
      expect(result.centerOffset).toBeCloseTo(0, 6);
      expect(Math.abs(result.facingOffset)).toBeLessThan(1);
      expect(result.entry).toHaveLength(2);
      expect(result.predecessor).toHaveLength(2);
      expect(result.entry[0].y).toBeCloseTo(result.entry[1].y, 6);
      expect(result.second).toHaveLength(result.first.length);
      expect(result.first.length).toBeLessThanOrEqual(4);
      result.first.forEach((point, index) => {
        expect(point.y).toBeCloseTo(result.second[index].y, 6);
        expect((point.x + result.second[index].x) / 2).toBeCloseTo(result.forkX, 6);
      });
      expect(result.validation.ok).toBe(true);
      expect(result.validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual(
        []
      );
      expect(result.validation.breakdown.crossings).toBe(0);
      expect(result.validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(10);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('terminal-frame-fan.png') });
    });
  }
}
