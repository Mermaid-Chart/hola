import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureEdgeLabelSizes } from '../ddlt/backends.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — nested outgoing frames', () => {
  it('keeps members contained and reserves a label channel between sibling frames', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-sg-outgoing-3.mmd'),
      { stampFlowchartRendererFields: true }
    );
    const sizes = loadSizesFixture(
      resolve(process.cwd(), FIXTURES_DIR, 'nested-sg-outgoing-3.sizes.json')
    );
    applyFixtureContentSizesStrict(layout, sizes);
    applyFixtureEdgeLabelSizes(layout, sizes);
    // The fixture captures leaf and edge-label dimensions. The browser also
    // measures the two subgraph titles before core layout; include that title
    // height so this DDLT path uses the same final frame borders as paint.
    for (const node of layout.nodes) {
      if (node.isGroup === true) {
        node.labelBBox = { width: 0, height: 21 };
      }
    }
    runStressAndGridLayoutCore(layout);

    const structuralIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(structuralIssues).toEqual([]);

    const alpha = layout.nodes.find((node) => node.id === 'container_Alpha');
    const beta = layout.nodes.find((node) => node.id === 'container_Beta');
    const messages = layout.edges.find(
      (edge) => edge.start === 'process_A' && edge.end === 'process_C'
    );

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();
    expect(messages).toBeDefined();
    expect(alpha!.y).toBeCloseTo(beta!.y!, 6);
    expect(messages!.x! - messages!.width! / 2).toBeGreaterThan(alpha!.x! + alpha!.width! / 2);
    expect(messages!.x! + messages!.width! / 2).toBeLessThan(beta!.x! - beta!.width! / 2);
  });
});
