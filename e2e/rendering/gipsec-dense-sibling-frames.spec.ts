import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/VERBOSE nodes within subgraphs.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`dense sibling-frame member links: ${look}, ${theme}`, async ({ page }, testInfo) => {
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
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: { type: string }[];
            breakdown: { crossings: number; edges: { points: number }[] };
          };
          mermaidLastLayoutCapture: {
            layout: {
              nodes: { id: string; x: number; y: number; width: number; height: number }[];
              edges: { start: string; end: string; points: { x: number; y: number }[] }[];
            };
          };
        };
        return {
          ...capture.mermaidValidateLastLayout(),
          layout: capture.mermaidLastLayoutCapture.layout,
        };
      });
      // Use the validator's hard/soft distinction; soft grades stay visible.
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(
        result.issues.filter((issue) => issue.type === 'edge-bend-overlaps-arrowhead')
      ).toEqual([]);
      expect(result.breakdown.crossings).toBeLessThanOrEqual(20);
      expect(Math.max(...result.breakdown.edges.map((edge) => edge.points))).toBeLessThanOrEqual(
        10
      );
      const storage = result.layout.edges.find(
        (edge) => edge.start === 'APP' && edge.end === 'OBJ'
      )!;
      const feedback = result.layout.edges.find(
        (edge) => edge.start === 'PUB' && edge.end === 'APP'
      )!;
      const crossings: unknown[] = [];
      for (let i = 1; i < storage.points.length; i++) {
        for (let j = 1; j < feedback.points.length; j++) {
          const a = storage.points[i - 1],
            b = storage.points[i];
          const c = feedback.points[j - 1],
            d = feedback.points[j];
          const horizontalA = Math.abs(a.y - b.y) < 1;
          if (horizontalA === Math.abs(c.y - d.y) < 1) continue;
          const [h1, h2, v1, v2] = horizontalA ? [a, b, c, d] : [c, d, a, b];
          if (
            v1.x > Math.min(h1.x, h2.x) + 1 &&
            v1.x < Math.max(h1.x, h2.x) - 1 &&
            h1.y > Math.min(v1.y, v2.y) + 1 &&
            h1.y < Math.max(v1.y, v2.y) - 1
          ) {
            crossings.push([a, b, c, d]);
          }
        }
      }
      expect(crossings, 'Storage and pub/sub lanes must not swap order').toEqual([]);
      const worker = result.layout.nodes.find((node) => node.id === 'WK')!;
      const route = result.layout.edges.find(
        (edge) => edge.start === 'WK' && edge.end === 'OBS'
      )!.points;
      const [port, next] = route;
      // The path may detour around foreign obstacles, but must not orbit its
      // own source after leaving one of its sides.
      const wrapsSource = route.some((point) =>
        next.x > port.x + 1
          ? point.x < worker.x - worker.width / 2 - 1
          : next.x < port.x - 1
            ? point.x > worker.x + worker.width / 2 + 1
            : next.y > port.y + 1
              ? point.y < worker.y - worker.height / 2 - 1
              : point.y > worker.y + worker.height / 2 + 1
      );
      expect(wrapsSource, 'Workers-to-monitoring must not wrap around Workers').toBe(false);
      await page
        .locator('svg')
        .screenshot({ path: testInfo.outputPath('dense-sibling-frames.png') });
    });
  }
}
