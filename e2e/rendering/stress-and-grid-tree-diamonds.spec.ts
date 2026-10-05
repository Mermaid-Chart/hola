import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/TREE diamonds.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`three straight symmetric diamond fans: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(
        mermaidUrl(code, { layout: 'stress-and-grid', look, theme, handDrawnSeed: 1 }, false)
      );
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(14);
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
              edges: { id: string; start: string; points: { x: number; y: number }[] }[];
            };
          };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        const { nodes, edges } = capture.mermaidLastLayoutCapture.layout;
        const node = (id: string) => nodes.find((n) => n.id === id)!;
        return {
          validation: capture.mermaidValidateLastLayout(),
          edges: edges.map((edge) => edge.points),
          fans: [
            ['C', 'D', 'E', 'F'],
            ['n1', 'n2', 'n3', 'n4'],
            ['n5', 'n6', 'n7', 'n8'],
          ].map(([source, above, forward, below]) => ({
            aboveX: node(above).x - node(source).x,
            belowX: node(below).x - node(source).x,
            forwardY: node(forward).y - node(source).y,
            symmetry:
              (node(above).y + node(above).height / 2 + node(below).y - node(below).height / 2) /
                2 -
              node(source).y,
            departures: edges.filter((edge) => edge.start === source).map((edge) => edge.points[0]),
            source: node(source),
          })),
        };
      });
      expect(result.validation.ok).toBe(true);
      expect(result.validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual(
        []
      );
      expect(result.validation.breakdown.crossings).toBe(0);
      expect(result.validation.breakdown.totalBendPenalty).toBe(0);
      result.edges.forEach((points) => expect(points).toHaveLength(2));
      for (const fan of result.fans) {
        expect(fan.aboveX).toBeCloseTo(0, 6);
        expect(fan.belowX).toBeCloseTo(0, 6);
        expect(fan.forwardY).toBeCloseTo(0, 6);
        expect(Math.abs(fan.symmetry)).toBeLessThan(1);
        expect(fan.departures[0].x).toBeCloseTo(fan.source.x, 6);
        expect(fan.departures[0].y).toBeCloseTo(fan.source.y - fan.source.height / 2, 6);
        expect(fan.departures[2].x).toBeCloseTo(fan.source.x, 6);
        expect(fan.departures[2].y).toBeCloseTo(fan.source.y + fan.source.height / 2, 6);
      }
      await page.locator('svg').screenshot({ path: testInfo.outputPath('tree-diamonds.png') });
    });
  }
}
