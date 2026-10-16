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

async function runK4(): Promise<LayoutData> {
  const mmdPath = resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - complete_graph_k4.mmd');
  const sizes = loadSizesFixture(
    resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - complete_graph_k4.sizes.json')
  );
  const layout = await parseMmdFileToLayoutData(mmdPath, { stampFlowchartRendererFields: true });

  applyFixtureContentSizesStrict(layout, sizes);
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — complete K₄', () => {
  it('gives every directed edge a distinct, separated lane', async () => {
    const layout = await runK4();
    const result = validateLayout(layout);
    const laneIssues = result.issues.filter((issue) =>
      [
        'edge-same-port-departure',
        'edge-shared-attachment-point',
        'edge-shared-projected-port',
        'edge-shared-subpath',
        'edge-parallel-segment-too-close',
      ].includes(issue.type)
    );

    expect(laneIssues).toEqual([]);
  });
});
