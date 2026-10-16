import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

// Browser measurements captured before changing placement or routing.
const measurements = {
  classic: { a1: [260, 78], a2: [260, 78], a3: [260, 78], a4: [260, 78] },
  neo: { a1: [232, 72], a2: [232, 72], a3: [232, 72], a4: [232, 72] },
  handDrawn: {
    a1: [263.2853698730469, 80.66597747802734],
    a2: [263.3309631347656, 81.65959930419922],
    a3: [262.9252624511719, 81.77113342285156],
    a4: [262.3710021972656, 81.5702133178711],
  },
};

describe('stress-and-grid DDLT — crowded edges and verbose nodes', () => {
  const cases = (['classic', 'neo', 'handDrawn'] as const).flatMap((look) =>
    ['LR', 'RL', 'TB', 'BT'].map((direction) => ({ look, direction }))
  );
  it.each(cases)(
    'keeps the label and fan clear with $look measurements in $direction',
    async ({ look, direction }) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH crowded edges and verbose nodes.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      layout.direction = direction;
      for (const node of layout.nodes) {
        if (node.isGroup) {
          node.labelBBox = { width: 26.0625, height: 24 } as DOMRect;
          continue;
        }
        const size = measurements[look][node.id as keyof (typeof measurements)['classic']];
        expect(size, `measurement for ${node.id}`).toBeDefined();
        [node.width, node.height] = size;
      }
      const labelled = layout.edges.find((edge) => edge.id === 'L_a1_a2_0')!;
      labelled.width = 132;
      labelled.height = 24;
      runStressAndGridLayoutCore(layout);

      const validation = validateLayout(layout);
      expect(validation.ok, JSON.stringify(validation.issues)).toBe(true);
      expect(
        validation.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(15);
      expect(layout.edges.every((edge) => edge.points!.length <= 4)).toBe(true);
    }
  );
});
