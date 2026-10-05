import { describe, expect, it } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import {
  arrangeThreeMemberGroupExitRows,
  reserveTerminalLabelClearance,
  runStressAndGridLayoutCore,
} from './index.js';

function node(id: string): Node {
  return {
    id,
    label: id,
    isGroup: false,
    shape: 'rect',
    width: 80,
    height: 40,
  } as Node;
}

function edge(start: string, end: string): Edge {
  return { id: `${start}-${end}`, start, end } as Edge;
}

function treeLayout(): LayoutData {
  return {
    nodes: [node('root'), node('left'), node('middle'), node('right')],
    edges: [edge('root', 'left'), edge('root', 'middle'), edge('root', 'right')],
    direction: 'TB',
    config: { flowchart: { nodeSpacing: 50, rankSpacing: 50 } },
  } as unknown as LayoutData;
}

describe('stress-and-grid layout', () => {
  it.each(['TB', 'BT', 'LR', 'RL'])(
    'reserves a private terminal label corridor along its existing %s axis',
    (direction) => {
      const horizontal = direction === 'LR' || direction === 'RL';
      const sign = direction === 'BT' || direction === 'RL' ? -1 : 1;
      const source = { ...node('source'), x: 0, y: 0 };
      const target = {
        ...node('target'),
        x: horizontal ? sign * 100 : 0,
        y: horizontal ? 0 : sign * 60,
      };
      const predecessor = {
        ...node('predecessor'),
        x: horizontal ? -sign * 120 : 0,
        y: horizontal ? 0 : -sign * 100,
      };
      const data = {
        nodes: [predecessor, source, target],
        edges: [
          edge('predecessor', 'source'),
          { ...edge('source', 'target'), label: 'A long terminal label', width: 240, height: 48 },
        ],
        direction,
        config: {},
      } as LayoutData;
      reserveTerminalLabelClearance(data);
      expect(source.x).toBe(0);
      expect(source.y).toBe(0);
      expect(target.x).toBe(horizontal ? sign * (80 + 240 + 24) : 0);
      expect(target.y).toBe(horizontal ? 0 : sign * (40 + 48 + 24));
    }
  );

  it.each([
    'target-blocked',
    'corridor-blocked',
    'source-fan',
    'shared-target',
    'framed',
    'start-side',
    'end-side',
  ])('retains a labelled terminal branch when %s', (guard) => {
    const source = { ...node('source'), x: 0, y: 0 };
    const target = {
      ...node('target'),
      x: 100,
      y: 0,
      ...(guard === 'framed' ? { parentId: 'frame' } : {}),
    };
    const blocker = {
      ...node('blocker'),
      x: guard === 'corridor-blocked' ? 180 : 344,
      y: ['target-blocked', 'corridor-blocked'].includes(guard) ? 0 : 300,
    };
    const labelled = {
      ...edge('source', 'target'),
      label: 'A long terminal label',
      width: 240,
      height: 48,
      ...(guard === 'start-side' ? { startSide: 'right' as const } : {}),
      ...(guard === 'end-side' ? { endSide: 'left' as const } : {}),
    };
    const data = {
      nodes: [source, target, blocker],
      edges: [
        labelled,
        ...(guard === 'source-fan' ? [edge('source', 'blocker')] : []),
        ...(guard === 'shared-target' ? [edge('blocker', 'target')] : []),
      ],
      config: {},
    } as LayoutData;
    reserveTerminalLabelClearance(data);
    expect(target.x).toBe(100);
    expect(target.y).toBe(0);
  });

  it('normalizes a three-member exit row even when the isolated shape starts outside it', () => {
    const group = {
      ...node('group'),
      isGroup: true,
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    } as Node;
    const left = { ...node('left'), parentId: group.id, x: 0, y: 160 } as Node;
    const right = { ...node('right'), parentId: group.id, x: 100, y: 160 } as Node;
    const isolated = {
      ...node('isolated'),
      parentId: group.id,
      shape: 'circle',
      width: 74,
      height: 74,
      x: 220,
      y: 120,
    } as Node;
    const leftTarget = { ...node('leftTarget'), x: -200, y: 160 } as Node;
    const rightTarget = { ...node('rightTarget'), x: 300, y: 160 } as Node;
    const data = {
      nodes: [group, left, right, isolated, leftTarget, rightTarget],
      edges: [edge(left.id, leftTarget.id), edge(right.id, rightTarget.id)],
      direction: 'LR',
      config: {},
    } as LayoutData;

    arrangeThreeMemberGroupExitRows(data);

    expect(isolated.x).toBeCloseTo((left.x! + right.x!) / 2);
    expect(left.x! + left.width! / 2 + 36).toBeLessThanOrEqual(isolated.x! - isolated.width! / 2);
    expect(isolated.x! + isolated.width! / 2 + 36).toBeLessThanOrEqual(right.x! - right.width! / 2);
    expect(left.y).toBe(right.y);
  });

  it('runs IPSEP-COLA and HOLA grid beautification over every tree node', () => {
    const data = treeLayout();

    const result = runStressAndGridLayoutCore(data);

    // Unlike HOLA, this backend has no tree/core decomposition: all four nodes
    // are variables in the one IPSEP-COLA + grid solve.
    expect(result.variableCount).toBe(4);
    expect(data.nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(
      true
    );
    expect(
      data.edges.every(
        (edge) =>
          edge.points !== undefined &&
          edge.points.length >= 2 &&
          edge.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))
      )
    ).toBe(true);
  });

  it.each(['TB', 'BT', 'LR', 'RL'])('renders %s flow with rounded grid routes', (direction) => {
    const data = treeLayout();
    data.direction = direction;

    runStressAndGridLayoutCore(data);

    expect(data.edges.map((edge) => edge.curve)).toEqual(['rounded', 'rounded', 'rounded']);
    expect(data.edges.every((edge) => edge.hasIntersectionPoints === true)).toBe(true);
  });
});
