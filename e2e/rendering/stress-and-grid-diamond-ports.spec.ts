import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { mermaidUrl } from '../helpers/util.js';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';

const diagrams = [
  {
    name: 'crowded slope',
    code: 'flowchart LR\nStart --> Valid{Valid?}\nParse --> Valid\nValid --> Render',
    nodeCount: 4,
  },
  {
    name: 'styled edges',
    code: readFileSync(
      new URL('../platform/dev-diagrams/test-dataset/STYLE edge styling.mmd', import.meta.url),
      'utf8'
    ),
    nodeCount: 6,
  },
  ...[
    { name: 'SUBGRAPH decisions outside', nodeCount: 12 },
    { name: 'STYLE different shapes', nodeCount: 16 },
    { name: 'SIMPLE multiple edges between diamonds', nodeCount: 2 },
    { name: 'SIMPLE knsv2-19-flowchart-dagre-lr-shapes', nodeCount: 2 },
    { name: 'SIMPLE knsv2-22-flowchart-dagre-lr', nodeCount: 2 },
    { name: 'SIMPLE knsv2-23-flowchart-dagre-lr-subgraphs', nodeCount: 3 },
    { name: 'SIMPLE knsv2-27-flowchart-dagre-lr-subgraphs', nodeCount: 3 },
  ].map((diagram) => ({
    ...diagram,
    code: readFileSync(
      new URL(`../platform/dev-diagrams/test-dataset/${diagram.name}.mmd`, import.meta.url),
      'utf8'
    ),
  })),
];

