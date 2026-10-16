import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../../ddlt/fixtureSizes.js';
import { applyFixtureEdgeLabelSizes } from '../../ddlt/backends.js';
import { layoutTestsDir } from '../../ddlt/paths.js';
import { parseMmdFileToLayoutData } from '../../ddlt/parseToLayoutData.js';
import { validateLayout } from '../../layout-utils/validateLayout.js';
import { runGridAttachedSubgraphsLayoutCore } from '../index.js';
import sizes from './windrose.sizes.json' with { type: 'json' };

describe('grouped HOLA grid alignment', () => {
  beforeAll(() => addDiagrams());

  it('settles the captured windrose rows and receiving column through the browser layout entry point', async () => {
    const data = await parseMmdFileToLayoutData(
      join(layoutTestsDir(), '../test-dataset/MESSY windrose fixed.mmd'),
      { stampFlowchartRendererFields: true }
    );
    for (const node of data.nodes) {
      Object.assign(
        node,
        sizes.nodes.find((measured) => measured.id === node.id)
      );
    }
    runGridAttachedSubgraphsLayoutCore(data);
    const node = (id: string) => data.nodes.find((member) => member.id === id)!;
    for (const id of ['NW', 'NE', 'SE']) {
      expect(node(id).y).toBeCloseTo(node('SW').y!, 6);
    }
    expect(node('SW').x).toBeCloseTo(node('C').x!, 6);
    expect(node('North').y).toBeCloseTo(node('South').y!, 6);
    const result = validateLayout(data);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.issues.filter((issue) => issue.type === 'grid-misalignment')).toEqual([]);
    expect(result.score).toBeGreaterThan(950);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual([]);
  });
  it('preserves clearance for connectors entering and leaving nested frames', async () => {
    const path = join(layoutTestsDir(), 'Loop Fixtures/nested-sb-edges-in-out');
    const data = await parseMmdFileToLayoutData(`${path}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    const fixture = loadSizesFixture(`${path}.sizes.json`);
    applyFixtureContentSizesStrict(data, fixture);
    applyFixtureEdgeLabelSizes(data, fixture);
    runGridAttachedSubgraphsLayoutCore(data);
    expect(data.nodes.filter((node) => node.isGroup)).toHaveLength(3);
    const result = validateLayout(data);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  });
});
