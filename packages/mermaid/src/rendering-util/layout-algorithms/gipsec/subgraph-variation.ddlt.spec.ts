import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { applyFixtureContentSizesStrict, loadSizesFixture } from '../ddlt/fixtureSizes.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

const FIXTURES_DIR = 'e2e/platform/dev-diagrams/layout-tests/Loop Fixtures';

addDiagrams();

describe('gipsec DDLT — subgraph variation', () => {
  it('keeps outgoing member and frame links in distinct clear corridors', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), FIXTURES_DIR, 'subgraph-variation.mmd'),
      { stampFlowchartRendererFields: true }
    );
    applyFixtureContentSizesStrict(
      layout,
      loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'subgraph-variation.sizes.json'))
    );

    runStressAndGridLayoutCore(layout);

    const validation = validateLayout(layout);
    const hardIssues = validation.issues.filter((issue) => issue.type !== 'group-dead-space');
    const leftMemberExit = layout.edges.find((edge) => edge.id === 'L_P2_P4_0')!;
    const rightMemberExit = layout.edges.find((edge) => edge.id === 'L_P3_P6_0')!;
    const groupExit = layout.edges.find((edge) => edge.id === 'L_P1.5_P5_0')!;
    const groupEntry = layout.edges.find((edge) => edge.id === 'L_P1_P1.5_0')!;
    const group = layout.nodes.find((node) => node.id === 'P1.5')!;
    const entry = layout.nodes.find((node) => node.id === 'P1')!;
    const leftMember = layout.nodes.find((node) => node.id === 'P2')!;
    const middleMember = layout.nodes.find((node) => node.id === 'P2.5')!;
    const rightMember = layout.nodes.find((node) => node.id === 'P3')!;
    const leftTarget = layout.nodes.find((node) => node.id === 'P4')!;
    const target = layout.nodes.find((node) => node.id === 'P5')!;

    expect(hardIssues).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
    expect(leftMemberExit.points).toHaveLength(2);
    expect(rightMemberExit.points).toHaveLength(2);
    expect(groupEntry.points).toHaveLength(2);
    expect(groupExit.points).toHaveLength(2);
    expect(leftMember.y!).toBeCloseTo(rightMember.y!);
    expect(
      middleMember.x! - middleMember.width! / 2 - (leftMember.x! + leftMember.width! / 2)
    ).toBeGreaterThanOrEqual(30);
    expect(
      rightMember.x! - rightMember.width! / 2 - (middleMember.x! + middleMember.width! / 2)
    ).toBeGreaterThanOrEqual(30);
    expect(leftTarget.x!).toBeLessThan(group.x! - group.width! / 2);
    expect(target.x! - group.x!).toBeGreaterThanOrEqual((target.width! + group.width!) / 2 + 36);
    expect(entry.y).toBeCloseTo(middleMember.y!);
    expect(target.y).toBeCloseTo(middleMember.y!);

    const end = groupExit.points!.at(-1)!;
    const beforeEnd = groupExit.points!.at(-2)!;
    const bandDistance = Math.abs(end.x - beforeEnd.x) + Math.abs(end.y - beforeEnd.y);
    expect(bandDistance).toBeGreaterThanOrEqual(18);
  });
});
