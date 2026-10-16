import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SUBGRAPH connection caos.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`frame grid and bypasses: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(6);
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
      expect(validation.ok).toBe(true);
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(15);
      const frames = layout.nodes.filter((node) => node.isGroup).sort((a, b) => a.x! - b.x!);
      expect(frames.map((node) => node.id)).toEqual(['three', 'one', 'two']);
      const b1 = layout.nodes.find((node) => node.id === 'b1')!;
      const b2 = layout.nodes.find((node) => node.id === 'b2')!;
      const internalGap = b2.y! - b2.height! / 2 - (b1.y! + b1.height! / 2);
      expect(internalGap).toBeLessThanOrEqual(40);
      const gaps = frames
        .slice(1)
        .map(
          (node, index) => node.x! - node.width! / 2 - (frames[index].x! + frames[index].width! / 2)
        );
      expect(gaps[0]).toBeGreaterThanOrEqual(40);
      // The rough painter slightly expands each measured frame independently
      // after layout. Its irregular stroke bounds can differ by a subpixel.
      const frameTolerance = look === 'handDrawn' ? 1 : 1e-6;
      expect(Math.abs(gaps[0] - gaps[1])).toBeLessThan(frameTolerance);
      for (const frame of frames) {
        expect(
          Math.abs(frame.y! - frame.height! / 2 - (frames[0].y! - frames[0].height! / 2))
        ).toBeLessThan(frameTolerance);
      }
      const forward = layout.edges.find((edge) => edge.id === 'L_three_two_0')!.points!;
      const feedback = layout.edges.find((edge) => edge.id === 'L_two_c2_0')!.points!;
      expect(forward).toHaveLength(4);
      expect(feedback).toHaveLength(4);
      expect(Math.min(...forward.map((point) => point.y))).toBeLessThan(
        Math.min(...frames.map((node) => node.y! - node.height! / 2))
      );
      expect(Math.max(...feedback.map((point) => point.y))).toBeGreaterThan(
        Math.max(...frames.map((node) => node.y! + node.height! / 2))
      );
      await page.locator('svg').screenshot({ path: testInfo.outputPath('frame-grid.png') });
    });
  }
}
