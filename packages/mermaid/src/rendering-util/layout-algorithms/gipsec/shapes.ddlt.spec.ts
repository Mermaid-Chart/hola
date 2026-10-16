import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — shape gallery', () => {
  it('reserves a clear route segment for each labelled shape connection', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'shapes.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'shapes.sizes.json'))
    );
    // This fixture predates captured edge-label sizes. The browser measures
    // every "default style" label as approximately 91 × 24px.
    for (const edge of layout.edges) {
      if ((edge.label ?? edge.text ?? '').trim()) {
        edge.width = 91;
        edge.height = 24;
      }
    }

    runStressAndGridLayoutCore(layout);

    const labelIssues = validateLayout(layout).issues.filter((issue) =>
      issue.type.startsWith('edge-label-overlaps')
    );

    expect(labelIssues).toEqual([]);
  });
});
