import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

async function runEdgeTypes(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'edge-types.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'edge-types.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — edge types', () => {
  it('keeps labels in the central fan out of foreign edge corridors', async () => {
    const layout = await runEdgeTypes();
    const validation = validateLayout(layout);
    const foreignEdgeLabelOverlaps = validation.issues.filter(
      (issue) => issue.type === 'edge-label-overlaps-foreign-edge'
    );
    const labelsInTheCentralFan = layout.edges.filter((edge) =>
      ['L_C_E2_0', 'L_C_E3_0'].includes(edge.id)
    );
    const foreignPathIntersectsLabel = labelsInTheCentralFan.some((labelEdge) =>
      layout.edges
        .filter((edge) => edge.id !== labelEdge.id)
        .some((edge) => pathIntersectsLabel(edge.points, labelEdge))
    );
    expect(foreignEdgeLabelOverlaps).toEqual([]);
    expect(foreignPathIntersectsLabel).toBe(false);
    expect(
      layout.edges
        .filter((edge) => (edge.label ?? edge.text ?? '').trim())
        .every((edge) => pointIsOnPath({ x: edge.x!, y: edge.y! }, edge.points))
    ).toBe(true);
    expect(sharedPathLength(layout, 'L_M1_C_0', 'L_R2_C_0')).toBe(0);

    const e2 = layout.nodes.find((node) => node.id === 'E2')!;
    const e3 = layout.nodes.find((node) => node.id === 'E3')!;
    const e1 = layout.nodes.find((node) => node.id === 'E1')!;
    const e5 = layout.nodes.find((node) => node.id === 'E5')!;
    const m1 = layout.nodes.find((node) => node.id === 'M1')!;
    const c = layout.nodes.find((node) => node.id === 'C')!;
    const m1ToC = layout.edges.find((edge) => edge.id === 'L_M1_C_0')!;
    const longLabelEdge = layout.edges.find((edge) => edge.id === 'L_C_E3_0')!;
    expect(e3.y! - e2.y!).toBeGreaterThanOrEqual((e2.height! + e3.height!) / 2 + 96);
    expect(longLabelEdge.x).toBeCloseTo(e3.x!);
    expect(e1.y).toBeCloseTo(e5.y!);
    expect(m1.y).toBeCloseTo(c.y!);
    expect(m1ToC.points).toHaveLength(2);
  });
});

function pointIsOnPath(
  point: { x: number; y: number },
  points: { x: number; y: number }[]
): boolean {
  return points.slice(1).some((end, index) => {
    const start = points[index];
    if (start.x === end.x) {
      return (
        point.x === start.x &&
        point.y >= Math.min(start.y, end.y) &&
        point.y <= Math.max(start.y, end.y)
      );
    }
    return (
      point.y === start.y &&
      point.x >= Math.min(start.x, end.x) &&
      point.x <= Math.max(start.x, end.x)
    );
  });
}

function sharedPathLength(layout: LayoutData, firstId: string, secondId: string): number {
  const first = layout.edges.find((edge) => edge.id === firstId)?.points ?? [];
  const second = layout.edges.find((edge) => edge.id === secondId)?.points ?? [];
  let shared = 0;
  for (let firstIndex = 1; firstIndex < first.length; firstIndex++) {
    for (let secondIndex = 1; secondIndex < second.length; secondIndex++) {
      const a = first[firstIndex - 1];
      const b = first[firstIndex];
      const c = second[secondIndex - 1];
      const d = second[secondIndex];
      if (a.x === b.x && c.x === d.x && a.x === c.x) {
        shared += Math.max(
          0,
          Math.min(Math.max(a.y, b.y), Math.max(c.y, d.y)) -
            Math.max(Math.min(a.y, b.y), Math.min(c.y, d.y))
        );
      }
      if (a.y === b.y && c.y === d.y && a.y === c.y) {
        shared += Math.max(
          0,
          Math.min(Math.max(a.x, b.x), Math.max(c.x, d.x)) -
            Math.max(Math.min(a.x, b.x), Math.min(c.x, d.x))
        );
      }
    }
  }
  return shared;
}

function pathIntersectsLabel(
  points: { x: number; y: number }[],
  edge: LayoutData['edges'][number]
): boolean {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label || edge.x === undefined || edge.y === undefined) {
    return false;
  }
  const lines = label
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .split('\n');
  const width = Math.max(40, ...lines.map((line) => line.trim().length * 8));
  const height = Math.max(24, lines.length * 24);
  const left = edge.x - width / 2;
  const right = edge.x + width / 2;
  const top = edge.y - height / 2;
  const bottom = edge.y + height / 2;

  return points.slice(1).some((point, index) => {
    const start = points[index];
    if (start.x === point.x) {
      return (
        start.x > left &&
        start.x < right &&
        Math.max(start.y, point.y) > top &&
        Math.min(start.y, point.y) < bottom
      );
    }
    return (
      start.y > top &&
      start.y < bottom &&
      Math.max(start.x, point.x) > left &&
      Math.min(start.x, point.x) < right
    );
  });
}
