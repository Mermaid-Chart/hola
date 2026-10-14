import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const code = readFileSync(
  new URL(
    '../platform/dev-diagrams/test-dataset/GRAPH from holapaper7 with subgraph 2 nodes.mmd',
    import.meta.url
  ),
  'utf8'
);

test('settled compound grid has aligned rows, columns and straight terminal continuations', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
  });
  await page.goto(
    mermaidUrl(code, { layout: 'stress-and-grid', look: 'classic', theme: 'default' }, false)
  );
  await expect(page.locator('svg .node')).toHaveCount(21);
  await page.waitForFunction(() => (window as unknown as { rendered: boolean }).rendered === true);
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
  const node = (id: string) => layout.nodes.find((member) => member.id === id)!;
  for (const [a, b, axis] of [
    ['A', 'B', 'x'],
    ['C', 'D', 'x'],
    ['E', 'F', 'y'],
    ['A2', 'A21', 'y'],
    ['F1', 'F11', 'x'],
    ['F1', 'F12', 'y'],
    ['F2', 'F21', 'y'],
    ['A11', 'G12', 'x'],
  ] as const) {
    expect(node(a)[axis], `${a}/${b} ${axis}-alignment`).toBeCloseTo(node(b)[axis]!, 6);
  }
  for (const [start, end] of [
    ['A', 'B'],
    ['C', 'D'],
    ['A2', 'A21'],
    ['A2', 'A22'],
    ['F1', 'F11'],
    ['F1', 'F12'],
    ['F2', 'F21'],
  ]) {
    expect(
      layout.edges.find((edge) => edge.start === start && edge.end === end)!.points,
      `${start}/${end} is straight`
    ).toHaveLength(2);
  }
  for (const [start, end, junctionId, terminal, side] of [
    ['B', 'D', 'D', 'end', -1],
    ['D', 'F', 'D', 'start', 1],
    ['F', 'G', 'G', 'end', 1],
  ] as const) {
    const edge = layout.edges.find((member) => member.start === start && member.end === end)!;
    const junction = node(junctionId);
    expect(edge.points, `${start}/${end} has one bend`).toHaveLength(3);
    const port = terminal === 'start' ? edge.points![0] : edge.points!.at(-1)!;
    expect(port.x).toBeCloseTo(junction.x! + (side * junction.width!) / 2, 6);
    expect(port.y).toBeCloseTo(junction.y!, 6);
  }
  const framedRoute = layout.edges.find((edge) => edge.end === 'G12')!.points!;
  expect(framedRoute[0].y).toBeCloseTo(node('G1').y!, 6);
  const framedPort = framedRoute.at(-1)!;
  expect(framedPort.x).toBeCloseTo(node('G12').x!, 6);
  expect(framedPort.y).toBeCloseTo(node('G12').y! + node('G12').height! / 2, 6);
  // These free terminal branches formerly reserved nearly two grid cells.
  expect(Math.abs(node('A21').x! - node('A2').x!)).toBeLessThan(150);
  expect(Math.abs(node('A22').y! - node('A2').y!)).toBeLessThan(150);
  expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
  expect(validation.issues.filter((issue) => issue.type === 'grid-misalignment')).toEqual([]);
  expect(validation.breakdown.crossings).toBe(0);
  expect(validation.breakdown.totalBendPenalty).toBeLessThan(70);
  await page.locator('svg').screenshot({ path: testInfo.outputPath('settled-grid.png') });
});
