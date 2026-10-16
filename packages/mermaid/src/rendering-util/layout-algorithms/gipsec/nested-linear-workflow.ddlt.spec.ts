import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Diagram } from '../../../Diagram.js';
import * as configApi from '../../../config.js';
import { getConfig } from '../../../diagram-api/diagramAPI.js';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
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

type MeasurementStyle = keyof typeof measurements;
type PrivateVariant = 'chains' | 'wrappers' | 'orphans' | 'combined';

interface GeneratedWorkflow {
  lengths: number[];
  depths: number[];
  branches: number;
  reverseLinks: boolean;
}

function measureParsedLayout(layout: LayoutData, variant: MeasurementStyle): LayoutData {
  const redux = variant.endsWith('Redux');
  for (const node of layout.nodes) {
    // New IDs retain captured labels, so measurements still come from real
    // renderer captures rather than invented sizes for the structural variants.
    const label = node.label ?? node.id;
    if (node.isGroup) {
      expect(titles[label], `title for ${node.id}: ${label}`).toBeDefined();
      node.labelBBox = { width: titles[label][redux ? 1 : 0], height: redux ? 21 : 24 };
    } else {
      const index = ids.indexOf(label);
      expect(index, `measurement for ${node.id}: ${label}`).toBeGreaterThanOrEqual(0);
      [node.width, node.height] = measurements[variant][index];
    }
  }
  for (const edge of layout.edges) {
    if (edge.label) {
      expect(labels[edge.label], `measurement for ${edge.label}`).toBeDefined();
      edge.width = labels[edge.label][redux ? 1 : 0];
      edge.height = redux ? 21 : 24;
    }
  }
  return layout;
}

function privateWorkflowSource(
  variant: PrivateVariant,
  direction: string,
  generated?: GeneratedWorkflow
) {
  const chains = variant === 'chains' || variant === 'combined';
  const wrappers = variant === 'wrappers' || variant === 'combined';
  const orphans = variant === 'orphans' || variant === 'combined';
  let chainIndex = 0;
  const chain = (id: string, length: number) =>
    Array.from({ length: generated?.lengths[chainIndex++] ?? (chains ? length : 1) }, (_, index) =>
      index ? `${id}Stage${index}` : id
    );
  const entry = chain('Knob', 3);
  const item = chain('ConsoleItem', 2);
  const key = chain('presetKey', 3);
  const update = chain('updateKnob', 2);
  const declarations = (members: string[], label: string) =>
    members.map((id) => `${id}["${label}"]`).join('\n');
  const orphan = (id: string) => (orphans ? `${id}["Knob"]` : '');
  const frame = (id: string, label: string, contents: string) =>
    `subgraph ${id}["${label}"]\n${contents}\nend`;
  let wrapperIndex = 0;
  const wrap = (contents: string, id: string, label: string, depth: number) => {
    depth = generated?.depths[wrapperIndex++] ?? depth;
    for (let index = 1; wrappers && index <= depth; index++) {
      contents = frame(`${id}${index}`, label, contents);
    }
    return contents;
  };
  const rack = wrap(
    frame('PresetRack', 'PresetRack', `${declarations(key, 'presetKey')}\n${orphan('rackNote')}`),
    'rackWrapper',
    'PresetRack',
    1
  );
  const console = wrap(
    frame(
      'Console',
      'Console',
      `${declarations(item, 'ConsoleItem')}\n${rack}\n${orphan('consoleNote')}`
    ),
    'consoleWrapper',
    'Console',
    2
  );
  const updateFrame = wrap(
    frame(
      'busRoutingCueState',
      'busRoutingCueState',
      `${declarations(update, 'updateKnob')}\n${orphan('updateNote')}`
    ),
    'updateWrapper',
    'busRoutingCueState',
    2
  );
  const internalLinks = [entry, item, key, update].flatMap((members) =>
    members.slice(1).map((id, index) => `${members[index]} -- OnClick --> ${id}`)
  );
  const extraBranches = Array.from(
    { length: (generated?.branches ?? 2) - 2 },
    (_, index) => `generatedBranch${index}`
  );
  const workflowLinks = [
    ...internalLinks,
    `${entry.at(-1)} -- OnClick --> handlePointerTap`,
    'handlePointerTap --> showConsole',
    'handlePointerTap --> hideConsole',
    'showConsole --> consoleManager',
    'hideConsole --> consoleManager',
    ...extraBranches.flatMap((id) => [`handlePointerTap --> ${id}`, `${id} --> consoleManager`]),
    'consoleManager -. Opens instance .-> Console',
    `${item.at(-1)} -- OnClick --> PresetRack`,
    'PresetRack -. Update .- mixerState',
    `${key.at(-1)} -- onSelection --> ${update[0]}`,
    `${update.at(-1)} --> renderPreset`,
  ];
  const source = [
    `flowchart ${direction}`,
    frame('Deck', 'Deck', `${declarations(entry, 'Knob')}\n${console}\n${orphan('deckNote')}`),
    frame('Store', 'Store', `mixerState\n${updateFrame}\n${orphan('storeNote')}`),
    frame(
      'mixerHandler',
      'mixerHandler',
      `handlePointerTap\nshowConsole\nhideConsole\n${declarations(extraBranches, 'hideConsole')}`
    ),
    'consoleManager',
    'renderPreset',
    ...(generated?.reverseLinks ? workflowLinks.reverse() : workflowLinks),
  ].join('\n');
  return { source, chains: [entry, item, key, update] };
}

