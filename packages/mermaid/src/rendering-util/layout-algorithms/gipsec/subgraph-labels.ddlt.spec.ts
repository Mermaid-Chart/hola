import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — labelled two-node subgraph', () => {
  it('gives parallel labels distinct lanes within the group frame', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'subgraph-labels.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'subgraph-labels.sizes.json'))
    );

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    const hardIssues = validation.issues.filter((issue) => issue.type !== 'group-dead-space');
    const bundle = layout.edges.filter((edge) => edge.start === 'a1' && edge.end === 'a2');
    const [source, target] = ['a1', 'a2'].map((id) => layout.nodes.find((node) => node.id === id)!);

    expect(hardIssues).toEqual([]);
    expect(bundle).toHaveLength(2);
    expect(bundle.every((edge) => edge.points!.length === 2)).toBe(true);
    expect(source.y).toBeCloseTo(target.y!, 6);
    expect(new Set(bundle.map((edge) => edge.y!.toFixed(3))).size).toBe(bundle.length);
  });
});
