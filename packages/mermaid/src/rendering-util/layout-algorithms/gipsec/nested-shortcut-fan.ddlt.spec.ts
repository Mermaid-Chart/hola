import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { nestedShortcutFan } from './nestedShortcutFan.js';

addDiagrams();

describe('stress-and-grid DDLT — nested parallel shortcuts', () => {
  it('leaves unsupported rounded arrival shapes on the general routing path', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(
        process.cwd(),
        'e2e/platform/dev-diagrams/test-dataset/SIMPLE knsv2-23-flowchart-dagre-lr-subgraphs.mmd'
      ),
      { stampFlowchartRendererFields: true }
    );
    const target = layout.nodes.find((node) => node.id === 'I')!;
    target.shape = 'circle';
    target.width = target.height = 80;
    expect(nestedShortcutFan(layout)).toBeUndefined();
  });
  it.each(['LR', 'RL'])(
    'keeps both direct edges separate from the indirect branch in %s',
    async (direction) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/SIMPLE knsv2-23-flowchart-dagre-lr-subgraphs.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      layout.direction = direction;
      // Classic/default browser measurements, before the routing fix.
      for (const node of layout.nodes) {
        if (node.isGroup) {
          node.labelBBox = {
            width: node.id === 's1' ? 26.015625 : 16.09375,
            height: 24,
          } as DOMRect;
        } else {
          const size =
            node.id === 'D'
              ? [156.390625, 156.390625]
              : node.id === 'I'
                ? [79.671875, 39]
                : [68.578125, 54];
          [node.width, node.height] = size;
        }
      }
      const labelled = layout.edges.find((edge) => edge.id === 'L_D_I_0')!;
      labelled.width = 78.625;
      labelled.height = 24;
      runStressAndGridLayoutCore(layout);
      const validation = validateLayout(layout);
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.breakdown.crossings).toBe(0);
      expect(Math.max(...layout.edges.map((edge) => edge.points!.length))).toBeLessThanOrEqual(4);
      expect(validation.score).toBeGreaterThan(900);
      const outer = layout.nodes.find((node) => node.id === 'S2')!;
      expect(outer.width! * outer.height!).toBeLessThan(542.546875 * 440.390625 * 0.75);
    }
  );
});
