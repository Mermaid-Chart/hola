import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

describe('stress-and-grid DDLT — symmetric terminal decision branches', () => {
  it.each(['LR', 'RL', 'TB', 'BT'])(
    'centres the decision between mirrored branches in %s',
    async (direction) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/SIMPLE knsv2-27-flowchart-dagre-lr-subgraphs.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      layout.direction = direction;
      // Classic/default dimensions captured before this symmetry fix. The
      // target widths differ: align their facing borders, not their centres.
      for (const node of layout.nodes) {
        if (node.isGroup) {
          node.labelBBox = { width: 41.78125, height: 24 } as DOMRect;
        } else if (node.id === 'A') {
          node.width = node.height = 63.4375;
        } else {
          node.width = node.id === 'B' ? 69.0625 : 69.578125;
          node.height = 54;
        }
      }

      runStressAndGridLayoutCore(layout);
      const decision = layout.nodes.find((node) => node.id === 'A')!;
      const targets = layout.nodes.filter((node) => node.id === 'B' || node.id === 'C');
      const horizontal = direction === 'LR' || direction === 'RL';
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const size = horizontal ? 'width' : 'height';
      const sign = direction === 'LR' || direction === 'TB' ? 1 : -1;
      expect((targets[0][across]! + targets[1][across]!) / 2).toBeCloseTo(decision[across]!, 6);
      const facingBorders = targets.map((node) => node[along]! - (sign * node[size]!) / 2);
      expect(facingBorders[0]).toBeCloseTo(facingBorders[1], 6);
      expect(sign * (facingBorders[0] - decision[along]!)).toBeGreaterThan(decision[size]! / 2);

      const [first, second] = layout.edges.map((edge) => edge.points!);
      expect(first.length).toBeLessThanOrEqual(4);
      expect(second).toHaveLength(first.length);
      first.forEach((point, index) => {
        expect(point[along]).toBeCloseTo(second[index][along], 6);
        expect((point[across] + second[index][across]) / 2).toBeCloseTo(decision[across]!, 6);
      });
      const validation = validateLayout(layout);
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
    }
  );
});
