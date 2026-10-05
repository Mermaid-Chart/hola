import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeNestedFrameEntry, nestedFrameEntryRoutes } from './nestedFrameEntry.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/stress-and-grid/nested-edge-labels.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    {
      nodes: Record<string, { width: number; height: number }>;
      titles: Record<string, { width: number; height: number }>;
      labels: Record<string, { width: number; height: number }>;
    }
  >;
};

async function measuredLayout(variant: string) {
  const layout = await parseMmdFileToLayoutData(
    resolve(
      process.cwd(),
      'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH nested with edge labels.mmd'
    ),
    { stampFlowchartRendererFields: true }
  );
  const sizes = measurements.variants[variant];
  for (const node of layout.nodes) {
    const measurement = node.isGroup ? sizes.titles[node.id] : sizes.nodes[node.id];
    expect(measurement, `measurement for ${node.id}`).toBeDefined();
    if (node.isGroup) {
      node.labelBBox = { ...measurement };
    } else {
      Object.assign(node, measurement);
    }
  }
  for (const edge of layout.edges) {
    if (edge.label) {
      expect(sizes.labels[edge.id], `measurement for ${edge.id}`).toBeDefined();
      Object.assign(edge, sizes.labels[edge.id]);
    }
  }
  return layout;
}

describe('stress-and-grid DDLT — labelled nested frame entries', () => {
  it.each(
    Object.keys(measurements.variants).flatMap((variant) =>
      ['LR', 'RL', 'TB', 'BT'].map((direction) => ({ variant, direction }))
    )
  )(
    'keeps entries straight and their labels clear of the frame in $variant / $direction',
    async ({ variant, direction }) => {
      const layout = await measuredLayout(variant);
      layout.direction = direction;
      runStressAndGridLayoutCore(layout);
      const beta = layout.nodes.find((node) => node.id === 'container_Beta')!;
      const alpha = layout.nodes.find((node) => node.id === 'container_Alpha')!;
      expect(beta.parentId).toBe(alpha.id);
      for (const edge of layout.edges) {
        expect(edge.points, edge.id).toHaveLength(2);
        if (!edge.label) {
          continue;
        }
        const source = layout.nodes.find((node) => node.id === edge.start)!;
        const target = layout.nodes.find((node) => node.id === edge.end)!;
        const horizontalChain = direction === 'LR' || direction === 'RL';
        const entry = horizontalChain ? 'y' : 'x';
        const size = horizontalChain ? 'height' : 'width';
        const start = { x: source.x, y: source.y };
        const end = { x: source.x, y: source.y };
        start[entry] = source[entry]! + source[size]! / 2;
        end[entry] = target[entry]! - target[size]! / 2;
        expect(edge.points).toEqual([start, end]);
        expect(
          edge[entry]! - edge[size]! / 2 - (source[entry]! + source[size]! / 2)
        ).toBeGreaterThanOrEqual(12 - 1e-6);
        expect(
          beta[entry]! - beta[size]! / 2 - (edge[entry]! + edge[size]! / 2)
        ).toBeGreaterThanOrEqual(12 - 1e-6);
      }
      const validation = validateLayout(layout);
      expect(
        validation.issues.filter(
          (issue) => issue.type !== 'group-dead-space' && issue.type !== 'group-elongation'
        )
      ).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.breakdown.crossings).toBe(0);
      expect(validation.breakdown.totalBendPenalty).toBe(0);
      expect(validation.score).toBeGreaterThan(850);
    }
  );

  it('uses topology rather than diagram identifiers or caption text', async () => {
    const layout = await measuredLayout('classic-default');
    const ids = new Map(layout.nodes.map((node, index) => [node.id, `renamed-${index}`]));
    for (const node of layout.nodes) {
      node.id = ids.get(node.id)!;
      node.parentId = node.parentId ? ids.get(node.parentId) : undefined;
    }
    for (const [index, edge] of layout.edges.entries()) {
      edge.id = `link-${index}`;
      edge.start = ids.get(edge.start!);
      edge.end = ids.get(edge.end!);
      if (edge.label) {
        edge.label = `caption ${index}`;
      }
    }
    runStressAndGridLayoutCore(layout);
    expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
    expect(validateLayout(layout).ok).toBe(true);
  });

  it('packs the complete frame together when an unrelated orphan is present', async () => {
    const layout = await measuredLayout('classic-default');
    layout.nodes.push({
      ...layout.nodes.find((node) => !node.isGroup)!,
      id: 'orphan',
      parentId: undefined,
      shape: 'rect',
      width: 80,
      height: 54,
    });
    runStressAndGridLayoutCore(layout);
    expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
    expect(nestedFrameEntryRoutes(layout).size).toBe(0);
    expect(validateLayout(layout).ok).toBe(true);
    const beta = layout.nodes.find((node) => node.id === 'container_Beta')!;
    for (const edge of layout.edges.filter((edge) => edge.label)) {
      expect(beta.y! - beta.height! / 2 - (edge.y! + edge.height! / 2)).toBeGreaterThanOrEqual(
        12 - 1e-6
      );
    }
  });

  it('reserves measured long multiline labels instead of assuming a fixed gap', async () => {
    const layout = await measuredLayout('classic-default');
    for (const edge of layout.edges.filter((edge) => edge.label)) {
      edge.label = `${edge.label}<br/>with additional detail`;
      edge.width = 320;
      edge.height = 72;
    }
    runStressAndGridLayoutCore(layout);
    expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
    expect(validateLayout(layout).ok).toBe(true);
    const labels = layout.edges.filter((edge) => edge.label);
    expect(Math.abs(labels[0].x! - labels[1].x!)).toBeGreaterThanOrEqual(344);
    const beta = layout.nodes.find((node) => node.id === 'container_Beta')!;
    for (const edge of labels) {
      expect(beta.y! - beta.height! / 2 - (edge.y! + edge.height! / 2)).toBeGreaterThanOrEqual(
        12 - 1e-6
      );
    }
  });

  it.each([
    'start port',
    'end port',
    'minimum length',
    'local direction',
    'extra link',
    'shape',
    'chain label',
  ])('leaves a workflow with %s constraints to the existing layout', async (constraint) => {
    const layout = await measuredLayout('classic-default');
    runStressAndGridLayoutCore(layout);
    if (constraint === 'start port') {
      layout.edges[2].startSide = 'left';
    } else if (constraint === 'end port') {
      layout.edges[2].endSide = 'right';
    } else if (constraint === 'minimum length') {
      layout.edges[2].minlen = 3;
    } else if (constraint === 'local direction') {
      layout.nodes.find((node) => node.id === 'container_Beta')!.dir = 'TB';
    } else if (constraint === 'extra link') {
      layout.edges.push({ ...layout.edges[0], id: 'extra-link' });
    } else if (constraint === 'chain label') {
      layout.edges[0].label = 'another caption';
    } else {
      layout.nodes.find((node) => node.id === 'process_C')!.shape = 'diamond';
    }
    const before = structuredClone(layout.nodes);
    expect(arrangeNestedFrameEntry(layout)).toBe(false);
    expect(nestedFrameEntryRoutes(layout).size).toBe(0);
    expect(layout.nodes).toEqual(before);
  });

  it('does not force direct ports when the entry corridor has not been arranged', async () => {
    const layout = await measuredLayout('classic-default');
    runStressAndGridLayoutCore(layout);
    layout.nodes.find((node) => node.id === 'process_C')!.x! += 10;
    expect(nestedFrameEntryRoutes(layout).size).toBe(0);
  });
});
