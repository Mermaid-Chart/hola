import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeNestedLinearWorkflow } from './nestedLinearWorkflow.js';

addDiagrams();

// Browser sizes captured before changing the nested workflow placement.
const ids = [
  'Knob',
  'ConsoleItem',
  'presetKey',
  'mixerState',
  'updateKnob',
  'handlePointerTap',
  'showConsole',
  'hideConsole',
  'consoleManager',
  'renderPreset',
];
const measurements = {
  classic: [
    94.953125, 148.21875, 130.734375, 138.328125, 145, 184.21875, 151.125, 146.359375, 173.640625,
    152.21875,
  ].map((width) => [width, 54]),
  classicRedux: [
    92.703125, 138.59375, 123.046875, 126.921875, 135.53125, 168.984375, 144.0625, 137.84375,
    163.515625, 140.9375,
  ].map((width) => [width, 51]),
  neo: [
    66.953125, 120.21875, 102.734375, 110.328125, 117, 156.21875, 123.125, 118.359375, 145.640625,
    124.21875,
  ].map((width) => [width, 48]),
  neoRedux: [
    64.703125, 110.59375, 95.046875, 98.921875, 107.53125, 140.984375, 116.0625, 109.84375,
    135.515625, 112.9375,
  ].map((width) => [width, 45]),
  handDrawn: [
    [97.93310546875, 56.829959869384766],
    [150.67015075683594, 57.301544189453125],
    [133.01702880859375, 57.486515045166016],
    [140.8234405517578, 57.18074417114258],
    [147.38987731933594, 57.301544189453125],
    [187.52491760253906, 57.18074417114258],
    [153.950439453125, 57.30154800415039],
    [148.7682647705078, 56.998966217041016],
    [176.32273864746094, 57.512290954589844],
    [154.26991271972656, 57.51229476928711],
  ],
  handDrawnRedux: [
    [94.94438934326172, 54.161903381347656],
    [140.8234405517578, 54.28270721435547],
    [125.31855010986328, 54.282711029052734],
    [129.01568603515625, 54.467674255371094],
    [138.19923400878906, 54.28270721435547],
    [171.66403198242188, 54.28270721435547],
    [146.7279815673828, 54.161903381347656],
    [140.6334686279297, 53.71297073364258],
    [165.81553649902344, 54.467674255371094],
    [143.2576904296875, 53.77840042114258],
  ],
};
const titles: Record<string, [number, number]> = {
  mixerHandler: [97, 83.25],
  Store: [37.578125, 33.46875],
  Deck: [34.53125, 31.90625],
  busRoutingCueState: [142.359375, 129.203125],
  Console: [55.40625, 51.375],
  PresetRack: [78.375, 72.359375],
};
const labels: Record<string, [number, number]> = {
  OnClick: [54.375, 49.015625],
  'Opens instance': [108.390625, 97.296875],
  Update: [51.6875, 45.15625],
  onSelection: [83.359375, 73.171875],
};

async function measuredLayout(variant: keyof typeof measurements) {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH linear complexity.mmd'),
    { stampFlowchartRendererFields: true }
  );
  const redux = variant.endsWith('Redux');
  for (const node of layout.nodes) {
    if (node.isGroup) {
      expect(titles[node.id], `title for ${node.id}`).toBeDefined();
      node.labelBBox = {
        width: titles[node.id][redux ? 1 : 0],
        height: redux ? 21 : 24,
      } as DOMRect;
    } else {
      const index = ids.indexOf(node.id);
      expect(index, `measurement for ${node.id}`).toBeGreaterThanOrEqual(0);
      [node.width, node.height] = measurements[variant][index];
    }
  }
  for (const edge of layout.edges) {
    if (!edge.label) {
      continue;
    }
    expect(labels[edge.label], `measurement for ${edge.label}`).toBeDefined();
    edge.width = labels[edge.label][redux ? 1 : 0];
    edge.height = redux ? 21 : 24;
  }
  return layout;
}

describe('stress-and-grid DDLT — nested linear workflow', () => {
  const cases = (Object.keys(measurements) as (keyof typeof measurements)[]).flatMap((variant) =>
    ['TB', 'BT', 'LR', 'RL'].map((direction) => ({ variant, direction }))
  );
  it.each(cases)(
    'separates compact nested frames and labelled bridges with $variant measurements in $direction',
    async ({ variant, direction }) => {
      const layout = await measuredLayout(variant);
      layout.direction = direction;
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(
        result.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(result.ok).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(result.breakdown.totalBendPenalty).toBeLessThanOrEqual(40);
      expect(layout.edges.every((edge) => edge.points!.length <= 4)).toBe(true);
      const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
      expect(nodes.get('Deck')!.width).toBeLessThan(400);
      expect(nodes.get('Store')!.height).toBeLessThan(400);
      expect(nodes.get('mixerHandler')!.height).toBeLessThan(350);
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
      }
    }
  );

  it('recognizes topology rather than diagram-specific node names', async () => {
    const layout = await measuredLayout('classic');
    const renamed = new Map(layout.nodes.map((node, index) => [node.id, `workflow-${index}`]));
    for (const node of layout.nodes) {
      node.id = renamed.get(node.id)!;
      if (node.parentId) {
        node.parentId = renamed.get(node.parentId);
      }
    }
    for (const edge of layout.edges) {
      edge.start = renamed.get(edge.start!);
      edge.end = renamed.get(edge.end!);
    }
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
  });

  it.each(['ports', 'minlen', 'direction', 'extra-link', 'fork-label'])(
    'leaves a non-private or explicitly constrained workflow unchanged (%s)',
    async (constraint) => {
      const layout = await measuredLayout('classic');
      if (constraint === 'ports') {
        layout.edges[0].startSide = 'top';
      }
      if (constraint === 'minlen') {
        layout.edges[0].minlen = 2;
      }
      if (constraint === 'direction') {
        layout.nodes.find((node) => node.id === 'Deck')!.dir = 'LR';
      }
      if (constraint === 'extra-link') {
        layout.edges.push({
          ...layout.edges[0],
          id: 'extra',
          start: 'renderPreset',
          end: 'handlePointerTap',
        });
      }
      if (constraint === 'fork-label') {
        layout.edges.find((edge) => edge.end === 'showConsole')!.label = 'Extra branch label';
      }
      const before = JSON.stringify(layout);
      expect(arrangeNestedLinearWorkflow(layout)).toBe(false);
      expect(JSON.stringify(layout)).toBe(before);
    }
  );
});
