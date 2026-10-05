import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

describe('stress-and-grid DDLT — four diamond-to-circle edges', () => {
  it.each(['LR', 'RL', 'TB', 'BT'])(
    'uses ordered straight outline-to-outline lanes in %s',
    async (direction) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/SIMPLE knsv2-22-flowchart-dagre-lr.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      layout.direction = direction;
      // Dimensions captured from this fixture's classic/default browser render.
      const diamond = layout.nodes.find((node) => node.id === 'A')!;
      const circle = layout.nodes.find((node) => node.id === 'B')!;
      diamond.width = diamond.height = 63.4375;
      circle.width = circle.height = 63.546875;
      runStressAndGridLayoutCore(layout);
      expect(layout.edges).toHaveLength(4);
      for (const edge of layout.edges) {
        expect(edge.points).toHaveLength(2);
        const end = edge.points!.at(-1)!;
        expect(
          ((end.x - circle.x!) / (circle.width / 2)) ** 2 +
            ((end.y - circle.y!) / (circle.height / 2)) ** 2
        ).toBeCloseTo(1);
      }
      const validation = validateLayout(layout);
      expect(validation.issues).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.score).toBe(1000);
    }
  );
});
