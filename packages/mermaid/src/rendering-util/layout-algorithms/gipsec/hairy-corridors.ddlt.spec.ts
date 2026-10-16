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
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/hairy-corridors.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    Record<
      string,
      { width?: number; height?: number; labelBBox?: { width: number; height: number } }
    >
  >;
};

async function measuredLayout(variant = 'classic-default') {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/MESSY hairy subgraphs.mmd'),
    { stampFlowchartRendererFields: true }
  );
  for (const node of layout.nodes) {
    const size = measurements.variants[variant][node.id];
    expect(size, `captured measurement for ${node.id}`).toBeDefined();
    Object.assign(node, size);
  }
  return layout;
}

describe('stress-and-grid DDLT — shared fan and parallel corridors', () => {
  it('routes a compound fan and parallel bundle without braiding their corridors', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(55);
  });

  it('reroutes renamed and reordered topology on the same measured geometry', async () => {
    const layout = await measuredLayout();
    runStressAndGridLayoutCore(layout);
    const renamed = new Map(layout.nodes.map((node, index) => [node.id, `changed-${index}`]));
    for (const node of layout.nodes) {
      node.id = renamed.get(node.id)!;
      node.label = `Another name ${node.id}`;
      if (node.parentId) {
        node.parentId = renamed.get(node.parentId)!;
      }
    }
    layout.edges.reverse().forEach((edge, index) => {
      edge.id = `different-edge-${index}`;
      edge.start = renamed.get(edge.start!)!;
      edge.end = renamed.get(edge.end!)!;
    });
    routeStressAndGridEdges(layout, 120);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThan(55);
  });
});
