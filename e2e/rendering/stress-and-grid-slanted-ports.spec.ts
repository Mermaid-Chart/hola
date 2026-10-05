import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/SIMPLE knsv2-20-flowchart-dagre-lr-shapes-node-placement.mmd',
    import.meta.url
  ),
  'utf8'
);

for (const look of ['classic', 'neo', 'handDrawn'] as const) {
  for (const theme of ['default', 'redux-color'] as const) {
    test(`slanted parallel ports: ${look}, ${theme}`, async ({ page }, testInfo) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout: 'stress-and-grid', look, theme }, false));
      await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(3);
      await page.waitForFunction(() =>
        Boolean(
          (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
        )
      );
      const result = await page.evaluate(() => {
        return (
          window as unknown as {
            mermaidValidateLastLayout: () => {
              issues: unknown[];
              breakdown: { crossings: number };
            };
          }
        ).mermaidValidateLastLayout();
      });
      expect(result.issues).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      const attachments = await page.evaluate(() => {
        const layout = (window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } })
          .mermaidLastLayoutCapture.layout;
        return layout.edges.flatMap((edge) =>
          (['start', 'end'] as const).map((terminal) => {
            const node = layout.nodes.find((candidate) => candidate.id === edge[terminal])!;
            const group = document.querySelector<SVGGElement>(`[id="${node.domId}"]`)!;
            const point = terminal === 'start' ? edge.points![0] : edge.points!.at(-1)!;
            const localPort = { x: point.x - node.x!, y: point.y - node.y! };
            // Read the drawn polygon, not the router's outline helper. Rough
            // looks use paths; sampling their strokes also catches visible gaps.
            const polygon = group.querySelector<SVGPolygonElement>('polygon');
            const outlines: { x: number; y: number }[][] = [];
            if (polygon) {
              const transform = group.getCTM()!.inverse().multiply(polygon.getCTM()!);
              outlines.push([...polygon.points].map((p) => p.matrixTransform(transform)));
            } else {
              for (const path of group.querySelectorAll<SVGPathElement>('path')) {
                const transform = group.getCTM()!.inverse().multiply(path.getCTM()!);
                const length = path.getTotalLength();
                outlines.push(
                  Array.from({ length: Math.ceil(length) + 1 }, (_, index) =>
                    path.getPointAtLength(Math.min(index, length)).matrixTransform(transform)
                  )
                );
              }
            }
            const distances = outlines.flatMap((vertices) =>
              vertices.map((a, index) => {
                const b = vertices[(index + 1) % vertices.length];
                const dx = b.x - a.x;
                const dy = b.y - a.y;
                const denominator = dx * dx + dy * dy;
                const t =
                  denominator === 0
                    ? 0
                    : Math.max(
                        0,
                        Math.min(
                          1,
                          ((localPort.x - a.x) * dx + (localPort.y - a.y) * dy) / denominator
                        )
                      );
                return Math.hypot(localPort.x - a.x - t * dx, localPort.y - a.y - t * dy);
              })
            );
            return { edge: edge.id, terminal, outlineDistance: Math.min(...distances) };
          })
        );
      });
      expect(attachments).toHaveLength(6);
      for (const attachment of attachments) {
        expect(
          attachment.outlineDistance,
          `${attachment.edge}:${attachment.terminal}`
        ).toBeLessThan(look === 'handDrawn' ? 2 : 0.01);
      }
      await page.locator('svg').screenshot({ path: testInfo.outputPath('slanted-ports.png') });
    });
  }
}
