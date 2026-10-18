import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';
import { arrangeExternalSiblingFrameCycles, externalSiblingFrameCycleRoutes } from './frameGrid.js';

addDiagrams();

const measurements = JSON.parse(
  readFileSync(
    resolve(
      process.cwd(),
      'packages/mermaid/src/rendering-util/layout-algorithms/gipsec/nested-mayhem.sizes.json'
    ),
    'utf8'
  )
) as {
  variants: Record<
    string,
    {
      nodes: Record<string, { x: number; y: number; width: number; height: number }>;
      titles: Record<string, { width: number; height: number }>;
    }
  >;
};

async function measuredLayout(variant: string) {
  const layout = await parseMmdFileToLayoutData(
    resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH nested mayhem.mmd'),
    { stampFlowchartRendererFields: true }
  );
  const sizes = measurements.variants[variant];
  for (const node of layout.nodes) {
    const measurement = node.isGroup ? sizes.titles[node.id] : sizes.nodes[node.id];
    expect(measurement, `measurement for ${node.id}`).toBeDefined();
    if (node.isGroup) {
      node.labelBBox = { ...measurement };
    } else {
      node.width = measurement.width;
      node.height = measurement.height;
    }
  }
  return layout;
}

describe('gipsec DDLT — external cycle around nested sibling frames', () => {
  it.each(Object.keys(measurements.variants))(
    'keeps the outside node clear and the lateral edge runs outside the ancestor in %s',
    async (variant) => {
      const layout = await measuredLayout(variant);
      const parents = new Map(layout.nodes.map((node) => [node.id, node.parentId]));
      runStressAndGridLayoutCore(layout);
      const node = (id: string) => layout.nodes.find((node) => node.id === id)!;
      const source = node('X');
      const target = node('Y');
      const outer = node('Z');
      const outside = node('P');
      const horizontal = Math.abs(source.x! - target.x!) >= Math.abs(source.y! - target.y!);
      const along = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const size = horizontal ? 'height' : 'width';
      const sign = Math.sign(outside[across]! - outer[across]!);
      expect(outside[along]).toBeCloseTo((source[along]! + target[along]!) / 2, 6);
      expect(
        Math.abs(outside[across]! - outer[across]!) - (outside[size]! + outer[size]!) / 2
      ).toBeGreaterThanOrEqual(30);
      const border = outer[across]! + (sign * outer[size]!) / 2;
      for (const id of ['L_X_P_0', 'L_P_Y_0']) {
        const edge = layout.edges.find((edge) => edge.id === id)!;
        expect(edge.points, id).toHaveLength(3);
        // An edge naming a nested frame must cross its ancestor on departure
        // or arrival. Only that normal crossing belongs inside the ancestor;
        // the lateral run and its bend must be wholly outside the frame.
        const lateral = id === 'L_X_P_0' ? edge.points!.slice(1) : edge.points!.slice(0, 2);
        expect(lateral.every((point) => sign * (point[across] - border) >= 30)).toBe(true);
      }
      for (const member of layout.nodes) {
        expect(member.parentId).toBe(parents.get(member.id));
        if (!member.isGroup && member !== outside) {
          const before = measurements.variants[variant].nodes[member.id];
          expect(member.x, member.id).toBeCloseTo(before.x, 5);
          expect(member.y, member.id).toBeCloseTo(before.y, 5);
        }
      }
      const validation = validateLayout(layout);
      expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
      expect(validation.ok).toBe(true);
      expect(validation.breakdown.crossings).toBe(0);
      // The preserved diagonal placement in neo/default needs two bends on
      // Y → X. Neither outside link needs that detour or a short port stub.
      expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(5);
    }
  );

  it.each(['LR', 'RL', 'BT'])(
    'keeps normal ancestor crossings and one-bend outer routes in %s flow',
    async (direction) => {
      const layout = await measuredLayout('classic-default');
      layout.direction = direction;
      runStressAndGridLayoutCore(layout);
      const routes = externalSiblingFrameCycleRoutes(layout);
      expect(routes.size).toBe(2);
      expect([...routes.values()].every((points) => points.length === 3)).toBe(true);
      expect(validateLayout(layout).ok).toBe(true);
      expect(validateLayout(layout).breakdown.crossings).toBe(0);
    }
  );

  it('matches renamed frames and links without using diagram identifiers', async () => {
    const layout = await measuredLayout('classic-default');
    const ids = new Map(layout.nodes.map((node, index) => [node.id, `node-${index}`]));
    for (const node of layout.nodes) {
      node.id = ids.get(node.id)!;
      node.parentId = node.parentId ? ids.get(node.parentId) : undefined;
    }
    for (const [index, edge] of layout.edges.entries()) {
      edge.id = `edge-${index}`;
      edge.start = ids.get(edge.start!);
      edge.end = ids.get(edge.end!);
    }
    runStressAndGridLayoutCore(layout);
    expect(externalSiblingFrameCycleRoutes(layout).size).toBe(2);
    expect(validateLayout(layout).ok).toBe(true);
  });

  it.each([
    'start port',
    'end port',
    'minlen',
    'caption',
    'shared outside node',
    'local direction',
    'changed cycle',
    'member bridge',
    'extra child',
  ])('does not move the outside node or override ports with %s', async (constraint) => {
    const layout = await measuredLayout('classic-default');
    runStressAndGridLayoutCore(layout);
    const incoming = layout.edges.find((edge) => edge.id === 'L_X_P_0')!;
    const outgoing = layout.edges.find((edge) => edge.id === 'L_P_Y_0')!;
    if (constraint === 'start port') {
      incoming.startSide = 'right';
    } else if (constraint === 'end port') {
      outgoing.endSide = 'left';
    } else if (constraint === 'minlen') {
      incoming.minlen = 3;
    } else if (constraint === 'caption') {
      outgoing.label = 'Needs its own measured lane';
    } else if (constraint === 'shared outside node') {
      layout.edges.push({ ...incoming, id: 'extra', start: 'a' });
    } else if (constraint === 'local direction') {
      layout.nodes.find((node) => node.id === 'X')!.dir = 'TB';
    } else if (constraint === 'changed cycle') {
      const bridge = layout.edges.find((edge) => edge.id === 'L_Y_X_0')!;
      bridge.start = 'X';
      bridge.end = 'Y';
    } else if (constraint === 'member bridge') {
      layout.edges.find((edge) => edge.id === 'L_c_d_0')!.end = 'b';
    } else {
      layout.nodes.push({
        ...layout.nodes.find((node) => node.id === 'a')!,
        id: 'extra-child',
        parentId: 'Z',
      });
    }
    const before = structuredClone(layout.nodes);
    arrangeExternalSiblingFrameCycles(layout);
    expect(layout.nodes).toEqual(before);
    expect(externalSiblingFrameCycleRoutes(layout).size).toBe(0);
  });

  it.each(['outside node', 'route', 'ancestor title'])(
    'rolls back atomically if an %s obstacle blocks the outer band',
    async (obstacle) => {
      const layout = await measuredLayout('classic-default');
      runStressAndGridLayoutCore(layout);
      const outside = layout.nodes.find((node) => node.id === 'P')!;
      const source = layout.nodes.find((node) => node.id === 'X')!;
      if (obstacle === 'ancestor title') {
        layout.nodes.find((node) => node.id === 'Z')!.labelBBox = { width: 600, height: 24 };
      } else {
        layout.nodes.push({
          ...outside,
          id: 'obstacle',
          x:
            obstacle === 'outside node'
              ? outside.x
              : (source.x! + outside.x! - outside.width! / 2) / 2,
          width: 10,
          height: 10,
        });
      }
      // Simulate an existing solve with the outside node far off to the
      // right. A failed corridor must retain this position, not half-apply.
      outside.x! += 200;
      const before = structuredClone(layout.nodes);
      arrangeExternalSiblingFrameCycles(layout);
      expect(layout.nodes).toEqual(before);
      expect(externalSiblingFrameCycleRoutes(layout).size).toBe(0);
    }
  );

  it('does not reuse absolute ports when the complete drawing is translated', async () => {
    const layout = await measuredLayout('classic-default');
    runStressAndGridLayoutCore(layout);
    const before = externalSiblingFrameCycleRoutes(layout);
    for (const node of layout.nodes) {
      node.x! += 300;
      node.y! += 180;
    }
    const after = externalSiblingFrameCycleRoutes(layout);
    for (const [id, points] of before) {
      expect(after.get(id)).toEqual(
        points.map((point) => ({ x: point.x + 300, y: point.y + 180 }))
      );
    }
  });
});
