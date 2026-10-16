import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — outgoing empty subgraph', () => {
  it('draws a detached empty group as a compact frame beside its populated sibling', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-sg-outgoing-4.mmd'),
      { stampFlowchartRendererFields: true }
    );
    const sizes = loadSizesFixture(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-sg-outgoing-4.sizes.json')
    );
    applyFixtureContentSizesStrict(layout, sizes);
    for (const node of layout.nodes) {
      if (node.isGroup === true) {
        node.labelBBox = { width: 0, height: 21 };
      }
    }

    runStressAndGridLayoutCore(layout);

    const a = layout.nodes.find((node) => node.id === 'A');
    const b = layout.nodes.find((node) => node.id === 'B');

    expect(a).toBeDefined();
    expect(b).toBeDefined();
    expect(b!.width).toBeGreaterThan(0);
    expect(b!.height).toBeGreaterThan(0);
    expect(b!.x).toBeGreaterThan(a!.x! + a!.width! / 2);
    expect(Number.isFinite(b!.y)).toBe(true);
  });
});
