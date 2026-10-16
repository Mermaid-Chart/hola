import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

test('short compound return routes keep measured frame titles clear', async ({ page }) => {
  const code = readFileSync(
    new URL(
      '../platform/dev-diagrams/test-dataset/VERBOSE nodes within subgraphs.mmd',
      import.meta.url
    ),
    'utf8'
  );
  await page.addInitScript(() => {
    (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
  });
  await page.goto(mermaidUrl(code, { layout: 'gipsec', look: 'classic', theme: 'default' }, false));
  await expect(page.locator('svg .node')).toHaveCount(16);
  const collision = await page.evaluate(() => {
    const { layout } = (
      window as unknown as {
        mermaidLastLayoutCapture: {
          layout: {
            nodes: {
              id: string;
              x: number;
              y: number;
              height: number;
              labelBBox?: { width: number; height: number };
            }[];
            edges: { start: string; end: string; points: { x: number; y: number }[] }[];
          };
        };
      }
    ).mermaidLastLayoutCapture;
    const frame = layout.nodes.find((node) => node.id === 'Backend')!;
    const points = layout.edges.find((edge) => edge.start === 'PUB' && edge.end === 'APP')!.points;
    const left = frame.x - frame.labelBBox!.width / 2;
    const right = frame.x + frame.labelBBox!.width / 2;
    const top = frame.y - frame.height / 2;
    const bottom = top + frame.labelBBox!.height;
    return points.slice(1).some((b, i) => {
      const a = points[i];
      return Math.abs(a.x - b.x) < 1
        ? a.x > left && a.x < right && Math.max(a.y, b.y) > top && Math.min(a.y, b.y) < bottom
        : a.y > top && a.y < bottom && Math.max(a.x, b.x) > left && Math.min(a.x, b.x) < right;
    });
  });
  expect(collision, 'The pub/sub return must not pass through the Backend title').toBe(false);
});
