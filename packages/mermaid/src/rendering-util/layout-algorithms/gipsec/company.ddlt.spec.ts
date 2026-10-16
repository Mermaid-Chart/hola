import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

async function runCompany(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'Company.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'Company.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — Company', () => {
  it('reserves space for the reciprocal company-edge label', async () => {
    const layout = await runCompany();
    const result = validateLayout(layout);
    const labeledEdge = layout.edges.find((edge) => edge.id === 'L_USCompany_HongKongCompany_0')!;
    const returnEdge = layout.edges.find((edge) => edge.id === 'L_HongKongCompany_USCompany_0')!;
    const usCompany = layout.nodes.find((node) => node.id === 'USCompany')!;
    const hongKongCompany = layout.nodes.find((node) => node.id === 'HongKongCompany')!;

    expect(result.issues).toEqual([]);
    expect(result.breakdown.crossings).toBe(0);
    expect(labeledEdge.points).toHaveLength(4);
    expect(returnEdge.points).toHaveLength(2);
    expect(labeledEdge.x).toBeGreaterThan(hongKongCompany.x! + hongKongCompany.width! / 2);
    expect(labeledEdge.x).toBeLessThan(usCompany.x! - usCompany.width! / 2);
    expect(
      labeledEdge.y! <
        Math.min(
          hongKongCompany.y! - hongKongCompany.height! / 2,
          usCompany.y! - usCompany.height! / 2
        ) ||
        labeledEdge.y! >
          Math.max(
            hongKongCompany.y! + hongKongCompany.height! / 2,
            usCompany.y! + usCompany.height! / 2
          )
    ).toBe(true);
  });
});
