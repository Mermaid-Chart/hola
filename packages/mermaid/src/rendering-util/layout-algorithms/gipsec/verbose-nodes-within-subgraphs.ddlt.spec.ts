import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { normalizePolyline, segmentsCross } from '../layout-utils/geometry.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

const fixture = resolve(
  process.cwd(),
  'e2e/platform/dev-diagrams/test-dataset/VERBOSE nodes within subgraphs'
);
const measurements = JSON.parse(readFileSync(`${fixture}.sizes.json`, 'utf8')) as {
  nodes: { id: string; width: number; height: number }[];
};
// Classic/default titles measured in the browser before fixing frame placement.
const titles: Record<string, number> = {
  Operations: 77.765625,
  Async: 40.46875,
  Data: 32.96875,
  Backend: 59.84375,
  Edge: 34.25,
  Client: 42.671875,
};

describe('stress-and-grid DDLT — dense member links between sibling frames', () => {
  it('routes workers to monitoring without wrapping around the worker node', async () => {
    const layout = await parseMmdFileToLayoutData(`${fixture}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    for (const node of layout.nodes) {
      if (node.isGroup) {
        expect(titles[node.id], `captured title for ${node.id}`).toBeDefined();
        node.labelBBox = { width: titles[node.id], height: 24 } as DOMRect;
      } else {
        const size = measurements.nodes.find((entry) => entry.id === node.id);
        expect(size, `captured size for ${node.id}`).toBeDefined();
        node.width = size!.width;
        node.height = size!.height;
      }
    }
    runStressAndGridLayoutCore(layout);
    const route = layout.edges.find((edge) => edge.start === 'WK' && edge.end === 'OBS');
    expect(route?.points).toBeDefined();
    // A side-facing route needs at most two bends; orbiting the source to
    // preserve an automatically chosen port is not an acceptable alternative.
    expect(
      normalizePolyline(route!.points!).points.length,
      JSON.stringify(route!.points)
    ).toBeLessThanOrEqual(4);
  });
  it('keeps storage and pub/sub routes from crossing each other in their shared corridor', async () => {
    const layout = await parseMmdFileToLayoutData(`${fixture}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    for (const node of layout.nodes) {
      if (node.isGroup) {
        expect(titles[node.id], `captured title for ${node.id}`).toBeDefined();
        node.labelBBox = { width: titles[node.id], height: 24 } as DOMRect;
      } else {
        const size = measurements.nodes.find((entry) => entry.id === node.id);
        expect(size, `captured size for ${node.id}`).toBeDefined();
        node.width = size!.width;
        node.height = size!.height;
      }
    }
    runStressAndGridLayoutCore(layout);
    const storage = layout.edges.find((edge) => edge.start === 'APP' && edge.end === 'OBJ')!;
    const feedback = layout.edges.find((edge) => edge.start === 'PUB' && edge.end === 'APP')!;
    const crossings = normalizePolyline(storage.points!).segments.flatMap((segment) =>
      normalizePolyline(feedback.points!).segments.filter((other) => segmentsCross(segment, other))
    );
    expect(crossings, JSON.stringify([storage.points, feedback.points])).toHaveLength(0);
    expect(validateLayout(layout).ok).toBe(true);
  });
  it.each(['LR', 'RL', 'TB', 'BT'])('keeps final frame geometry clear in %s', async (direction) => {
    const layout = await parseMmdFileToLayoutData(`${fixture}.mmd`, {
      stampFlowchartRendererFields: true,
    });
    layout.direction = direction;
    for (const node of layout.nodes) {
      if (node.isGroup) {
        expect(titles[node.id]).toBeDefined();
        node.labelBBox = { width: titles[node.id], height: 24 } as DOMRect;
      } else {
        const size = measurements.nodes.find((entry) => entry.id === node.id);
        expect(size, `captured size for ${node.id}`).toBeDefined();
        node.width = size!.width;
        node.height = size!.height;
      }
    }
    const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
    const edges = layout.edges.map((edge) => ({
      id: edge.id,
      start: edge.start,
      end: edge.end,
      startSide: edge.startSide,
      endSide: edge.endSide,
    }));
    runStressAndGridLayoutCore(layout);
    const result = validateLayout(layout);
    expect(
      result.issues.filter((issue) =>
        ['node-overlap', 'node-too-close-to-group', 'group-group-padding'].includes(issue.type)
      )
    ).toEqual([]);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    // Directional projections need different obstacle detours. Bound their
    // complexity without demanding identical routes from every projection.
    expect(result.breakdown.crossings).toBeLessThanOrEqual(30);
    expect(Math.max(...result.breakdown.edges.map((edge) => edge.points))).toBeLessThanOrEqual(12);
    for (const node of layout.nodes) {
      expect(node.parentId).toBe(parents.get(node.id));
    }
    expect(
      layout.edges.map(({ id, start, end, startSide, endSide }) => ({
        id,
        start,
        end,
        startSide,
        endSide,
      }))
    ).toEqual(edges);
  });
});
