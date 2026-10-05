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

describe('stress-and-grid DDLT — seven-node double loop', () => {
  it('keeps the second diamond compact', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'GRAPH - hola 7 nodes double loop + trees - easy.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(
        resolve(
          process.cwd(),
          FIXTURES_DIR,
          'GRAPH - hola 7 nodes double loop + trees - easy.sizes.json'
        )
      )
    );
    runStressAndGridLayoutCore(layout);

    const edgeLength = (id: string): number => {
      const [start, end] = layout.edges.find((edge) => edge.id === id)!.points!;
      return Math.hypot(end.x - start.x, end.y - start.y);
    };

    expect(validateLayout(layout).issues).toEqual([]);
    expect(edgeLength('L_D_E_0')).toBeLessThanOrEqual(edgeLength('L_C_D_0') + 16);
    expect(edgeLength('L_F_G_0')).toBeLessThanOrEqual(edgeLength('L_C_D_0') + 16);
  });
});
