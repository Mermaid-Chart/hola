import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData, Node } from '../../types.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

// Captured from the reported diagram before component/frame-row compaction.
const measurements = {
  classic: { b1: [77.3125, 54], c2: [76.3125, 54], note: [260, 78] },
  classicRedux: { b1: [75.578125, 51], c2: [74.796875, 51], note: [260, 72] },
  neo: { b1: [49.3125, 48], c2: [48.3125, 48], note: [232, 72] },
  neoRedux: { b1: [47.578125, 45], c2: [46.796875, 45], note: [232, 66] },
  handDrawn: {
    b1: [80.1590805053711, 56.731807708740234],
    c2: [78.39704895019531, 56.91651153564453],
    note: [263.021240234375, 81.14588928222656],
  },
  handDrawnRedux: {
    b1: [78.39704895019531, 54.42802047729492],
    c2: [77.24140167236328, 54.161903381347656],
    note: [262.8008117675781, 75.61251831054688],
  },
};

async function measuredLayout(variant: keyof typeof measurements): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(
      process.cwd(),
      'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH simple edges and orphan node.mmd'
    ),
    { stampFlowchartRendererFields: true }
  );
  const redux = variant.endsWith('Redux');
  for (const node of layout.nodes) {
    if (node.isGroup) {
      node.labelBBox = {
        width: node.id === 'two' ? (redux ? 21.796875 : 26.84375) : redux ? 31.921875 : 38.765625,
        height: redux ? 21 : 24,
      } as DOMRect;
    } else {
      expect(Object.keys(measurements[variant])).toContain(node.id);
      [node.width, node.height] = measurements[variant][node.id as 'b1' | 'c2' | 'note'];
    }
  }
  return layout;
}

function bounds(nodes: Node[]) {
  return {
    left: Math.min(...nodes.map((node) => node.x! - node.width! / 2)),
    right: Math.max(...nodes.map((node) => node.x! + node.width! / 2)),
    top: Math.min(...nodes.map((node) => node.y! - node.height! / 2)),
    bottom: Math.max(...nodes.map((node) => node.y! + node.height! / 2)),
  };
}

describe('gipsec DDLT — framed components with an orphan', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['LR', 'RL', 'TB', 'BT'].map((direction) => ({ variant, direction }))
  );
  it.each(cases)(
    'removes vacant frame rows and packs the orphan with $variant in $direction',
    async ({ variant, direction }) => {
      const layout = await measuredLayout(variant);
      layout.direction = direction;
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.issues).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(layout.edges.every((edge) => edge.points!.length <= 4)).toBe(true);

      const frames = layout.nodes.filter((node) => node.isGroup);
      const frameBounds = bounds(frames);
      // An empty band should be one routing corridor, not several grid cells.
      const vacantHeight =
        frameBounds.bottom - frameBounds.top - frames.reduce((sum, node) => sum + node.height!, 0);
      expect(vacantHeight).toBeLessThanOrEqual(96 + 1e-6);
      const note = layout.nodes.find((node) => node.id === 'note')!;
      expect(note.x! - note.width! / 2 - frameBounds.right).toBeCloseTo(120);
      expect(note.y! - note.height! / 2).toBeCloseTo(frameBounds.top);
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
      }
    }
  );

  it('does not let a wide orphan change the connected frame geometry', async () => {
    const layout = await measuredLayout('classic');
    const withoutOrphan = await measuredLayout('classic');
    withoutOrphan.nodes = withoutOrphan.nodes.filter((node) => node.id !== 'note');
    layout.nodes.find((node) => node.id === 'note')!.width = 1000;
    runStressAndGridLayoutCore(layout);
    runStressAndGridLayoutCore(withoutOrphan);
    const connected = layout.nodes.filter((node) => node.id !== 'note');
    const origin = bounds(connected);
    const otherOrigin = bounds(withoutOrphan.nodes);
    for (const node of connected) {
      const other = withoutOrphan.nodes.find((candidate) => candidate.id === node.id)!;
      expect(node.x! - origin.left).toBeCloseTo(other.x! - otherOrigin.left);
      expect(node.y! - origin.top).toBeCloseTo(other.y! - otherOrigin.top);
      expect(node.width).toBeCloseTo(other.width!);
      expect(node.height).toBeCloseTo(other.height!);
    }
  });
});
