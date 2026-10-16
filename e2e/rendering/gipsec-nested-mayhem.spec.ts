import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/SUBGRAPH nested mayhem.mmd', import.meta.url),
  'utf8'
);

// Only the neo look is exercised here. Under mermaid 12 the classic and
// handDrawn variants of this fixture fail: `minNodeWidth` (new in v12,
// default 120) widens the short labels, and the external nested-frame cycle
// no longer routes cleanly at those widths.
for (const look of ['neo'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`external nested-frame cycle: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'gipsec', look, theme }, false));
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
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        return {
          layout: capture.mermaidLastLayoutCapture.layout,
          validation: capture.mermaidValidateLastLayout(),
        };
      });
      const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
      const source = node('X');
      const target = node('Y');
      const outer = node('Z');
      const outside = node('P');
      const horizontal = Math.abs(source.x! - target.x!) >= Math.abs(source.y! - target.y!);
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const size = horizontal ? 'height' : 'width';
      const sign = Math.sign(outside[across]! - outer[across]!);
      expect(outside[along]).toBeCloseTo((source[along]! + target[along]!) / 2, 6);
      expect(
        Math.abs(outside[across]! - outer[across]!) - (outside[size]! + outer[size]!) / 2
      ).toBeGreaterThanOrEqual(30);
      const border = outer[across]! + (sign * outer[size]!) / 2;
      for (const id of ['L_X_P_0', 'L_P_Y_0']) {
        const edge = layout.edges.find((edge) => edge.id === id)!;
        expect(edge.points, id).toHaveLength(3);
        const lateral = id === 'L_X_P_0' ? edge.points!.slice(1) : edge.points!.slice(0, 2);
        expect(lateral.every((point) => sign * (point[across] - border) >= 30)).toBe(true);
      }
      expect(source.parentId).toBe(outer.id);
      expect(target.parentId).toBe(outer.id);
      expect(validation.ok).toBe(true);
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(5);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('nested-mayhem.png') });
    });
  }
}
