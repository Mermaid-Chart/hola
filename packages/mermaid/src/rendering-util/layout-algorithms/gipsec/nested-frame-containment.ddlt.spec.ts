import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

// Browser measurements captured before repairing nested frame containment.
const measurements = {
  classic: { a: [68.40625, 54], diamond: [62.90625, 62.90625], rect: [70.8125, 54] },
  classicRedux: { a: [67.796875, 51], diamond: [60.34375, 60.34375], rect: [70.890625, 51] },
  neo: { a: [40.40625, 48], diamond: [62.90625, 62.90625], rect: [42.8125, 48] },
  neoRedux: { a: [39.796875, 45], diamond: [60.34375, 60.34375], rect: [42.890625, 45] },
  handDrawn: {
    a: [70.92707061767578, 56.9543342590332],
    diamond: [64.48637390136719, 64.20642852783203],
    rect: [73.5015869140625, 56.78805160522461],
  },
  handDrawnRedux: {
    a: [70.05760955810547, 53.71297073364258],
    diamond: [61.92386245727539, 61.6439208984375],
    rect: [73.55130767822266, 53.93549728393555],
  },
};

describe('stress-and-grid DDLT — nested frame containment after bridge spacing', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['LR', 'RL', 'TB', 'BT'].map((direction) => ({ variant, direction }))
  );
  it.each(cases)(
    'keeps BAPA inside its APA parent with $variant in $direction',
    async ({ variant, direction }) => {
      const layout = await parseMmdFileToLayoutData(
        resolve(
          process.cwd(),
          'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH knsv2-24-flowchart-dagre-lr-subgraphs.mmd'
        ),
        { stampFlowchartRendererFields: true }
      );
      layout.direction = direction;
      const redux = variant.endsWith('Redux');
      for (const node of layout.nodes) {
        if (node.isGroup) {
          node.labelBBox = {
            width: node.id === 's3' ? (redux ? 36.3125 : 35.078125) : redux ? 26.984375 : 26.015625,
            height: redux ? 21 : 24,
          } as DOMRect;
        } else {
          const kind = node.id === 'a' ? 'a' : ['D', 'I'].includes(node.id) ? 'diamond' : 'rect';
          expect(['a', 'D', 'I', 'E', 'F']).toContain(node.id);
          [node.width, node.height] = measurements[variant][kind];
        }
      }
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      expect(parents.get('s3')).toBe('s8');
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(
        result.issues.filter((issue) =>
          ['group-inside-group-padding', 'node-too-close-to-group'].includes(issue.type)
        )
      ).toEqual([]);
      // All directions exercise containment. Full routing quality is checked
      // for the original LR diagram, matching the browser regression matrix.
      if (direction === 'LR') {
        expect(
          result.issues.filter(
            (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
          )
        ).toEqual([]);
        expect(result.ok).toBe(true);
        expect(result.breakdown.crossings).toBe(0);
        expect(layout.edges.every((edge) => edge.points!.length <= 6)).toBe(true);
      }

      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
        if (!node.parentId) {
          continue;
        }
        const parent = nodes.get(node.parentId)!;
        const inset = Math.min(
          node.x! - node.width! / 2 - (parent.x! - parent.width! / 2),
          parent.x! + parent.width! / 2 - (node.x! + node.width! / 2),
          node.y! - node.height! / 2 - (parent.y! - parent.height! / 2),
          parent.y! + parent.height! / 2 - (node.y! + node.height! / 2)
        );
        expect(inset, `${node.id} inside ${parent.id}`).toBeGreaterThanOrEqual(8 - 1e-6);
      }
    }
  );
});
