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
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/incremental-vertex.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    {
      nodes: Record<string, { x: number; y: number; width: number; height: number }>;
      labels: Record<string, { width: number; height: number }>;
    }
  >;
};

describe('stress-and-grid DDLT — aligned diamond continuation vertices', () => {
  it.each(Object.entries(measurements.variants))(
    'removes the overlap continuation dogleg without moving nodes in %s',
    async (_variant, sizes) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/VERBOSE incremental-editing.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      for (const node of layout.nodes) {
        const size = sizes.nodes[node.id];
        expect(size, `measurement for ${node.id}`).toBeDefined();
        node.width = size.width;
        node.height = size.height;
      }
      for (const edge of layout.edges) {
        if (edge.label) {
          expect(sizes.labels[edge.id], `measurement for ${edge.id}`).toBeDefined();
          Object.assign(edge, sizes.labels[edge.id]);
        }
      }
      runStressAndGridLayoutCore(layout);
      for (const node of layout.nodes) {
        expect(node.x, node.id).toBeCloseTo(sizes.nodes[node.id].x, 6);
        expect(node.y, node.id).toBeCloseTo(sizes.nodes[node.id].y, 6);
      }
      const diamond = layout.nodes.find((node) => node.id === 'overlap')!;
      const done = layout.nodes.find((node) => node.id === 'done')!;
      const continuation = layout.edges.find((edge) => edge.id === 'L_overlap_done_0')!;
      expect(continuation.points).toEqual([
        { x: diamond.x, y: diamond.y! + diamond.height! / 2 },
        { x: done.x, y: done.y! - done.height! / 2 },
      ]);
      const sibling = layout.edges.find((edge) => edge.id === 'L_overlap_relayout_0')!;
      expect(sibling.points![0]).toEqual({
        x: diamond.x! + diamond.width! / 2,
        y: diamond.y,
      });
      expect(sibling.points).toHaveLength(4);
      const validation = validateLayout(layout);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.score).toBeGreaterThan(985);
    }
  );
});
