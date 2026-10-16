import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/gipsec/verbose-choices.sizes.json'
    ),
    'utf8'
  )
) as { variants: Record<string, Record<string, { width: number; height: number }>> };

async function measuredLayout(variant: string) {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/VERBOSE choices.mmd'),
    { stampFlowchartRendererFields: true }
  );
  for (const node of layout.nodes) {
    const size = measurements.variants[variant][node.id];
    expect(size, `measurement for ${node.id}`).toBeDefined();
    Object.assign(node, size);
  }
  return layout;
}

describe('gipsec DDLT — verbose choices', () => {
  it('recognizes branch topology rather than node IDs or label text', async () => {
    const original = await measuredLayout('classic-default');
    const renamed = await measuredLayout('classic-default');
    const ids = new Map(renamed.nodes.map((node, index) => [node.id, `step-${index}`]));
    for (const node of renamed.nodes) {
      node.id = ids.get(node.id)!;
      node.label = 'Changed content with preserved measured size';
    }
    for (const edge of renamed.edges) {
      edge.id = `renamed-${edge.id}`;
      edge.start = ids.get(edge.start!)!;
      edge.end = ids.get(edge.end!)!;
    }
    runStressAndGridLayoutCore(original);
    runStressAndGridLayoutCore(renamed);
    expect(renamed.nodes.map(({ x, y }) => ({ x, y }))).toEqual(
      original.nodes.map(({ x, y }) => ({ x, y }))
    );
    expect(renamed.edges.map(({ points }) => points)).toEqual(
      original.edges.map(({ points }) => points)
    );
  });
  it.each(Object.keys(measurements.variants))(
    'keeps the split and merge symmetric and the health branch in its column with %s',
    async (variant) => {
      const layout = await measuredLayout(variant);
      runStressAndGridLayoutCore(layout);
      const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
      const edge = (start: string, end: string) =>
        layout.edges.find((candidate) => candidate.start === start && candidate.end === end)!;
      const axis = node('n0').x!;
      expect((node('nj').x! + node('nw').x!) / 2).toBeCloseTo(axis, 6);
      for (const id of ['ni', 'ns', 'n2']) {
        expect(node(id).x, id).toBeCloseTo(axis, 6);
      }
      for (const [leftId, rightId, merge] of [
        ['L_n0_nj_0', 'L_n0_nw_0', false],
        ['L_nj_ni_0', 'L_nw_ni_0', true],
      ] as const) {
        const left = layout.edges.find((candidate) => candidate.id === leftId)!.points!;
        const right = layout.edges.find((candidate) => candidate.id === rightId)!.points!;
        expect(left).toHaveLength(4);
        expect(right).toHaveLength(4);
        expect(left[1].y).toBeCloseTo(right[1].y, 6);
        expect(left[2].y).toBeCloseTo(right[2].y, 6);
        expect((left[merge ? 3 : 0].x + right[merge ? 3 : 0].x) / 2).toBeCloseTo(axis, 6);
      }
      expect(edge('ni', 'ns').points).toHaveLength(2);
      expect(edge('ns', 'n2').points).toHaveLength(2);
      const arrivals = layout.edges
        .filter((candidate) => candidate.end === 'ne')
        .sort((a, b) => node(a.start!).x! - node(b.start!).x!);
      expect(arrivals.map((arrival) => arrival.points!.at(-1)!.x)).toEqual(
        arrivals.map((arrival) => arrival.points!.at(-1)!.x).sort((a, b) => a - b)
      );
      const result = validateLayout(layout);
      expect(result.issues).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThan(100);
    }
  );
});
