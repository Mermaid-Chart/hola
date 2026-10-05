import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/verbose-choices.sizes.json'
    ),
    'utf8'
  )
) as { variants: Record<string, Record<string, { width: number; height: number }>> };

async function measuredLayout(variant = 'classic-default') {
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

describe('stress-and-grid DDLT — layered workflow constraint protection', () => {
  it.each(Object.keys(measurements.variants))(
    'retains the layered improvement for unconstrained %s workflows',
    async (variant) => {
      const layout = await measuredLayout(variant);
      runStressAndGridLayoutCore(layout);
      expect(layout.edges.every((edge) => edge.metadata?.stressAndGridLayered === true)).toBe(true);
    }
  );

  it.each(Object.keys(measurements.variants))(
    'preserves explicit departure and arrival ports with %s',
    async (variant) => {
      const layout = await measuredLayout(variant);
      const constrained = layout.edges.find((edge) => edge.start === 'ni' && edge.end === 'ns')!;
      constrained.startSide = 'left';
      constrained.endSide = 'right';

      runStressAndGridLayoutCore(layout);

      expect(constrained.startSide).toBe('left');
      expect(constrained.endSide).toBe('right');
      expect(layout.edges.some((edge) => edge.metadata?.stressAndGridLayered === true)).toBe(false);
    }
  );

  it('routes through the preserved departure and arrival ports', async () => {
    const layout = await measuredLayout();
    const constrained = layout.edges.find((edge) => edge.start === 'ni' && edge.end === 'ns')!;
    constrained.startSide = 'left';
    constrained.endSide = 'right';

    runStressAndGridLayoutCore(layout);

    const points = constrained.points!;
    expect(points[1].x).toBeLessThan(points[0].x);
    expect(points[1].y).toBeCloseTo(points[0].y, 6);
    expect(points.at(-2)!.x).toBeGreaterThan(points.at(-1)!.x);
    expect(points.at(-2)!.y).toBeCloseTo(points.at(-1)!.y, 6);
  });

  it.each(['start', 'end'] as const)(
    'bypasses the optional pass for an explicit %s port even when it matches its preference',
    async (terminal) => {
      const layout = await measuredLayout();
      const constrained = layout.edges[0];
      if (terminal === 'start') {
        constrained.startSide = 'bottom';
      } else {
        constrained.endSide = 'top';
      }

      runStressAndGridLayoutCore(layout);

      expect(layout.edges.some((edge) => edge.metadata?.stressAndGridLayered === true)).toBe(false);
      expect(constrained[terminal === 'start' ? 'startSide' : 'endSide']).toBe(
        terminal === 'start' ? 'bottom' : 'top'
      );
    }
  );

  it('retains the ordinary placement for non-default minimum rank separation', async () => {
    const layout = await measuredLayout();
    layout.edges[0].minlen = 3;

    runStressAndGridLayoutCore(layout);

    expect(layout.edges[0].minlen).toBe(3);
    expect(layout.edges.some((edge) => edge.metadata?.stressAndGridLayered === true)).toBe(false);
  });

  it('retains the ordinary placement for a local node direction', async () => {
    const layout = await measuredLayout();
    layout.nodes.find((node) => node.id === 'ni')!.dir = 'LR';

    runStressAndGridLayoutCore(layout);

    expect(layout.nodes.find((node) => node.id === 'ni')!.dir).toBe('LR');
    expect(layout.edges.some((edge) => edge.metadata?.stressAndGridLayered === true)).toBe(false);
  });
});
