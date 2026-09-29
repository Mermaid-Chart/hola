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

async function runEvent(): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(resolve(process.cwd(), FIXTURES_DIR, 'event.mmd'), {
    stampFlowchartRendererFields: true,
  });
  applyFixtureContentSizesStrict(
    layout,
    loadSizesFixture(resolve(process.cwd(), FIXTURES_DIR, 'event.sizes.json'))
  );
  runStressAndGridLayoutCore(layout);
  return layout;
}

describe('stress-and-grid DDLT — nested event subgraphs', () => {
  it('keeps nested frames padded and routes edges outside foreign frames', async () => {
    const layout = await runEvent();
    const hardIssues = validateLayout(layout).issues.filter(
      (issue) => issue.type !== 'group-dead-space'
    );

    expect(hardIssues).toEqual([]);
    expect(
      layout.edges.find((edge) => edge.id === 'L_presetKey_updateKnob_0')?.points
    ).toHaveLength(5);
    expect(
      layout.edges
        .filter((edge) =>
          ['L_PresetRack_mixerState_0', 'L_presetKey_updateKnob_0'].includes(edge.id)
        )
        .filter((edge) => labelStraddlesGroupBorder(edge, layout.nodes))
        .map(({ id, x, y, points }) => ({ id, x, y, points }))
    ).toEqual([]);
  });
});

function labelStraddlesGroupBorder(
  edge: LayoutData['edges'][number],
  nodes: LayoutData['nodes']
): boolean {
  const label = (edge.label ?? edge.text ?? '').trim();
  if (!label || edge.x === undefined || edge.y === undefined) {
    return false;
  }
  const width = Math.max(40, label.replace(/<[^>]+>/gu, '').length * 8);
  const height = 24;
  const left = edge.x - width / 2;
  const right = edge.x + width / 2;
  const top = edge.y - height / 2;
  const bottom = edge.y + height / 2;
  return nodes
    .filter((node) => node.isGroup)
    .some((group) => {
      const groupLeft = group.x! - group.width! / 2;
      const groupRight = group.x! + group.width! / 2;
      const groupTop = group.y! - group.height! / 2;
      const groupBottom = group.y! + group.height! / 2;
      return (
        (((left < groupLeft && right > groupLeft) || (left < groupRight && right > groupRight)) &&
          bottom > groupTop &&
          top < groupBottom) ||
        (((top < groupTop && bottom > groupTop) || (top < groupBottom && bottom > groupBottom)) &&
          right > groupLeft &&
          left < groupRight)
      );
    });
}