async function parsedPrivateWorkflow(
  variant: PrivateVariant,
  style: MeasurementStyle,
  direction: string,
  generated?: GeneratedWorkflow
) {
  const { source, chains } = privateWorkflowSource(variant, direction, generated);
  configApi.reset();
  const diagram = await Diagram.fromText(source);
  const db = diagram.db as { getData: () => LayoutData; getDirection: () => string };
  const layout = db.getData();
  const conf = getConfig().flowchart;
  layout.direction = db.getDirection();
  layout.type = diagram.type;
  layout.nodeSpacing = conf?.nodeSpacing ?? 50;
  layout.rankSpacing = conf?.rankSpacing ?? 50;
  layout.markers = ['point', 'circle', 'cross'];
  return { layout: measureParsedLayout(layout, style), chains };
}

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

  it.each(['ports', 'minlen', 'direction', 'extra-link'])(
    'leaves a non-private or explicitly constrained workflow unchanged (%s)',
    async (constraint) => {
      const layout = await measuredLayout('classic');
      runStressAndGridLayoutCore(layout);
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
      const before = JSON.stringify(layout);
      expect(arrangeNestedLinearWorkflow(layout)).toBe(false);
      expect(JSON.stringify(layout)).toBe(before);
    }
  );

  it('reserves measured labels on fork, merge and terminal edges', async () => {
    const layout = await measuredLayout('classic');
    for (const edge of layout.edges.filter(
      (edge) =>
        edge.start === 'handlePointerTap' ||
        edge.end === 'consoleManager' ||
        edge.start === 'updateKnob'
    )) {
      edge.label = 'Operation details<br/>with a measured caption';
      edge.width = 220;
      edge.height = 48;
    }
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(
      layout.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
    ).toBe(true);
  });
});

describe('stress-and-grid DDLT — variable private workflow shells', () => {
  const generatedCases = Array.from({ length: 24 }, (_, seed) => ({
    seed,
    direction: ['TB', 'BT', 'LR', 'RL'][seed % 4],
    style: (Object.keys(measurements) as MeasurementStyle[])[Math.floor(seed / 4)],
    generated: {
      lengths: Array.from(
        { length: 4 },
        (_, role) => 1 + ((seed * 3 + Math.floor(seed / 4) + role * 2) % 4)
      ),
      depths: Array.from({ length: 4 }, (_, role) => Math.floor(seed / (role + 1)) % 3),
      branches: 2 + (seed % 3),
      reverseLinks: seed % 2 === 1,
    },
  }));

  it.each(generatedCases)(
    'safely lays out generated seed $seed with $style measurements in $direction',
    async ({ seed, style, direction, generated }) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { layout, chains } = await parsedPrivateWorkflow(
        'combined',
        style,
        direction,
        generated
      );
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
      }
      for (const chain of chains) {
        for (let index = 1; index < chain.length; index++) {
          const edge = layout.edges.find(
            (edge) => edge.start === chain[index - 1] && edge.end === chain[index]
          )!;
          expect(edge.points, edge.id).toHaveLength(2);
        }
      }
      expect(
        layout.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
      ).toBe(true);

      const edge = layout.edges[seed % layout.edges.length];
      if (seed % 8 === 0) {
        edge.startSide = 'left';
      } else if (seed % 8 === 1) {
        edge.endSide = 'top';
      } else if (seed % 8 === 2) {
        edge.minlen = 3;
      } else if (seed % 8 === 3) {
        edge.isLayoutOnly = true;
      } else if (seed % 8 === 4) {
        edge.height = NaN;
      } else if (seed % 8 === 5) {
        layout.nodes.find((node) => node.id === 'presetKey')!.width = -1;
      } else if (seed % 8 === 6) {
        layout.nodes.find((node) => node.id === 'Console')!.labelBBox!.height = Infinity;
      } else {
        layout.edges.push({ ...edge, id: `duplicate_${seed}` });
      }
      const before = structuredClone({ nodes: layout.nodes, edges: layout.edges });
      const nodes = [...layout.nodes];
      const edges = [...layout.edges];
      expect(arrangeNestedLinearWorkflow(layout)).toBe(false);
      expect({ nodes: layout.nodes, edges: layout.edges }).toStrictEqual(before);
      layout.nodes.forEach((node, index) => expect(node).toBe(nodes[index]));
      layout.edges.forEach((edge, index) => expect(edge).toBe(edges[index]));
    },
    15000
  );

  const cases = (['chains', 'wrappers', 'orphans', 'combined'] as PrivateVariant[]).flatMap(
    (variant) =>
      (Object.keys(measurements) as MeasurementStyle[]).flatMap((style) =>
        ['TB', 'BT', 'LR', 'RL'].map((direction) => ({ variant, style, direction }))
      )
  );

  it.each(cases)(
    'lays out parsed $variant with $style measurements in $direction',
    async ({ variant, style, direction }) => {
      // Let Vitest deliver worker updates between CPU-bound compound solves.
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      const { layout, chains } = await parsedPrivateWorkflow(variant, style, direction);
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      const hardIssues = result.issues.filter(
        (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
      );
      expect(hardIssues, JSON.stringify({ variant, style, direction, issues: hardIssues })).toEqual(
        []
      );
      expect(result.ok).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(
        layout.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
      ).toBe(true);
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
      }
      for (const chain of chains) {
        for (let index = 1; index < chain.length; index++) {
          const edge = layout.edges.find(
            (edge) => edge.start === chain[index - 1] && edge.end === chain[index]
          )!;
          expect(edge.points).toHaveLength(2);
          expect(
            Math.min(
              Math.abs(edge.points![0].x - edge.points![1].x),
              Math.abs(edge.points![0].y - edge.points![1].y)
            )
          ).toBeCloseTo(0);
        }
      }
    },
    // Real-parser compound stress solves can exceed the default under load.
    15000
  );
});
