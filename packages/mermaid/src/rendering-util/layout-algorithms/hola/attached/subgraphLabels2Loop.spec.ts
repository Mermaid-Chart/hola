import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';
import { applyFixtureEdgeLabelSizes } from '../../ddlt/backends.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../../ddlt/fixtureSizes.js';
import { layoutTestsDir } from '../../ddlt/paths.js';
import { parseMmdFileToLayoutData } from '../../ddlt/parseToLayoutData.js';
import { validateLayout } from '../../layout-utils/validateLayout.js';
import { runGridAttachedSubgraphsLayoutCore } from '../index.js';

const FIXTURE_DIR = join(layoutTestsDir(), 'Loop Fixtures');

describe('Loop Fixture: subgraph-labels-2', () => {
  beforeAll(() => {
    addDiagrams();
  });

  it('keeps both a1 → a2 labels inside the one frame and away from its border', async () => {
    const layout = await parseMmdFileToLayoutData(join(FIXTURE_DIR, 'subgraph-labels-2.mmd'), {
      stampFlowchartRendererFields: true,
    });
    const sizes = loadSizesFixture(join(FIXTURE_DIR, 'subgraph-labels-2.sizes.json'));
    applyFixtureContentSizesStrict(layout, sizes);
    applyFixtureEdgeLabelSizes(layout, sizes);
    runGridAttachedSubgraphsLayoutCore(layout);

    const frame = layout.nodes.find((node) => node.id === 'one')!;
    const frameBounds = {
      minX: frame.x! - frame.width! / 2,
      minY: frame.y! - frame.height! / 2,
      maxX: frame.x! + frame.width! / 2,
      maxY: frame.y! + frame.height! / 2,
    };
    const labels = layout.edges
      .filter((edge) => edge.id.startsWith('L_a1_a2_'))
      .map((edge) => ({
        id: edge.id,
        x: edge.x,
        y: edge.y,
        width: edge.width,
        height: edge.height,
        points: edge.points,
      }));
    const validation = validateLayout(layout);
    expect(validation.ok).toBe(true);
    expect(validation.issues.map((issue) => issue.type)).not.toContain(
      'edge-label-overlaps-foreign-edge'
    );
    expect(labels).toHaveLength(2);
    for (const label of labels) {
      expect(label.points).toHaveLength(2);
      expect(label.x).toBeCloseTo(label.points![0].x, 6);
      expect(label.x).toBeCloseTo(label.points![1].x, 6);
      expect(label.x! - label.width! / 2).toBeGreaterThanOrEqual(frameBounds.minX + 12 - 1e-6);
      expect(label.x! + label.width! / 2).toBeLessThanOrEqual(frameBounds.maxX - 12 + 1e-6);
      expect(label.y! - label.height! / 2).toBeGreaterThanOrEqual(frameBounds.minY + 12 - 1e-6);
      expect(label.y! + label.height! / 2).toBeLessThanOrEqual(frameBounds.maxY - 12 + 1e-6);

      // The label must be attributable to its own track: a parallel a1 → a2
      // edge needs the normal label clearance, not merely a non-zero gap.
      for (const foreign of labels.filter((other) => other.id !== label.id)) {
        expect(Math.abs(label.x! - foreign.points![0].x) - label.width! / 2).toBeGreaterThanOrEqual(
          12 - 1e-6
        );
      }
    }
  });
});
