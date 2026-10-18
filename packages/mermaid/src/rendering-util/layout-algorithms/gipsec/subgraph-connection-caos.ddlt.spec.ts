import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addDiagrams } from '../../../diagram-api/diagram-orchestration.js';
import { parseMmdFileToLayoutData } from '../ddlt/parseToLayoutData.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import { runStressAndGridLayoutCore } from './index.js';

addDiagrams();

describe('gipsec DDLT — mixed frame and member connections', () => {
  it('uses a regular frame row and separates forward and return bypasses', async () => {
    const layout = await parseMmdFileToLayoutData(
      resolve(process.cwd(), 'e2e/platform/dev-diagrams/test-dataset/SUBGRAPH connection caos.mmd'),
      { stampFlowchartRendererFields: true }
    );
    // Classic/default browser measurements captured before the fix.
    const widths: Record<string, number> = {
      a1: 76.796875,
      a2: 76.796875,
      b1: 77.3125,
      b2: 77.3125,
      c1: 76.3125,
      c2: 76.3125,
    };
    const titles: Record<string, number> = { one: 26.0625, two: 26.84375, three: 38.765625 };
    for (const node of layout.nodes) {
      if (node.isGroup) {
        node.labelBBox = { width: titles[node.id], height: 24 } as DOMRect;
      } else {
        expect(widths[node.id], `measurement for ${node.id}`).toBeDefined();
        node.width = widths[node.id];
        node.height = 54;
      }
    }
    runStressAndGridLayoutCore(layout);

    const b1 = layout.nodes.find((node) => node.id === 'b1')!;
    const b2 = layout.nodes.find((node) => node.id === 'b2')!;
    const c1 = layout.nodes.find((node) => node.id === 'c1')!;
    const c2 = layout.nodes.find((node) => node.id === 'c2')!;
    const internalGap = b2.y! - b2.height! / 2 - (b1.y! + b1.height! / 2);
    const neighbouringGap = c2.y! - c2.height! / 2 - (c1.y! + c1.height! / 2);
    expect(internalGap).toBeCloseTo(neighbouringGap, 6);
    expect(internalGap).toBeLessThanOrEqual(40);

    const frames = layout.nodes.filter((node) => node.isGroup).sort((a, b) => a.x! - b.x!);
    expect(frames.map((node) => node.id)).toEqual(['three', 'one', 'two']);
    expect(frames.find((node) => node.id === 'two')!.height).toBeCloseTo(
      frames.find((node) => node.id === 'one')!.height!,
      6
    );
    const gaps = frames
      .slice(1)
      .map(
        (node, index) => node.x! - node.width! / 2 - (frames[index].x! + frames[index].width! / 2)
      );
    expect(gaps[0]).toBeGreaterThanOrEqual(40);
    expect(gaps[0]).toBeCloseTo(gaps[1], 6);
    for (const frame of frames) {
      expect(frame.y! - frame.height! / 2).toBeCloseTo(frames[0].y! - frames[0].height! / 2, 6);
    }
    const forward = layout.edges.find((edge) => edge.id === 'L_three_two_0')!;
    const feedback = layout.edges.find((edge) => edge.id === 'L_two_c2_0')!;
    expect(forward.points).toHaveLength(4);
    expect(feedback.points).toHaveLength(4);
    expect(Math.min(...forward.points!.map((point) => point.y))).toBeLessThan(
      Math.min(...frames.map((node) => node.y! - node.height! / 2))
    );
    expect(Math.max(...feedback.points!.map((point) => point.y))).toBeGreaterThan(
      Math.max(...frames.map((node) => node.y! + node.height! / 2))
    );
    const validation = validateLayout(layout);
    expect(validation.issues.filter((issue) => issue.type !== 'group-dead-space')).toEqual([]);
    expect(validation.breakdown.crossings).toBe(0);
    expect(validation.breakdown.totalBendPenalty).toBeLessThanOrEqual(15);
  });
});
