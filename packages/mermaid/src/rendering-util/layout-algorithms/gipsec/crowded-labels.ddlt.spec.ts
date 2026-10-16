import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { routeStressAndGridEdges } from './routing.js';

addDiagrams();
const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/gipsec/crowded-labels.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    {
      nodes: Record<string, { width: number; height: number }>;
      edges: Record<string, { width: number; height: number }>;
    }
  >;
};

async function measuredLayout(variant = 'classic-default') {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SIMPLE crowded labels.mmd'),
    { stampFlowchartRendererFields: true }
  );
  const sizes = measurements.variants[variant];
  for (const node of layout.nodes) {
    expect(sizes.nodes[node.id], `captured size for ${node.id}`).toBeDefined();
    Object.assign(node, sizes.nodes[node.id]);
  }
  for (const edge of layout.edges) {
    if ((edge.label ?? edge.text ?? '').trim()) {
      expect(sizes.edges[edge.id], `captured caption for ${edge.id}`).toBeDefined();
      Object.assign(edge, sizes.edges[edge.id]);
    }
  }
  return layout;
}

describe('gipsec DDLT — captioned reciprocal edges', () => {
  it.each(Object.keys(measurements.variants))(
    'keeps a captioned connection and its return clear with %s',
    async (variant) => {
      const layout = await measuredLayout(variant);
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThan(35);
    }
  );
  it('reserves measured caption clearance rather than a full width-derived grid band', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const source = layout.nodes.find((node) => node.id === 'USCompany')!;
    const target = layout.nodes.find((node) => node.id === 'HongKongCompany')!;
    const gap = Math.abs(target.y! - source.y!) - (source.height! + target.height!) / 2;
    expect(gap).toBeLessThan(150);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(35);
  });

  it('retains the improvement in the minimal two-node cycle', async () => {
    const layout = await measuredLayout();
    const ids = new Set(['USCompany', 'HongKongCompany']);
    layout.nodes = layout.nodes.filter((node) => ids.has(node.id));
    layout.edges = layout.edges.filter((edge) => ids.has(edge.start!) && ids.has(edge.end!));
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(35);
    const [source, target] = layout.nodes;
    expect(Math.abs(source.y! - target.y!) - (source.height! + target.height!) / 2).toBeLessThan(
      150
    );
  });

  it.each(['reordered', 'caption reversed'])('does not depend on the %s pair', async (variant) => {
    const layout = await measuredLayout();
    if (variant === 'reordered') {
      layout.edges.reverse();
    } else {
      const forward = layout.edges.find(
        (edge) => edge.start === 'USCompany' && edge.end === 'HongKongCompany'
      )!;
      const back = layout.edges.find(
        (edge) => edge.start === forward.end && edge.end === forward.start
      )!;
      Object.assign(back, { label: forward.label, width: forward.width, height: forward.height });
      forward.label = '';
    }
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(35);
  });

  it('reroutes renamed topology and caption text on the same measured geometry', async () => {
    const layout = await measuredLayout();
    const resultBeforeRename = runStressAndGridLayoutCore(layout);
    const names = new Map(layout.nodes.map((node, index) => [node.id, `unrelated-${index}`]));
    for (const node of layout.nodes) {
      node.id = names.get(node.id)!;
      node.label = `Other content ${node.id}`;
      node.cssClasses = 'another-class';
    }
    layout.edges.reverse().forEach((edge, index) => {
      edge.id = `other-edge-${index}`;
      edge.start = names.get(edge.start!)!;
      edge.end = names.get(edge.end!)!;
      if ((edge.label ?? edge.text ?? '').trim().length > 1) {
        edge.label = 'ABCDEFGHIJKLM';
      }
    });
    routeStressAndGridEdges(layout, resultBeforeRename.options.gridSpacing);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(35);
  });

  it.each(['ports', 'minimum length', 'unmeasured caption'])(
    'preserves a band constrained by %s',
    async (constraint) => {
      const layout = await measuredLayout();
      const back = layout.edges.find(
        (edge) => edge.start === 'HongKongCompany' && edge.end === 'USCompany'
      )!;
      if (constraint === 'ports') {
        back.startSide = 'top';
        back.endSide = 'bottom';
      } else if (constraint === 'minimum length') {
        back.minlen = 3;
      } else {
        const caption = layout.edges.find(
          (edge) => edge.start === back.end && edge.end === back.start
        )!;
        delete caption.width;
        delete caption.height;
      }
      runStressAndGridLayoutCore(layout);
      const source = layout.nodes.find((node) => node.id === back.start)!;
      const target = layout.nodes.find((node) => node.id === back.end)!;
      expect(
        Math.abs(source.y! - target.y!) - (source.height! + target.height!) / 2
      ).toBeGreaterThan(150);
      if (constraint === 'ports') {
        expect(back.points![0].y).toBeCloseTo(source.y! - source.height! / 2, 6);
        expect(back.points!.at(-1)!.y).toBeCloseTo(target.y! + target.height! / 2, 6);
        expect(back).toMatchObject({ startSide: 'top', endSide: 'bottom' });
      } else if (constraint === 'minimum length') {
        expect(back.minlen).toBe(3);
      }
      expect(validateLayout(layout).ok).toBe(true);
    }
  );

  it('keeps requested rank clearance and measured multi-line caption height', async () => {
    const layout = await measuredLayout();
    const caption = layout.edges.find((edge) => edge.end === 'HongKongCompany')!;
    caption.height = 120;
    runStressAndGridLayoutCore(layout, { rankSpacing: 180 });
    const source = layout.nodes.find((node) => node.id === caption.start)!;
    const target = layout.nodes.find((node) => node.id === caption.end)!;
    expect(
      Math.abs(source.y! - target.y!) - (source.height! + target.height!) / 2
    ).toBeGreaterThanOrEqual(180);
    expect(caption.height).toBe(120);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
  });
});
