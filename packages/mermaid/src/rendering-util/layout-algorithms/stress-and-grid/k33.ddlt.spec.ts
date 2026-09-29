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

async function runK33(): Promise<LayoutData> {
  const mmdPath = resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - Bipartite Graph k3,3.mmd');
  const sizes = loadSizesFixture(
    resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - Bipartite Graph k3,3.sizes.json')
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — K₃,₃', () => {
  it('assigns distinct ports and avoids long shared edge segments', async () => {
    const result = validateLayout(await runK33());
    const portAndOverlapIssues = result.issues.filter((issue) =>
      [
        'edge-same-port-departure',
        'edge-shared-attachment-point',
        'edge-shared-projected-port',
        'edge-shared-subpath',
      ].includes(issue.type)
    );

    expect(portAndOverlapIssues).toEqual([]);
  });

  it('keeps the non-planar graph to three crossings or fewer', async () => {
    const result = validateLayout(await runK33());

    expect(result.breakdown.crossings).toBeLessThanOrEqual(3);
    expect(result.breakdown.maxCrossingsOnAnyEdge).toBeLessThanOrEqual(2);
  });
});
