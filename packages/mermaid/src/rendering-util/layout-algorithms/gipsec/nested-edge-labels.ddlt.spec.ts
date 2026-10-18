import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Diagram } from '../../../Diagram.js';
import * as configApi from '../../../config.js';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import type { LayoutData } from '../../types.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeNestedFrameEntry, nestedFrameEntryRoutes } from './nestedFrameEntry.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/gipsec/nested-edge-labels.sizes.json'
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

describe('gipsec DDLT — labelled nested frame entries', () => {
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
    expect(nestedFrameEntryRoutes(layout).size).toBe(4);
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

  it('reserves measured captions on the internal chains too', async () => {
    const layout = await measuredLayout('classic-default');
    for (const edge of layout.edges.filter((edge) => !edge.label)) {
      edge.label = 'Internal operation<br/>with more detail';
      edge.width = 260;
      edge.height = 48;
    }
    runStressAndGridLayoutCore(layout);
    expect(layout.edges.every((edge) => edge.points!.length === 2)).toBe(true);
    expect(validateLayout(layout).ok).toBe(true);
    expect(validateLayout(layout).breakdown.crossings).toBe(0);
  });

  it.each(['start port', 'end port', 'minimum length', 'local direction', 'extra link', 'shape'])(
    'leaves a workflow with %s constraints to the existing layout',
    async (constraint) => {
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
      } else {
        layout.nodes.find((node) => node.id === 'process_C')!.shape = 'diamond';
      }
      const before = structuredClone(layout.nodes);
      expect(arrangeNestedFrameEntry(layout)).toBe(false);
      expect(nestedFrameEntryRoutes(layout).size).toBe(0);
      expect(layout.nodes).toEqual(before);
    }
  );

  it('does not force direct ports when the entry corridor has not been arranged', async () => {
    const layout = await measuredLayout('classic-default');
    runStressAndGridLayoutCore(layout);
    layout.nodes.find((node) => node.id === 'process_C')!.x! += 10;
    expect(nestedFrameEntryRoutes(layout).size).toBe(0);
  });
});

describe('generated parsed nested-entry safety cases', () => {
  // A fixed enumeration is reproducible without a fuzzing dependency. Vary
  // topology/order while retaining exact labels from the captured size fixture.
  const cases = Array.from({ length: 24 }, (_, seed) => ({
    seed,
    direction: ['LR', 'RL', 'TB', 'BT'][seed % 4],
    variant: Object.keys(measurements.variants)[Math.floor(seed / 4)],
    outerLength: 2 + (Math.floor(seed / 4) % 4),
    innerLength: 1 + ((seed * 5 + Math.floor(seed / 4)) % 4),
    wrapperDepth: seed % 3,
  }));

  it.each(cases)(
    'keeps seed $seed ($outerLength/$innerLength chains, $wrapperDepth wrappers) safe in $direction',
    async ({ seed, direction, variant, outerLength, innerLength, wrapperDepth }) => {
      const id = (role: string, index = 0) => `generated_${seed}_${role}_${index}`;
      const sources = Array.from({ length: outerLength }, (_, index) => id('source', index));
      const targets = Array.from({ length: innerLength }, (_, index) => id('target', index));
      const labels = new Map<string, string>([
        [id('outer'), 'container_Alpha'],
        [id('inner'), 'container_Beta'],
        ...sources.map((node, index) => [node, index % 2 ? 'process_B' : 'process_A'] as const),
        ...targets.map((node, index) => [node, index % 2 ? 'Process_D' : 'process_C'] as const),
      ]);
      const declare = (nodes: string[]) =>
        (seed % 2 ? [...nodes].reverse() : nodes)
          .map((node) => `${node}["${labels.get(node)}"]`)
          .join('\n');
      let contents = `subgraph ${id('outer')}["container_Alpha"]
        ${declare(sources)}
        subgraph ${id('inner')}["container_Beta"]
          ${declare(targets)}
        end
      end`;
      for (let level = 0; level < wrapperDepth; level++) {
        labels.set(id('wrapper', level), 'container_Alpha');
        contents = `subgraph ${id('wrapper', level)}["container_Alpha"]\n${contents}\nend`;
      }
      const links = [
        ...[sources, targets].flatMap((chain) =>
          chain.slice(1).map((node, index) => `${chain[index]} -->|messages| ${node}`)
        ),
        `${sources[0]} -->|messages| ${targets[0]}`,
        `${sources.at(-1)} -->|via_AWSBatch| ${id('inner')}`,
      ];
      configApi.reset();
      const diagram = await Diagram.fromText(
        `flowchart ${direction}\n${contents}\n${(seed % 2 ? links.reverse() : links).join('\n')}`
      );
      const layout = (diagram.db as { getData: () => LayoutData }).getData();
      layout.direction = direction;
      layout.type = diagram.type;
      layout.nodeSpacing = 50;
      layout.rankSpacing = 50;
      layout.markers = ['point', 'circle', 'cross'];
      const sizes = measurements.variants[variant];
      for (const node of layout.nodes) {
        const label = labels.get(node.id)!;
        const size = node.isGroup ? sizes.titles[label] : sizes.nodes[label];
        expect(size, `captured measurement for ${node.id}`).toBeDefined();
        if (node.isGroup) {
          node.labelBBox = { ...size };
        } else {
          Object.assign(node, size);
        }
      }
      for (const edge of layout.edges) {
        const key =
          edge.label === 'messages' ? 'L_process_A_process_C_0' : 'L_process_B_container_Beta_0';
        Object.assign(edge, sizes.labels[key]);
      }
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const result = validateLayout(layout);
      expect(result.ok, JSON.stringify(result.issues)).toBe(true);
      expect(result.breakdown.crossings).toBe(0);
      expect(layout.edges.every((edge) => edge.points?.length === 2)).toBe(true);
      for (const node of layout.nodes) {
        expect(node.parentId).toBe(parents.get(node.id));
      }

      // Constraints on a generated participant must select fallback without
      // changing any geometry, semantic endpoint, constraint or object identity.
      const edge = layout.edges[seed % layout.edges.length];
      if (seed % 8 === 0) {
        edge.startSide = 'left';
      } else if (seed % 8 === 1) {
        edge.endSide = 'bottom';
      } else if (seed % 8 === 2) {
        edge.minlen = 3;
      } else if (seed % 8 === 3) {
        edge.isLayoutOnly = true;
      } else if (seed % 8 === 4) {
        edge.width = NaN;
      } else if (seed % 8 === 5) {
        layout.nodes.find((node) => node.id === sources[0])!.width = -1;
      } else if (seed % 8 === 6) {
        layout.nodes.find((node) => node.id === id('inner'))!.labelBBox!.height = Infinity;
      } else {
        layout.edges.push({ ...edge, id: `duplicate_${seed}` });
      }
      const before = structuredClone({ nodes: layout.nodes, edges: layout.edges });
      const nodes = [...layout.nodes];
      const edges = [...layout.edges];
      expect(arrangeNestedFrameEntry(layout)).toBe(false);
      expect(nestedFrameEntryRoutes(layout).size).toBe(0);
      expect({ nodes: layout.nodes, edges: layout.edges }).toStrictEqual(before);
      layout.nodes.forEach((node, index) => expect(node).toBe(nodes[index]));
      layout.edges.forEach((edge, index) => expect(edge).toBe(edges[index]));
    },
    15000
  );
});
