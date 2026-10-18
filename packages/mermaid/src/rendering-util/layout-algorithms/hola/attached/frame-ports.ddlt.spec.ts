import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { addDiagrams } from '../../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../../ddlt/fixtureSizes.js';
import { applyFixtureEdgeLabelSizes } from '../../ddlt/backends.js';
import { layoutTestsDir } from '../../ddlt/paths.js';
import { parseMmdFileToLayoutData } from '../../ddlt/parseToLayoutData.js';
import { validateLayout } from '../../layout-utils/validateLayout.js';
import { runGridAttachedSubgraphsLayoutCore } from '../index.js';
import fixtures from './frame-ports.sizes.json' with { type: 'json' };

beforeAll(() => addDiagrams());
describe('HOLA frame ports', () => {
  for (const fixture of fixtures) {
    it(fixture.name, async () => {
      const data = await parseMmdFileToLayoutData(
        join(layoutTestsDir(), `../test-dataset/${fixture.name}.mmd`),
        { stampFlowchartRendererFields: true }
      );
      for (const node of data.nodes) {
        Object.assign(
          node,
          fixture.nodes.find((measured) => measured.id === node.id)
        );
      }
      runGridAttachedSubgraphsLayoutCore(data);
      const result = validateLayout(data);
      expect(
        result.issues.filter((issue) =>
          ['edge-corner-connection', 'port-near-corner'].includes(issue.type)
        )
      ).toEqual([]);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
    });
  }
  it('refreshes labels after frame routing without requiring a measured title', async () => {
    const path = join(layoutTestsDir(), 'Loop Fixtures/nested-sg-outgoing-3');
    const data = await parseMmdFileToLayoutData(`${path}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    const sizes = loadSizesFixture(`${path}.sizes.json`);
    applyFixtureContentSizesStrict(data, sizes);
    applyFixtureEdgeLabelSizes(data, sizes);
    runGridAttachedSubgraphsLayoutCore(data);
    const result = validateLayout(data);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(
      result.issues.filter((issue) =>
        ['edge-label-off-edge', 'edge-label-overlaps-group-border'].includes(issue.type)
      )
    ).toEqual([]);
  });
});
