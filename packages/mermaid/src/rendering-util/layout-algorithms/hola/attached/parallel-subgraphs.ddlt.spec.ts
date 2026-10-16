import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../../ddlt/fixtureSizes.js';
import { applyFixtureEdgeLabelSizes } from '../../ddlt/backends.js';
import { layoutTestsDir } from '../../ddlt/paths.js';
import { parseMmdFileToLayoutData } from '../../ddlt/parseToLayoutData.js';
import { validateLayout } from '../../layout-utils/validateLayout.js';
import { runGridAttachedSubgraphsLayoutCore } from '../index.js';
import sizes from './hairy-subgraphs.sizes.json' with { type: 'json' };

describe('grouped HOLA parallel routing', () => {
  beforeAll(() => addDiagrams());

  it('routes parallel grouped edges without crossings and keeps full terminal runways', async () => {
    const data = await parseMmdFileToLayoutData(
      join(layoutTestsDir(), '../test-dataset/MESSY hairy subgraphs.mmd'),
      { stampFlowchartRendererFields: true }
    );
    for (const node of data.nodes) {
      Object.assign(
        node,
        sizes.nodes.find((measured) => measured.id === node.id)
      );
    }
    runGridAttachedSubgraphsLayoutCore(data);
    const result = validateLayout(data);
    expect(result.score).toBeGreaterThan(950);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual([]);
  });
  it('retains routing freedom for a coupled core without parallel bundles', async () => {
    const path = join(layoutTestsDir(), 'Loop Fixtures/GRAPH - Bipartite Graph k3,3');
    const data = await parseMmdFileToLayoutData(`${path}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    const measured = loadSizesFixture(`${path}.sizes.json`);
    applyFixtureContentSizesStrict(data, measured);
    applyFixtureEdgeLabelSizes(data, measured);
    runGridAttachedSubgraphsLayoutCore(data);
    const result = validateLayout(data);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.score).toBeGreaterThan(900);
  });
});
