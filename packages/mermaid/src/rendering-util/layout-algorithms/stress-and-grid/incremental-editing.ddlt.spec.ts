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

describe('stress-and-grid DDLT — incremental editing flow', () => {
  it('keeps the incremental and fallback branches ordered', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'incremental-editing.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'incremental-editing.sizes.json'))
    );
    runStressAndGridLayoutCore(layout);

    const node = (id: string) => layout.nodes.find((candidate) => candidate.id === id)!;
    const edge = (id: string) => layout.edges.find((candidate) => candidate.id === id)!;
    const validation = validateLayout(layout);
    const hardIssues = validation.issues.filter((issue) => issue.type !== 'group-dead-space');
    const localPath = ['local', 'patch', 'resize', 'overlap'].map(node);
    const relayoutPath = ['relayout', 'sizes', 'worker', 'move', 'compare'].map(node);
    const fallbackPath = ['full', 'fallback', 'replace'].map(node);

    expect(hardIssues).toEqual([]);
    expect(localPath.every((candidate) => Math.abs(candidate.x! - localPath[0].x!) < 1e-6)).toBe(
      true
    );
    expect(
      relayoutPath.every((candidate) => Math.abs(candidate.x! - relayoutPath[0].x!) < 1e-6)
    ).toBe(true);
    expect(
      fallbackPath.every((candidate) => Math.abs(candidate.x! - fallbackPath[0].x!) < 1e-6)
    ).toBe(true);
    expect(
      localPath.every((candidate, index) => index === 0 || candidate.y! > localPath[index - 1].y!)
    ).toBe(true);
    expect(
      relayoutPath.every(
        (candidate, index) => index === 0 || candidate.y! > relayoutPath[index - 1].y!
      )
    ).toBe(true);
    expect(
      fallbackPath.every(
        (candidate, index) => index === 0 || candidate.y! > fallbackPath[index - 1].y!
      )
    ).toBe(true);
    expect(node('done').y).toBe(node('full').y);
    expect(node('compare').x! * 2).toBeCloseTo(node('done').x! + node('full').x!, 6);
    expect(
      node('relayout').y! -
        node('overlap').y! -
        (node('relayout').height! + node('overlap').height!) / 2
    ).toBeCloseTo(68, 6);
    expect(
      node('full').y! - node('compare').y! - (node('full').height! + node('compare').height!) / 2
    ).toBeCloseTo(68, 6);
    expect(node('noop').y).toBe(node('classify').y);
    expect(edge('L_classify_noop_0').points).toHaveLength(2);
    expect(edge('L_classify_full_0').points).toHaveLength(3);
    expect(edge('L_overlap_relayout_0').points![0]).toEqual({
      x: node('overlap').x! + node('overlap').width! / 2,
      y: node('overlap').y,
    });
    const overlapDone = edge('L_overlap_done_0').points!;
    const compareDone = edge('L_compare_done_0').points!;
    const classifyRelayout = edge('L_classify_relayout_0').points!;
    expect(
      Math.abs(overlapDone[0].x - node('overlap').x!) / (node('overlap').width! / 2) +
        Math.abs(overlapDone[0].y - node('overlap').y!) / (node('overlap').height! / 2)
    ).toBeCloseTo(1, 6);
    expect(overlapDone[0].y).toBeGreaterThan(node('overlap').y!);
    expect(overlapDone.at(-1)!.x).toBeCloseTo(node('done').x!, 6);
    expect(Math.abs(overlapDone.at(-1)!.x - compareDone.at(-1)!.x)).toBeGreaterThanOrEqual(20);
    expect(classifyRelayout[0].x).toBeCloseTo(node('classify').x! + node('classify').width! / 2, 6);
    expect(validation.breakdown.crossings).toBe(0);
  });
});
