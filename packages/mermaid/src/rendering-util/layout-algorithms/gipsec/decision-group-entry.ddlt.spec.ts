import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

// Real browser measurements, captured before compacting the outside split.
const measurements = {
  classic: {
    A: [135.828125, 54],
    B: [171.078125, 54],
    C: [129.734375, 54],
    D: [147.1875, 147.1875],
    E: [180.59375, 54],
    F: [197.875, 54],
    G: [185.03125, 54],
    H: [210.171875, 54],
    I: [147.1875, 147.1875],
    J: [175.5, 54],
    K: [210.015625, 54],
    L: [78.69871520996094, 39],
  },
  neo: {
    A: [107.828125, 48],
    B: [143.078125, 48],
    C: [101.734375, 48],
    D: [147.1875, 147.1875],
    E: [152.59375, 48],
    F: [169.875, 48],
    G: [157.03125, 48],
    H: [182.171875, 48],
    I: [147.1875, 147.1875],
    J: [147.5, 48],
    K: [182.015625, 48],
    L: [105.944091796875, 48],
  },
  handDrawn: {
    A: [138.25010681152344, 57.18327331542969],
    B: [173.66598510742188, 56.9262580871582],
    C: [131.8795928955078, 56.967105865478516],
    D: [148.19964599609375, 147.9332275390625],
    E: [183.6345672607422, 57.55308532714844],
    F: [200.3015899658203, 57.28376388549805],
    G: [187.7120361328125, 56.779415130615234],
    H: [212.38082885742188, 57.6056022644043],
    I: [148.331298828125, 149.08424377441406],
    J: [178.205596923828125, 57.69123077392578],
    K: [213.1238250732422, 57.30533218383789],
    L: [79.14555358886719, 42.007503509521484],
  },
  // Seed 1 is the browser suite's standard. Its feedback branch sits beside
  // the decision rather than below it; compacting the frame must not move it.
  handDrawnSeed1: {
    A: [138.19920349121094, 57.301544189453125],
    B: [174.09828186035156, 56.91709518432617],
    C: [131.9656219482422, 57.30154800415039],
    D: [148.7676239013672, 148.48768615722656],
    E: [182.98976135253906, 56.85348129272461],
    F: [200.71238708496094, 57.55194854736328],
    G: [187.52491760253906, 57.486515045166016],
    H: [212.7819366455078, 57.51229476928711],
    I: [148.7676239013672, 148.48768615722656],
    J: [178.2246551513672, 57.301544189453125],
    K: [212.7819366455078, 57.55194854736328],
    L: [78.83325958251953, 41.42715072631836],
  },
};

async function measuredLayout(look: keyof typeof measurements): Promise<LayoutData> {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH decisions outside.mmd'),
    { stampFlowchartRendererFields: true }
  );
  for (const node of layout.nodes) {
    if (node.isGroup) {
      node.labelBBox = { width: 110.59375, height: 24 } as DOMRect;
    } else {
      const size = measurements[look][node.id as keyof (typeof measurements)['classic']];
      expect(size, `measurement for ${node.id}`).toBeDefined();
      [node.width, node.height] = size;
    }
  }
  for (const edge of layout.edges) {
    if ((edge.label ?? edge.text ?? '').trim()) {
      edge.width = edge.label === 'No' ? 18.796875 : 22.65625;
      edge.height = 24;
    }
  }
  return layout;
}

describe('gipsec DDLT — decision outside a subgraph', () => {
  it.each(['classic', 'neo', 'handDrawn'] as const)(
    'compacts the labelled entry split with %s measurements',
    async (look) => {
      const layout = await measuredLayout(look);
      runStressAndGridLayoutCore(layout);

      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      const decision = nodes.get('D')!;
      const entry = nodes.get('F')!;
      const feedback = nodes.get('E')!;
      const frame = nodes.get('subGraph0')!;
      const gap = entry.y! - entry.height! / 2 - (decision.y! + decision.height! / 2);
      expect(gap).toBeGreaterThanOrEqual(96 - 1e-6);
      expect(gap).toBeLessThanOrEqual(133);
      expect(feedback.y).toBeCloseTo(entry.y!, 6);
      expect((feedback.x! + entry.x!) / 2).toBeCloseTo(decision.x!, 6);
      expect(
        frame.y! - frame.height! / 2 - (decision.y! + decision.height! / 2)
      ).toBeGreaterThanOrEqual(36 - 1e-6);
      expect(nodes.get('K')!.y).toBeCloseTo(nodes.get('L')!.y!, 6);
      for (const edgeId of ['L_D_E_0', 'L_D_F_0']) {
        const edge = layout.edges.find((candidate) => candidate.id === edgeId)!;
        expect(edge.points).toHaveLength(3);
        expect(edge.y).toBeCloseTo((edge.points![1].y + edge.points![2].y) / 2, 6);
      }
      const result = validateLayout(layout);
      expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(15);
    }
  );

  it('compacts a framed entry without pulling down an upper feedback branch', async () => {
    const layout = await measuredLayout('handDrawnSeed1');
    runStressAndGridLayoutCore(layout);
    const decision = layout.nodes.find((node) => node.id === 'D')!;
    const entry = layout.nodes.find((node) => node.id === 'F')!;
    const feedback = layout.nodes.find((node) => node.id === 'E')!;
    expect(entry.y! - entry.height! / 2 - (decision.y! + decision.height! / 2)).toBeLessThanOrEqual(
      133
    );
    expect(feedback.y).toBeCloseTo(decision.y!, 6);
    const result = validateLayout(layout);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(40);
    expect(
      result.issues.filter(
        (issue) =>
          issue.type !== 'group-dead-space' &&
          !(issue.type === 'grid-misalignment' && issue.nodeIds?.join(',') === 'B,C')
      )
    ).toEqual([]);
  });

  it.each(['ports', 'minimum length'] as const)(
    'retains explicitly constrained %s',
    async (constraint) => {
      const layout = await measuredLayout('classic');
      const edge = layout.edges.find((candidate) => candidate.id === 'L_D_F_0')!;
      if (constraint === 'ports') {
        edge.startSide = 'bottom';
      } else {
        edge.minlen = 2;
      }
      runStressAndGridLayoutCore(layout);
      const decision = layout.nodes.find((node) => node.id === 'D')!;
      const entry = layout.nodes.find((node) => node.id === 'F')!;
      expect(entry.y! - entry.height! / 2 - (decision.y! + decision.height! / 2)).toBeGreaterThan(
        200
      );
    }
  );
});
