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
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/three-paths.sizes.json'
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

describe('stress-and-grid DDLT — verbose three paths', () => {
  it.each(Object.entries(measurements.variants))(
    'reserves straight terminal label corridors without moving the branch structure in %s',
    async (_variant, sizes) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/VERBOSE three paths.mmd'),
        { stampFlowchartRendererFields: true }
      );
      for (const node of layout.nodes) {
        const measurement = sizes.nodes[node.id];
        expect(measurement, `measurement for ${node.id}`).toBeDefined();
        node.width = measurement.width;
        node.height = measurement.height;
      }
      for (const edge of layout.edges) {
        if (edge.label) {
          expect(sizes.labels[edge.id], `measurement for ${edge.id}`).toBeDefined();
          Object.assign(edge, sizes.labels[edge.id]);
        }
      }
      runStressAndGridLayoutCore(layout);
      for (const id of ['L_D_L_0', 'L_F_K_0']) {
        const edge = layout.edges.find((edge) => edge.id === id)!;
        const source = layout.nodes.find((node) => node.id === edge.start)!;
        const target = layout.nodes.find((node) => node.id === edge.end)!;
        const sign = Math.sign(target.x! - source.x!);
        expect(edge.points).toEqual([
          { x: source.x! + (sign * source.width!) / 2, y: source.y },
          { x: target.x! - (sign * target.width!) / 2, y: target.y },
        ]);
        expect(target.y).toBe(source.y);
        expect(edge.x).toBeCloseTo((edge.points![0].x + edge.points![1].x) / 2, 6);
        expect(edge.y).toBe(source.y);
        expect(
          Math.abs(target.x! - source.x!) - (source.width! + target.width!) / 2
        ).toBeGreaterThanOrEqual(edge.width! + 24 - 1e-6);
      }
      for (const node of layout.nodes) {
        if (!['L', 'K'].includes(node.id)) {
          expect(node.x, node.id).toBeCloseTo(sizes.nodes[node.id].x, 6);
          expect(node.y, node.id).toBeCloseTo(sizes.nodes[node.id].y, 6);
        }
      }
      const validation = validateLayout(layout);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.score).toBe(1000);
    }
  );
});
