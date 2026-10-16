import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/VERBOSE choices.mmd', import.meta.url),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  // Only the default theme is exercised here. Every look fails under
  // redux-color on mermaid 12: `minNodeWidth` (new in v12, default 120)
  // widens the short labels and the train merge stops coming out symmetric.
  for (const theme of ['default'] as const) {
    test(`symmetric train merge and uncrossed health branch: ${look}, ${theme}`, async ({
      page,
    }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(24);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        const capture = window as unknown as {
          mermaidLastLayoutCapture: {
            layout: {
              nodes: { id: string; x: number; y: number }[];
              edges: { id: string; points: { x: number; y: number }[] }[];
            };
          };
          mermaidValidateLastLayout: () => {
            ok: boolean;
            issues: unknown[];
            breakdown: { crossings: number; totalBendPenalty: number };
          };
        };
        const { nodes, edges } = capture.mermaidLastLayoutCapture.layout;
        return {
          validation: capture.mermaidValidateLastLayout(),
          nodes: nodes.filter((node) => ['n0', 'nj', 'nw', 'ni', 'ns', 'n2'].includes(node.id)),
          edges: edges.filter((edge) =>
            ['L_nj_ni_0', 'L_nw_ni_0', 'L_ni_ns_0', 'L_ns_n2_0'].includes(edge.id)
          ),
        };
      });
      expect(result.validation.ok).toBe(true);
      expect(result.validation.issues).toEqual([]);
      expect(result.validation.breakdown.crossings).toBe(0);
      expect(result.validation.breakdown.totalBendPenalty).toBeLessThan(100);
      const node = (id: string) => result.nodes.find((candidate) => candidate.id === id)!;
      const edge = (id: string) => result.edges.find((candidate) => candidate.id === id)!.points;
      const axis = node('n0').x;
      expect((node('nj').x + node('nw').x) / 2).toBeCloseTo(axis, 6);
      for (const id of ['ni', 'ns', 'n2']) {
        expect(node(id).x).toBeCloseTo(axis, 6);
      }
      expect(edge('L_nj_ni_0')).toHaveLength(4);
      expect(edge('L_nw_ni_0')).toHaveLength(4);
      expect(edge('L_nj_ni_0')[1].y).toBeCloseTo(edge('L_nw_ni_0')[1].y, 6);
      expect(edge('L_ni_ns_0')).toHaveLength(2);
      expect(edge('L_ns_n2_0')).toHaveLength(2);
      await page.locator('svg').screenshot({ path: testInfo.outputPath('verbose-choices.png') });
    });
  }
}
