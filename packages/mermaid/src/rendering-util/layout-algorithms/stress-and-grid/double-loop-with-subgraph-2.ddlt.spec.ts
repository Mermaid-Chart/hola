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

async function runDoubleLoop(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), FIXTURES_DIR, 'double-loop-with-subgraph-2.mmd'),
    { stampFlowchartRendererFields: true }
  );
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'double-loop-with-subgraph-2.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — double loop with subgraphs', () => {
  it('keeps both loop frames around their members and routes the inter-loop edge cleanly', async () => {
    const layout = await runDoubleLoop();
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(hardIssues).toEqual([]);

    const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
    for (const [frameId, memberIds] of [
      ['top', ['T1', 'T2', 'T3', 'T4', 'T5']],
      ['down', ['B1', 'B2', 'B3', 'B4', 'B5']],
    ]) {
      const frame = nodes.get(frameId)!;
      const left = frame.x! - frame.width! / 2;
      const right = frame.x! + frame.width! / 2;
      const top = frame.y! - frame.height! / 2;
      const bottom = frame.y! + frame.height! / 2;
      for (const memberId of memberIds) {
        const member = nodes.get(memberId)!;
        expect(member.x! - member.width! / 2).toBeGreaterThanOrEqual(left);
        expect(member.x! + member.width! / 2).toBeLessThanOrEqual(right);
        expect(member.y! - member.height! / 2).toBeGreaterThanOrEqual(top);
        expect(member.y! + member.height! / 2).toBeLessThanOrEqual(bottom);
      }
    }

    const topFrame = nodes.get('top')!;
    const downFrame = nodes.get('down')!;
    const topFrameBottom = topFrame.y! + topFrame.height! / 2;
    const downFrameTop = downFrame.y! - downFrame.height! / 2;
    expect(downFrameTop - topFrameBottom).toBeGreaterThanOrEqual(96);

    // Five-node framed cycles have a compact two-row arrangement. Their
    // perimeter edges should therefore be direct, rather than being forced
    // around a sparse grid lane by the global stress solve.
    for (const edgeId of ['L_T4_T5_0', 'L_B1_B3_0', 'L_B5_B3_0']) {
      expect(layout.edges.find((edge) => edge.id === edgeId)?.points).toHaveLength(2);
    }
  });
});
