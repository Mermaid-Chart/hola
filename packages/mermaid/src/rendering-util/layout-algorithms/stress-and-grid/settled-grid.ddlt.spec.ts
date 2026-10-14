import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { normalizePolyline } from '../layout-utils/geometry.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/settled-grid.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    Record<string, { width: number; height: number; labelBBox?: { width: number; height: number } }>
  >;
};

async function measuredLayout(variant = 'classic-default') {
  const layout = await parseMmdFileToLayoutData(
    resolve(
      process.cwd(),
      'e2e/platform/dev-diagrams/test-dataset/GRAPH from holapaper7 with subgraph 2 nodes.mmd'
    ),
    { stampFlowchartRendererFields: true }
  );
  for (const node of layout.nodes) {
    const size = measurements.variants[variant][node.id];
    expect(size, `captured measurement for ${node.id}`).toBeDefined();
    Object.assign(node, size);
  }
  return layout;
}

describe('stress-and-grid DDLT — settled grid alignment', () => {
  it('compacts unconstrained straight terminal branches to one measured grid step', async () => {
    const layout = await measuredLayout();
    const { options } = runStressAndGridLayoutCore(layout);
    const parent = layout.nodes.find((node) => node.id === 'A2')!;
    for (const [id, axis] of [
      ['A21', 'x'],
      ['A22', 'y'],
    ] as const) {
      const child = layout.nodes.find((node) => node.id === id)!;
      expect(Math.abs(child[axis]! - parent[axis]!), id).toBeLessThanOrEqual(options.gridSpacing);
      expect(layout.edges.find((edge) => edge.end === id)!.points).toHaveLength(2);
    }
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
  it('centres a free terminal port even when an offset attachment is shorter', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const child = layout.nodes.find((node) => node.id === 'G12')!;
    const edge = layout.edges.find((member) => member.end === child.id)!;
    const parent = layout.nodes.find((node) => node.id === edge.start)!;
    expect(edge.points![0].y).toBeCloseTo(parent.y!, 6);
    expect(edge.points!.at(-1)!.x).toBeCloseTo(child.x!, 6);
    expect(edge.points!.at(-1)!.y).toBeCloseTo(child.y! + child.height! / 2, 6);
    expect(validateLayout(layout).ok).toBe(true);
  });
  it('uses one-bend side entries beside an occupied straight continuation', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    for (const [start, end, junctionId, terminal, side] of [
      ['B', 'D', 'D', 'end', -1],
      ['D', 'F', 'D', 'start', 1],
      ['F', 'G', 'G', 'end', 1],
    ] as const) {
      const edge = layout.edges.find((member) => member.start === start && member.end === end)!;
      const junction = layout.nodes.find((node) => node.id === junctionId)!;
      expect(normalizePolyline(edge.points!).points, `${start}–${end}`).toHaveLength(3);
      const port = terminal === 'start' ? edge.points![0] : edge.points!.at(-1)!;
      expect(port.x).toBeCloseTo(junction.x! + (side * junction.width!) / 2, 6);
      expect(port.y).toBeCloseTo(junction.y!, 6);
    }
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
  it('uses topology and measurements rather than IDs or label text', async () => {
    const layout = await measuredLayout();
    const ids = new Map(layout.nodes.map((node, index) => [node.id, `vertex-${index}`]));
    for (const node of layout.nodes) {
      node.id = ids.get(node.id)!;
      node.parentId = node.parentId ? ids.get(node.parentId) : undefined;
      node.label = 'Different content with the same measured dimensions';
    }
    for (const [index, edge] of layout.edges.entries()) {
      edge.id = `link-${index}`;
      edge.start = ids.get(edge.start!)!;
      edge.end = ids.get(edge.end!)!;
    }
    const { options } = runStressAndGridLayoutCore(layout);
    const node = (original: string) =>
      layout.nodes.find((member) => member.id === ids.get(original))!;
    expect(node('A').x).toBeCloseTo(node('B').x!, 6);
    expect(node('A11').x).toBeCloseTo(node('G12').x!, 6);
    expect(node('F2').y).toBeCloseTo(node('F21').y!, 6);
    expect(Math.abs(node('A21').x! - node('A2').x!)).toBeLessThanOrEqual(options.gridSpacing);
    expect(Math.abs(node('A22').y! - node('A2').y!)).toBeLessThanOrEqual(options.gridSpacing);
    const sideEntry = layout.edges.find(
      (edge) => edge.start === ids.get('B') && edge.end === ids.get('D')
    )!;
    expect(normalizePolyline(sideEntry.points!).points).toHaveLength(3);
    const framedEntry = layout.edges.find((edge) => edge.end === ids.get('G12'))!;
    expect(framedEntry.points!.at(-1)!.x).toBeCloseTo(node('G12').x!, 6);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
  it('retains minimum-length constraints on an otherwise free terminal branch', async () => {
    const layout = await measuredLayout();
    const edge = layout.edges.find((member) => member.end === 'A22')!;
    edge.minlen = 2;
    const { options } = runStressAndGridLayoutCore(layout);
    const parent = layout.nodes.find((node) => node.id === 'A2')!;
    const child = layout.nodes.find((node) => node.id === 'A22')!;
    expect(Math.abs(child.y! - parent.y!)).toBeGreaterThan(options.gridSpacing);
    expect(edge.minlen).toBe(2);
    expect(edge.start).toBe(parent.id);
    expect(edge.end).toBe(child.id);
  });
  it('does not straighten a terminal with explicitly constrained ports', async () => {
    const layout = await measuredLayout();
    const edge = layout.edges.find((member) => member.start === 'F2' && member.end === 'F21')!;
    edge.startSide = 'right';
    edge.endSide = 'left';
    const topology = layout.edges.map(({ id, start, end, startSide, endSide }) => ({
      id,
      start,
      end,
      startSide,
      endSide,
    }));
    const parents = layout.nodes.map(({ id, parentId }) => ({ id, parentId }));
    runStressAndGridLayoutCore(layout);
    const parent = layout.nodes.find((node) => node.id === 'F2')!;
    const child = layout.nodes.find((node) => node.id === 'F21')!;
    expect(Math.abs(parent.y! - child.y!)).toBeGreaterThan(1);
    expect(
      layout.edges.map(({ id, start, end, startSide, endSide }) => ({
        id,
        start,
        end,
        startSide,
        endSide,
      }))
    ).toEqual(topology);
    expect(layout.nodes.map(({ id, parentId }) => ({ id, parentId }))).toEqual(parents);
  });
  it('retains safe near-axis alignment when a different proposal cannot be accepted', async () => {
    const layout = await measuredLayout('neo-default');
    runStressAndGridLayoutCore(layout);
    const parent = layout.nodes.find((node) => node.id === 'F1')!;
    const child = layout.nodes.find((node) => node.id === 'F11')!;
    expect(parent.x).toBeCloseTo(child.x!, 6);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBeLessThanOrEqual(2);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(120);
  });
  it('keeps an unobstructed single-child continuation on its incoming row', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const parent = layout.nodes.find((node) => node.id === 'F2')!;
    const child = layout.nodes.find((node) => node.id === 'F21')!;
    expect(parent.y).toBeCloseTo(child.y!, 6);
    expect(
      layout.edges.find((edge) => edge.start === parent.id && edge.end === child.id)!.points
    ).toHaveLength(2);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
  it('aligns nearby sibling rows and the common column of unconnected frame members', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const node = (id: string) => layout.nodes.find((member) => member.id === id)!;
    expect(node('B').y).toBeCloseTo(node('C').y!, 6);
    expect(node('E').y).toBeCloseTo(node('F').y!, 6);
    expect(node('A11').x).toBeCloseTo(node('G12').x!, 6);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
  it('makes a nearly vertical cycle edge straight without losing its crossing-free layout', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const a = layout.nodes.find((node) => node.id === 'A')!;
    const b = layout.nodes.find((node) => node.id === 'B')!;
    expect(a.x).toBeCloseTo(b.x!, 6);
    expect(
      layout.edges.find((edge) => edge.start === 'A' && edge.end === 'B')!.points
    ).toHaveLength(2);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
});
