import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

const fixture = resolve(
  process.cwd(),
  'e2e/platform/dev-diagrams/test-dataset/VERBOSE converted from event modelling'
);
const measurements = JSON.parse(readFileSync(`${fixture}.sizes.json`, 'utf8')) as {
  nodes: { id: string; width: number; height: number }[];
};

async function measuredLayout() {
  const layout = await parseMmdFileToLayoutData(`${fixture}.mmd`, {
    stampFlowchartRendererFields: true,
  });
  for (const node of layout.nodes) {
    const size = measurements.nodes.find((entry) => entry.id === node.id);
    expect(size, `captured measurement for ${node.id}`).toBeDefined();
    node.width = size!.width;
    node.height = size!.height;
  }
  return layout;
}

describe('stress-and-grid DDLT — compact verbose continuations', () => {
  it('retains an already compact two-node continuation', async () => {
    const layout = await measuredLayout();
    layout.nodes = layout.nodes.slice(0, 2);
    const ids = new Set(layout.nodes.map((node) => node.id));
    layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
    // Browser measurements for the same pair rendered with the short C/S labels.
    layout.nodes[0].label = 'C';
    layout.nodes[0].width = 69.578125;
    layout.nodes[1].label = 'S';
    layout.nodes[1].width = 67.703125;
    runStressAndGridLayoutCore(layout);
    const [first, second] = layout.nodes;
    expect(Math.abs(first.y! - second.y!) - (first.height! + second.height!) / 2).toBeCloseTo(
      66,
      6
    );
    expect(validateLayout(layout).ok).toBe(true);
  });
  it.each(['TB', 'BT'])(
    'compacts a two-node continuation in %s despite wide captions',
    async (direction) => {
      const layout = await measuredLayout();
      layout.nodes = layout.nodes.slice(0, 2);
      const ids = new Set(layout.nodes.map((node) => node.id));
      layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
      layout.direction = direction;
      runStressAndGridLayoutCore(layout);
      const [first, second] = layout.nodes;
      expect(first.x).toBeCloseTo(second.x!, 6);
      expect(Math.abs(first.y! - second.y!) - (first.height! + second.height!) / 2).toBeCloseTo(
        50,
        6
      );
      expect(layout.edges[0].points).toHaveLength(2);
      expect(validateLayout(layout).ok).toBe(true);
    }
  );
  it('uses the requested rank clearance instead of imposing a fixed gap', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout, { rankSpacing: 180 });
    const [first, second] = layout.nodes;
    expect(Math.abs(first.y! - second.y!) - (first.height! + second.height!) / 2).toBeCloseTo(
      180,
      6
    );
    expect(validateLayout(layout).ok).toBe(true);
  });
  it.each(['ports', 'minimum-length', 'caption'] as const)(
    'preserves corridor space protected by %s',
    async (constraint) => {
      const layout = await measuredLayout();
      layout.nodes = layout.nodes.slice(0, 2);
      const ids = new Set(layout.nodes.map((node) => node.id));
      layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
      const edge = layout.edges[0];
      if (constraint === 'ports') {
        edge.startSide = 'bottom';
        edge.endSide = 'top';
      } else if (constraint === 'minimum-length') {
        edge.minlen = 2;
      } else {
        edge.label = 'Reserved caption';
        edge.width = 140;
        edge.height = 48;
      }
      runStressAndGridLayoutCore(layout);
      const [first, second] = layout.nodes;
      const gap = Math.abs(first.y! - second.y!) - (first.height! + second.height!) / 2;
      if (constraint === 'caption') {
        // A measured caption protects its height and clearance, not unused
        // solver space throughout the original width-derived grid band.
        expect(gap).toBeGreaterThanOrEqual(edge.height! + 24);
        expect(gap).toBeLessThan(200);
      } else {
        expect(gap).toBeGreaterThan(200);
      }
      expect(validateLayout(layout).ok).toBe(true);
    }
  );
  it('compacts by geometry rather than IDs, labels or class names', async () => {
    const layout = await measuredLayout();
    const ids = new Map(layout.nodes.map((node, index) => [node.id, `vertex-${index}`]));
    for (const node of layout.nodes) {
      node.id = ids.get(node.id)!;
      node.label = 'Renamed content with the same measured dimensions';
      node.cssClasses = 'different-class';
    }
    for (const [index, edge] of layout.edges.entries()) {
      edge.id = `link-${index}`;
      edge.start = ids.get(edge.start!)!;
      edge.end = ids.get(edge.end!)!;
    }
    runStressAndGridLayoutCore(layout);
    const height =
      Math.max(...layout.nodes.map((node) => node.y! + node.height! / 2)) -
      Math.min(...layout.nodes.map((node) => node.y! - node.height! / 2));
    expect(height).toBeLessThan(4000);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.totalBendPenalty).toBe(0);
  });
  it('keeps vertical tree continuations compact despite wide node captions', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
    const gaps = layout.edges.flatMap((edge) => {
      const source = nodes.get(edge.start!)!;
      const target = nodes.get(edge.end!)!;
      if (Math.abs(source.x! - target.x!) > 1) {
        return [];
      }
      return [Math.abs(source.y! - target.y!) - (source.height! + target.height!) / 2];
    });
    expect(gaps.length).toBeGreaterThan(20);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(120);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBe(0);
  });
});