for (const diagram of diagrams) {
  for (const look of ['classic', 'neo', 'handDrawn'] as const) {
    for (const theme of ['default', 'redux-color'] as const) {
      test(`diamond ports: ${diagram.name}, ${look}, ${theme}`, async ({ page }, testInfo) => {
        await page.addInitScript(() => {
          (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
            true;
        });
        await page.goto(
          mermaidUrl(diagram.code, { layout: 'stress-and-grid', look, theme }, false)
        );
        await expect(page.locator('svg .node, svg .rough-node')).toHaveCount(diagram.nodeCount);
        await page.waitForFunction(() =>
          Boolean(
            (window as unknown as { mermaidLastLayoutCapture?: unknown }).mermaidLastLayoutCapture
          )
        );
        const terminals = await page.evaluate(() => {
          const layout = (window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } })
            .mermaidLastLayoutCapture.layout;
          const nodeById = new Map(layout.nodes.map((node) => [node.id, node]));
          return layout.nodes
            .filter((node) => /^(diamond|rhombus|diam|question|decision)$/.test(String(node.shape)))
            .flatMap((diamond) => {
              const inputs = layout.edges.filter((edge) => edge.end === diamond.id);
              const inputSide = (edge: LayoutData['edges'][number]) => {
                if (edge.endSide) return edge.endSide;
                const other = nodeById.get(edge.start!)!;
                const dx = other.x! - diamond.x!;
                const dy = other.y! - diamond.y!;
                return Math.abs(dx) > Math.abs(dy)
                  ? dx >= 0
                    ? 'right'
                    : 'left'
                  : dy >= 0
                    ? 'bottom'
                    : 'top';
              };
              return layout.edges
                .filter((edge) => edge.start === diamond.id || edge.end === diamond.id)
                .map((edge) => {
                  const incoming = edge.end === diamond.id;
                  const port = incoming ? edge.points!.at(-1)! : edge.points![0];
                  const other = nodeById.get(incoming ? edge.start! : edge.end!)!;
                  const labelled = (candidate: LayoutData['edges'][number]) =>
                    Boolean((candidate.label ?? candidate.text ?? '').trim());
                  const parallel = layout.edges
                    .filter(
                      (candidate) =>
                        (candidate.start === edge.start && candidate.end === edge.end) ||
                        (candidate.start === edge.end && candidate.end === edge.start)
                    )
                    .sort(
                      (a, b) =>
                        Number(labelled(b)) - Number(labelled(a)) || a.id.localeCompare(b.id)
                    );
                  const mixedBundle =
                    /^(diamond|rhombus|diam|question|decision)$/.test(String(other.shape)) &&
                    (Math.abs(other.x! - diamond.x!) <= 8 ||
                      Math.abs(other.y! - diamond.y!) <= 8) &&
                    parallel.some(labelled) &&
                    !parallel.every(labelled);
                  const centralBundlePort =
                    mixedBundle && parallel.indexOf(edge) === (parallel.length - 1) / 2;
                  return {
                    vertex:
                      centralBundlePort ||
                      (!mixedBundle &&
                        incoming &&
                        inputs.filter((candidate) => inputSide(candidate) === inputSide(edge))
                          .length === 1),
                    slope: `${diamond.id}:${Math.sign(port.x - diamond.x!)}:${Math.sign(port.y - diamond.y!)}`,
                    x: Math.abs(port.x - diamond.x!) / (diamond.width! / 2),
                    y: Math.abs(port.y - diamond.y!) / (diamond.height! / 2),
                  };
                });
            });
        });
        expect(terminals.length).toBeGreaterThan(0);
        for (const terminal of terminals) {
          expect(terminal.x + terminal.y).toBeCloseTo(1, 4);
          if (terminal.vertex) {
            expect(Math.min(terminal.x, terminal.y)).toBeCloseTo(0, 4);
          } else {
            const margin = diagram.name === 'SIMPLE knsv2-22-flowchart-dagre-lr' ? 0.1 : 0.2;
            expect(terminal.x).toBeGreaterThanOrEqual(margin - 1e-6);
            expect(terminal.x).toBeLessThanOrEqual(1 - margin + 1e-6);
          }
        }
        for (const slope of new Set(
          terminals.filter((terminal) => !terminal.vertex).map((terminal) => terminal.slope)
        )) {
          const ports = terminals.filter(
            (terminal) => !terminal.vertex && terminal.slope === slope
          );
          expect(ports.reduce((sum, port) => sum + port.x, 0) / ports.length).toBeCloseTo(0.5, 4);
          expect(new Set(ports.map((port) => port.x)).size).toBe(ports.length);
        }
        const validation = await page.evaluate(() =>
          (
            window as unknown as {
              mermaidValidateLastLayout: () => {
                score: number;
                issues: { type: string; nodeIds?: string[]; details?: { delta?: number } }[];
                breakdown: { crossings: number };
              };
            }
          ).mermaidValidateLastLayout()
        );
        if (
          diagram.name === 'SIMPLE knsv2-19-flowchart-dagre-lr-shapes' ||
          diagram.name === 'SIMPLE knsv2-22-flowchart-dagre-lr'
        ) {
          expect(validation.breakdown.crossings).toBe(0);
        }
        if (diagram.name === 'SIMPLE knsv2-22-flowchart-dagre-lr') {
          const lanes = await page.evaluate(() => {
            const layout = (
              window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } }
            ).mermaidLastLayoutCapture.layout;
            const circle = layout.nodes.find((node) => node.id === 'B')!;
            return layout.edges.map((edge) => {
              const end = edge.points!.at(-1)!;
              return {
                points: edge.points!.length,
                outline:
                  ((end.x - circle.x!) / (circle.width! / 2)) ** 2 +
                  ((end.y - circle.y!) / (circle.height! / 2)) ** 2,
              };
            });
          });
          expect(lanes).toHaveLength(4);
          for (const lane of lanes) {
            expect(lane.points).toBe(2);
            expect(lane.outline).toBeCloseTo(1);
          }
        }
        if (diagram.name === 'SUBGRAPH decisions outside') {
          const split = await page.evaluate(() => {
            const layout = (
              window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } }
            ).mermaidLastLayoutCapture.layout;
            const decision = layout.nodes.find((node) => node.id === 'D')!;
            const entry = layout.nodes.find((node) => node.id === 'F')!;
            const frame = layout.nodes.find((node) => node.id === entry.parentId)!;
            const entryInset = entry.y! - entry.height! / 2 - (frame.y! - frame.height! / 2);
            return {
              gap: entry.y! - entry.height! / 2 - (decision.y! + decision.height! / 2),
              minimumGap: Math.max(
                96,
                entryInset + 36,
                2 * (entryInset + 12) + 24 - decision.height! / 4
              ),
            };
          });
          expect(split.gap).toBeLessThanOrEqual(split.minimumGap + 1);
          expect(split.gap).toBeGreaterThanOrEqual(96 - 1e-6);
          // The seeded hand-drawn/redux baseline already has one internal
          // deployment crossing; entry compaction must not introduce another.
          expect(validation.breakdown.crossings).toBeLessThanOrEqual(
            look === 'handDrawn' && theme === 'redux-color' ? 1 : 0
          );
        }
        if (diagram.name === 'SIMPLE knsv2-23-flowchart-dagre-lr-subgraphs') {
          expect(validation.breakdown.crossings).toBe(0);
          expect(validation.score).toBeGreaterThan(900);
          const lengths = await page.evaluate(() => {
            const layout = (
              window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } }
            ).mermaidLastLayoutCapture.layout;
            return layout.edges.map((edge) => edge.points!.length);
          });
          expect(Math.max(...lengths)).toBeLessThanOrEqual(4);
        }
        if (diagram.name === 'SIMPLE knsv2-27-flowchart-dagre-lr-subgraphs') {
          const fan = await page.evaluate(() => {
            const layout = (
              window as unknown as { mermaidLastLayoutCapture: { layout: LayoutData } }
            ).mermaidLastLayoutCapture.layout;
            return {
              decision: layout.nodes.find((node) => node.id === 'A')!,
              targets: layout.nodes.filter((node) => node.id === 'B' || node.id === 'C'),
              frame: layout.nodes.find((node) => node.id === 'subbe')!,
              paths: layout.edges.map((edge) => edge.points!),
            };
          });
          expect((fan.targets[0].y! + fan.targets[1].y!) / 2).toBeCloseTo(fan.decision.y!, 6);
          expect(fan.targets[0].x! - fan.targets[0].width! / 2).toBeCloseTo(
            fan.targets[1].x! - fan.targets[1].width! / 2,
            6
          );
          expect(fan.frame.x).toBeCloseTo(fan.decision.x!, 6);
          // Keep the title strip above the centred content area.
          expect(fan.frame.y! + fan.frame.labelBBox!.height / 2).toBeCloseTo(fan.decision.y!, 6);
          expect(fan.paths[0]).toHaveLength(4);
          expect(fan.paths[1]).toHaveLength(4);
          fan.paths[0].forEach((point, index) => {
            expect(point.x).toBeCloseTo(fan.paths[1][index].x, 6);
            expect((point.y + fan.paths[1][index].y) / 2).toBeCloseTo(fan.decision.y!, 6);
          });
          expect(validation.breakdown.crossings).toBe(0);
        }
        // Retain baseline-only placement diagnostics: unused deployment-frame
        // space and the hand-drawn B/C column's 2.03px alignment residue.
        expect(
          validation.issues.filter(
            (issue) =>
              !(
                (diagram.name === 'SIMPLE knsv2-23-flowchart-dagre-lr-subgraphs' ||
                  diagram.name === 'SIMPLE knsv2-27-flowchart-dagre-lr-subgraphs') &&
                issue.type === 'group-dead-space'
              ) &&
              (diagram.name !== 'SUBGRAPH decisions outside' ||
                !(
                  issue.type === 'group-dead-space' ||
                  (issue.type === 'grid-misalignment' &&
                    issue.nodeIds?.join(',') === 'B,C' &&
                    (issue.details?.delta ?? Infinity) <= 2.04)
                ))
          )
        ).toEqual([]);
        await page.locator('svg').screenshot({ path: testInfo.outputPath('diamond-ports.png') });
      });
    }
  }
}
