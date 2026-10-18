import { describe, expect, it, vi } from 'vitest';
import type { Edge, LayoutData, Node } from '../../types.js';
import type { Point } from '../layout-utils/types.js';
import { validateLayout } from '../layout-utils/validateLayout.js';
import * as captionGeometry from './captionGeometry.js';
import { alignSiblingFrameRows, compactRootFrameBands } from './frameGrid.js';
import {
  arrangeNestedLinearWorkflow,
  nestedLinearWorkflowPorts,
  nestedLinearWorkflowRoutes,
} from './nestedLinearWorkflow.js';
import { routeStressAndGridEdges } from './routing.js';

// These tests exercise the pure placement helper, not the production pipeline.
// Parser-produced DDLT and browser specs cover the integration separately.
function workflow(branchCount = 2): LayoutData {
  const leaf = (id: string, x: number, y: number, parentId?: string, width = 80): Node =>
    ({ id, x, y, parentId, width, height: 40, isGroup: false, shape: 'rect' }) as Node;
  const frame = (id: string, x: number, y: number, parentId?: string): Node =>
    ({
      id,
      x,
      y,
      parentId,
      width: 300,
      height: 500,
      isGroup: true,
      labelBBox: { width: 100, height: 24 },
    }) as Node;
  const link = (start: string, end: string): Edge =>
    ({ id: `${start}-${end}`, start, end, type: 'arrow', label: '', width: 0, height: 0 }) as Edge;
  const branches = Array.from({ length: branchCount }, (_, index) =>
    leaf(`branch${index}`, (index - (branchCount - 1) / 2) * 160, 160, 'handler', 80 + index * 20)
  );
  return {
    direction: 'TB',
    config: {},
    nodes: [
      frame('handler', 0, 80),
      leaf('source', 0, 0, 'handler'),
      ...branches,
      leaf('merge', 0, 320),
      frame('outer', 400, 220),
      leaf('entry', 400, 0, 'outer'),
      frame('nested', 400, 260, 'outer'),
      leaf('item', 400, 160, 'nested'),
      frame('inner', 400, 380, 'nested'),
      leaf('key', 400, 380, 'inner'),
      frame('store', 800, 450),
      leaf('state', 800, 380, 'store'),
      frame('update-frame', 800, 540, 'store'),
      leaf('update', 800, 540, 'update-frame'),
      leaf('terminal', 800, 760),
    ],
    edges: [
      link('entry', 'source'),
      ...branches.map((node) => link('source', node.id)),
      ...branches.map((node) => link(node.id, 'merge')),
      link('merge', 'nested'),
      link('item', 'inner'),
      link('inner', 'state'),
      link('key', 'update'),
      link('update', 'terminal'),
    ],
  };
}

function node(data: LayoutData, id: string): Node {
  return data.nodes.find((member) => member.id === id)!;
}

function wrapWithUnrelatedSibling(data: LayoutData): void {
  const template = node(data, 'outer');
  for (const member of data.nodes.filter((member) => !member.parentId)) {
    member.parentId = 'context';
  }
  data.nodes.push(
    { ...template, id: 'context', parentId: undefined, x: 900, y: 450, width: 2600, height: 1400 },
    { ...template, id: 'unrelated', parentId: 'context', x: 2000, y: 440 },
    { ...node(data, 'source'), id: 'other-start', parentId: 'unrelated', x: 2000, y: 340 },
    { ...node(data, 'source'), id: 'other-end', parentId: 'unrelated', x: 2000, y: 540 }
  );
  data.edges.push({
    ...data.edges[0],
    id: 'other-start-other-end',
    start: 'other-start',
    end: 'other-end',
  });
}

function assertContained(data: LayoutData): void {
  for (const child of data.nodes.filter((member) => member.parentId)) {
    const parent = node(data, child.parentId!);
    expect(child.x! - child.width! / 2).toBeGreaterThanOrEqual(parent.x! - parent.width! / 2 + 8);
    expect(child.x! + child.width! / 2).toBeLessThanOrEqual(parent.x! + parent.width! / 2 - 8);
    expect(child.y! - child.height! / 2).toBeGreaterThanOrEqual(
      parent.y! - parent.height! / 2 + (parent.labelBBox?.height ?? 0) + 8
    );
    expect(child.y! + child.height! / 2).toBeLessThanOrEqual(parent.y! + parent.height! / 2 - 8);
  }
}

function boundaryPorts(data: LayoutData): Map<string, Point> {
  const ports = new Map<string, Point>();
  const preferences = nestedLinearWorkflowPorts(data);
  const branches = data.nodes.filter((member) => member.id.startsWith('branch'));
  for (const edge of data.edges) {
    const source = node(data, edge.start!);
    const target = node(data, edge.end!);
    const forkIndex = branches.indexOf(target);
    const mergeIndex = branches.indexOf(source);
    const offset = (index: number) => (index - (branches.length - 1) / 2) * 24;
    const point = (node: Node, side: Edge['startSide'], fanOffset: number): Point => ({
      x:
        node.x! +
        (side === 'left' ? -node.width! / 2 : side === 'right' ? node.width! / 2 : fanOffset),
      y: node.y! + (side === 'top' ? -node.height! / 2 : side === 'bottom' ? node.height! / 2 : 0),
    });
    ports.set(
      `${edge.id}:start`,
      point(
        source,
        preferences.get(edge.id)?.startSide ?? 'bottom',
        forkIndex >= 0 ? offset(forkIndex) : 0
      )
    );
    ports.set(
      `${edge.id}:end`,
      point(
        target,
        preferences.get(edge.id)?.endSide ?? 'top',
        mergeIndex >= 0 ? offset(mergeIndex) : 0
      )
    );
  }
  return ports;
}

function foreignNode(data: LayoutData, x: number, y: number): void {
  data.nodes.push({ ...node(data, 'terminal'), id: 'foreign', x, y, width: 40, height: 40 });
}

type ChainRole = 'entry' | 'item' | 'key' | 'update';

function extendPrivateChain(data: LayoutData, role: ChainRole, length: number) {
  const targets: Record<ChainRole, string> = {
    entry: 'source',
    item: 'inner',
    key: 'update',
    update: 'terminal',
  };
  const head = node(data, role);
  const bridgeIndex = data.edges.findIndex(
    (edge) => edge.start === role && edge.end === targets[role]
  );
  const bridge = data.edges[bridgeIndex];
  const members = [head];
  for (let index = 1; index < length; index++) {
    const member = {
      ...head,
      id: `${role}-chain-${index}`,
      y: head.y! + index * (head.height! + 48),
    } as Node;
    members.push(member);
    data.nodes.push(member);
  }
  const internalEdges = members.slice(1).map((member, index) => ({
    ...bridge,
    id: `${members[index].id}-${member.id}`,
    start: members[index].id,
    end: member.id,
    label: '',
    width: 0,
    height: 0,
  }));
  const tail = members.at(-1)!;
  data.edges.splice(bridgeIndex, 1, ...internalEdges, {
    ...bridge,
    id: `${tail.id}-${targets[role]}`,
    start: tail.id,
  });
  return { members, internalEdges };
}

function wrapPrivateFrame(data: LayoutData, id: string, depth: number): Node[] {
  const wrappers: Node[] = [];
  let nested = node(data, id);
  for (let index = 1; index <= depth; index++) {
    const wrapper = {
      ...nested,
      id: `${id}-wrapper-${index}`,
      y: nested.y! - 12,
      width: nested.width! + 48,
      height: nested.height! + 72,
    } as Node;
    nested.parentId = wrapper.id;
    data.nodes.push(wrapper);
    wrappers.push(wrapper);
    nested = wrapper;
  }
  return wrappers;
}

function addPrivateOrphan(data: LayoutData, parentId: string): Node {
  const parent = node(data, parentId);
  const orphan = {
    ...node(data, 'key'),
    id: `${parentId}-orphan`,
    parentId,
    x: parent.x! - 240,
    y: parent.y! + 120,
  } as Node;
  data.nodes.push(orphan);
  return orphan;
}

function assertPrivateChains(data: LayoutData, internalEdges: Edge[]): void {
  const parents = new Map(data.nodes.map((member) => [member.id, member.parentId]));
  expect(arrangeNestedLinearWorkflow(data)).toBe(true);
  expect(nestedLinearWorkflowPorts(data).size).toBe(data.edges.length);
  assertContained(data);
  routeStressAndGridEdges(data, 180);
  const result = validateLayout(data);
  expect(result.ok, JSON.stringify(result.issues)).toBe(true);
  expect(result.breakdown.crossings).toBe(0);
  expect(result.issues.filter((issue) => issue.type.startsWith('edge-label'))).toEqual([]);
  expect(
    data.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
  ).toBe(true);
  for (const member of data.nodes) {
    expect(member.parentId).toBe(parents.get(member.id));
  }
  for (const edge of internalEdges) {
    const source = node(data, edge.start!);
    const target = node(data, edge.end!);
    expect(edge.points).toEqual([
      { x: source.x!, y: source.y! + source.height! / 2 },
      { x: target.x!, y: target.y! - target.height! / 2 },
    ]);
    if (edge.label) {
      expect(
        target.y! - target.height! / 2 - source.y! - source.height! / 2
      ).toBeGreaterThanOrEqual(edge.height! + 28);
    }
  }
}

describe('local framed linear workflow placement', () => {
  it('restores geometry before propagating a failed proposal calculation', () => {
    const data = workflow(3);
    data.edges[0].label = 'Measured caption';
    const before = structuredClone(data);
    const branch = node(data, 'branch0');
    const initialX = branch.x;
    const failure = new Error('caption calculation failed after placement');
    const spy = vi.spyOn(captionGeometry, 'captionDimensions').mockImplementation(() => {
      expect(branch.x).not.toBe(initialX);
      throw failure;
    });
    try {
      expect(() => arrangeNestedLinearWorkflow(data)).toThrow(failure);
      expect(data).toStrictEqual(before);
    } finally {
      spy.mockRestore();
    }
  });

  it.each([3, 4])('arranges a private fork/merge with %i branches', (branchCount) => {
    const data = workflow(branchCount);
    if (branchCount === 4) {
      node(data, 'source').width = node(data, 'merge').width = 120;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const branches = data.nodes.filter((member) => member.id.startsWith('branch'));
    expect(new Set(branches.map((branch) => branch.y)).size).toBe(1);
    const left = Math.min(...branches.map((branch) => branch.x! - branch.width! / 2));
    const right = Math.max(...branches.map((branch) => branch.x! + branch.width! / 2));
    expect((left + right) / 2).toBeCloseTo(node(data, 'source').x!);
    expect(node(data, 'merge').x).toBeCloseTo(node(data, 'source').x!);
    for (let index = 1; index < branches.length; index++) {
      const previous = branches[index - 1];
      expect(branches[index].x! - branches[index].width! / 2).toBeGreaterThanOrEqual(
        previous.x! + previous.width! / 2 + 20
      );
    }
    assertContained(data);
  });

  it('arranges a local workflow in a shared wrapper without moving an unrelated sibling', () => {
    const data = workflow(3);
    wrapWithUnrelatedSibling(data);
    const before = structuredClone(
      data.nodes.filter((member) => member.id.startsWith('other') || member.id === 'unrelated')
    );
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(
      data.nodes.filter((member) => member.id.startsWith('other') || member.id === 'unrelated')
    ).toEqual(before);
    assertContained(data);
  });

  it('ignores explicit constraints belonging only to an unrelated sibling', () => {
    const data = workflow(3);
    wrapWithUnrelatedSibling(data);
    node(data, 'unrelated').dir = 'LR';
    const unrelatedEdge = data.edges.at(-1)!;
    unrelatedEdge.startSide = 'bottom';
    unrelatedEdge.endSide = 'top';
    unrelatedEdge.minlen = 3;
    const before = structuredClone(unrelatedEdge);
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(unrelatedEdge).toEqual(before);
    expect(node(data, 'unrelated').dir).toBe('LR');
  });

  it.each(['fork', 'merge', 'update tail'])('reserves measured %s captions', (part) => {
    const data = workflow(3);
    const edges = data.edges.filter((edge) =>
      part === 'fork'
        ? edge.start === 'source'
        : part === 'merge'
          ? edge.end === 'merge'
          : edge.start === 'update'
    );
    for (const edge of edges) {
      edge.label = 'Measured caption<br/>on two lines';
      edge.width = 160;
      edge.height = 60;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    for (const edge of edges) {
      const source = node(data, edge.start!);
      const target = node(data, edge.end!);
      const gap = target.y! - target.height! / 2 - source.y! - source.height! / 2;
      expect(gap).toBeGreaterThanOrEqual(edge.height! + 28);
    }
    assertContained(data);
  });

  it('is idempotent without converting inferred ports to public constraints', () => {
    const data = workflow();
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(
      data.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
    ).toBe(true);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(data).toEqual(before);
  });

  it('is translation equivariant', () => {
    const data = workflow(3);
    const translated = structuredClone(data);
    for (const member of translated.nodes) {
      member.x! += 360;
      member.y! -= 240;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(arrangeNestedLinearWorkflow(translated)).toBe(true);
    for (const member of data.nodes) {
      expect(node(translated, member.id).x).toBeCloseTo(member.x! + 360);
      expect(node(translated, member.id).y).toBeCloseTo(member.y! - 240);
      expect(node(translated, member.id).width).toBe(member.width);
      expect(node(translated, member.id).height).toBe(member.height);
    }
  });

  it.each(['start port', 'end port', 'minlen', 'direction', 'wrapper direction', 'external link'])(
    'rejects an affected %s constraint atomically',
    (kind) => {
      const data = workflow(3);
      if (kind === 'start port') {
        data.edges[0].startSide = 'top';
      } else if (kind === 'end port') {
        data.edges[0].endSide = 'left';
      } else if (kind === 'minlen') {
        data.edges[0].minlen = 3;
      } else if (kind === 'direction') {
        node(data, 'handler').dir = 'LR';
      } else if (kind === 'wrapper direction') {
        wrapWithUnrelatedSibling(data);
        node(data, 'context').dir = 'LR';
      } else {
        data.nodes.push({ ...node(data, 'terminal'), id: 'outsider', x: 2000, y: 900 });
        data.edges.push({ ...data.edges[0], id: 'external', start: 'source', end: 'outsider' });
      }
      const before = structuredClone(data);
      expect(arrangeNestedLinearWorkflow(data)).toBe(false);
      expect(data).toEqual(before);
    }
  );

  it.each([NaN, Infinity, -1])('rejects an invalid measured node width: %s', (width) => {
    const data = workflow();
    node(data, 'key').width = width;
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it.each([NaN, Infinity, -1])('rejects an invalid measured frame title: %s', (height) => {
    const data = workflow();
    node(data, 'nested').labelBBox = { width: 100, height };
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it.each([
    ['x', NaN],
    ['x', Infinity],
    ['y', NaN],
    ['y', Infinity],
  ] as const)('rejects an invalid node coordinate: %s = %s', (axis, coordinate) => {
    const data = workflow();
    node(data, 'key')[axis] = coordinate;
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it.each([
    ['width', NaN],
    ['width', Infinity],
    ['width', -1],
    ['height', NaN],
    ['height', Infinity],
    ['height', -1],
  ] as const)('rejects an invalid caption measurement: %s = %s', (dimension, size) => {
    const data = workflow();
    data.edges[0].label = 'Measured caption';
    data.edges[0][dimension] = size;
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('rejects a genuine ancestor cycle without changing the workflow', () => {
    const data = workflow(3);
    wrapWithUnrelatedSibling(data);
    node(data, 'context').parentId = 'context';
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('rejects a missing context parent without changing the workflow', () => {
    const data = workflow(3);
    wrapWithUnrelatedSibling(data);
    node(data, 'context').parentId = 'missing';
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('rejects a foreign node occupying a measured merge caption', () => {
    const data = workflow(3);
    for (const edge of data.edges.filter((edge) => edge.end === 'merge')) {
      edge.label = 'Merge';
      edge.width = edge.height = 160;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const handlerBottom = node(data, 'handler').y! + node(data, 'handler').height! / 2;
    const mergeTop = node(data, 'merge').y! - node(data, 'merge').height! / 2;
    foreignNode(data, node(data, 'branch0').x!, (handlerBottom + mergeTop) / 2);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('does not infer forced ports or routes after an obstructed aligned placement rolls back', () => {
    const data = workflow(3);
    for (const edge of data.edges.filter((edge) => edge.start === 'source')) {
      edge.label = 'Fork';
      edge.width = edge.height = 160;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const middle = node(data, 'branch1');
    const sourceBottom = node(data, 'source').y! + node(data, 'source').height! / 2;
    const branchTop = middle.y! - middle.height! / 2;
    foreignNode(data, middle.x!, (sourceBottom + 20 + branchTop) / 2);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
    expect(nestedLinearWorkflowPorts(data).has('source-branch1')).toBe(false);
    expect(nestedLinearWorkflowRoutes(data, boundaryPorts(data)).has('source-branch1')).toBe(false);
  });

  it('rejects a foreign node occupying the off-path area of a measured tail caption', () => {
    const data = workflow(3);
    const tail = data.edges.find((edge) => edge.start === 'update')!;
    tail.label = 'Tail';
    tail.width = 300;
    tail.height = 120;
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const storeBottom = node(data, 'store').y! + node(data, 'store').height! / 2;
    const terminalTop = node(data, 'terminal').y! - node(data, 'terminal').height! / 2;
    foreignNode(data, node(data, 'update').x! + 100, (storeBottom + terminalTop) / 2);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('rejects four branches when 80px fan nodes cannot retain proportional corner insets', () => {
    const data = workflow(4);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });

  it('routes an adequately wide four-branch fan without shared subpaths or near-corner ports', () => {
    const data = workflow(4);
    node(data, 'source').width = node(data, 'merge').width = 120;
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    expect(
      validateLayout(data).issues.filter((issue) =>
        ['edge-shared-subpath', 'port-near-corner', 'edge-corner-connection'].includes(issue.type)
      )
    ).toEqual([]);
  });

  it('routes an asymmetric four-branch caption fan without crossings or shared subpaths', () => {
    const data = workflow(4);
    node(data, 'source').width = node(data, 'merge').width = 120;
    const widths = [40, 40, 40, 1000];
    data.edges
      .filter((edge) => edge.start === 'source')
      .forEach((edge, index) => {
        edge.label = 'Caption';
        edge.width = widths[index];
        edge.height = 24;
      });
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    routeStressAndGridEdges(data, 180);
    const result = validateLayout(data);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual([]);
  });

  it('uses measured wrapped captions instead of reserving their unwrapped character width', () => {
    const data = workflow(3);
    for (const edge of data.edges.filter((edge) => edge.start === 'source')) {
      edge.label =
        'This verbose caption has a narrow measured width because the renderer wraps its text over several lines, rather than displaying the full character sequence on one line.';
      edge.width = 200;
      edge.height = 168;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(node(data, 'handler').width).toBeLessThan(1000);
    routeStressAndGridEdges(data, 180);
    const result = validateLayout(data);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type.startsWith('edge-label'))).toEqual([]);
  });

  it('keeps an uneven five-branch fan clear of corners or rejects it atomically', () => {
    const data = workflow(5);
    node(data, 'source').width = node(data, 'merge').width = 200;
    [80, 80, 80, 80, 320].forEach((width, index) => {
      node(data, `branch${index}`).width = width;
    });
    const before = structuredClone(data);
    if (!arrangeNestedLinearWorkflow(data)) {
      expect(data).toEqual(before);
      return;
    }
    routeStressAndGridEdges(data, 180);
    const result = validateLayout(data);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(
      result.issues.filter((issue) =>
        ['edge-shared-subpath', 'port-near-corner', 'edge-corner-connection'].includes(issue.type)
      )
    ).toEqual([]);
  });

  it('retains planar routes after the edge array order changes without moving the fan', () => {
    const data = workflow(4);
    node(data, 'source').width = node(data, 'merge').width = 120;
    for (const branch of data.nodes.filter((member) => member.id.startsWith('branch'))) {
      branch.width = 80;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const before = structuredClone(data.nodes);
    [data.edges[1], data.edges[2]] = [data.edges[2], data.edges[1]];
    routeStressAndGridEdges(data, 180);
    expect(data.nodes).toEqual(before);
    const result = validateLayout(data);
    expect(result.ok).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type === 'edge-shared-subpath')).toEqual([]);
  });

  it('reserves a wide merge-only caption without protruding into the outer workflow frame', () => {
    const data = workflow(3);
    for (const edge of data.edges.filter((edge) => edge.end === 'merge')) {
      edge.label = 'Merge';
      edge.width = 1000;
      edge.height = 24;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    const routes = nestedLinearWorkflowRoutes(data, boundaryPorts(data));
    const outer = node(data, 'outer');
    const outerLeft = outer.x! - outer.width! / 2;
    for (const edge of data.edges.filter((edge) => edge.end === 'merge')) {
      const caption = routes.get(edge.id)!.labelPoint!;
      const overlapsVertically =
        caption.y + edge.height! / 2 > outer.y! - outer.height! / 2 &&
        caption.y - edge.height! / 2 < outer.y! + outer.height! / 2;
      if (overlapsVertically) {
        expect(caption.x + edge.width! / 2).toBeLessThanOrEqual(outerLeft - 14);
      }
    }
  });

  it('rolls back a candidate obstructed by a foreign node', () => {
    const data = workflow(3);
    data.nodes.push({
      ...node(data, 'terminal'),
      id: 'obstacle',
      x: 350,
      y: 200,
      width: 1600,
      height: 1600,
    });
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(false);
    expect(data).toEqual(before);
  });
});

describe('private variable-chain compound workflow placement', () => {
  const roles: ChainRole[] = ['entry', 'item', 'key', 'update'];
  const chainCases = roles.flatMap((role) => [2, 3].map((length) => ({ role, length })));

  it.each(chainCases)('aligns a private $role chain of length $length', ({ role, length }) => {
    const data = workflow(3);
    const { internalEdges } = extendPrivateChain(data, role, length);
    assertPrivateChains(data, internalEdges);
  });

  it.each(
    ['nested', 'inner', 'update-frame'].flatMap((frameId) =>
      [1, 2].map((depth) => ({ frameId, depth }))
    )
  )(
    'preserves semantic endpoints through $depth wrappers around $frameId',
    ({ frameId, depth }) => {
      const data = workflow(3);
      const endpoints = data.edges.map((edge) => ({ start: edge.start, end: edge.end }));
      wrapPrivateFrame(data, frameId, depth);
      assertPrivateChains(data, []);
      expect(data.edges.map((edge) => ({ start: edge.start, end: edge.end }))).toEqual(endpoints);
    }
  );

  it.each(['outer', 'nested', 'inner', 'store', 'update-frame'])(
    'includes an isolated measured sibling in %s without losing containment',
    (parentId) => {
      const data = workflow(3);
      const orphan = addPrivateOrphan(data, parentId);
      assertPrivateChains(data, []);
      expect(orphan.parentId).toBe(parentId);
      expect(data.edges.some((edge) => edge.start === orphan.id || edge.end === orphan.id)).toBe(
        false
      );
    }
  );

  it.each(roles)('reserves measured captions on an internal %s chain', (role) => {
    const data = workflow(3);
    const { internalEdges } = extendPrivateChain(data, role, 3);
    for (const edge of internalEdges) {
      edge.label = 'Chain caption<br/>second line';
      edge.width = 160;
      edge.height = 48;
    }
    assertPrivateChains(data, internalEdges);
  });

  it('combines different private chain lengths and wrapper depths', () => {
    const data = workflow(3);
    const internalEdges = [
      ...extendPrivateChain(data, 'entry', 2).internalEdges,
      ...extendPrivateChain(data, 'item', 3).internalEdges,
      ...extendPrivateChain(data, 'key', 3).internalEdges,
      ...extendPrivateChain(data, 'update', 2).internalEdges,
    ];
    wrapPrivateFrame(data, 'nested', 1);
    wrapPrivateFrame(data, 'inner', 2);
    wrapPrivateFrame(data, 'update-frame', 1);
    assertPrivateChains(data, internalEdges);
  });

  it('is idempotent, translation equivariant, and independent of array order for extended chains', () => {
    const data = workflow(3);
    for (const role of roles) {
      extendPrivateChain(data, role, 3);
    }
    wrapPrivateFrame(data, 'inner', 2);
    const translated = structuredClone(data);
    translated.nodes.reverse();
    translated.edges.reverse();
    for (const member of translated.nodes) {
      member.x! += 360;
      member.y! -= 240;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(arrangeNestedLinearWorkflow(translated)).toBe(true);
    const before = structuredClone(data);
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(data).toEqual(before);
    for (const member of data.nodes) {
      expect(node(translated, member.id).x).toBeCloseTo(member.x! + 360);
      expect(node(translated, member.id).y).toBeCloseTo(member.y! - 240);
      expect(node(translated, member.id).width).toBe(member.width);
      expect(node(translated, member.id).height).toBe(member.height);
    }
  });

  it.each(['port', 'minlen', 'incident', 'branch', 'coordinate', 'chain cycle', 'wrapper cycle'])(
    'rejects a non-private or unsafe extended chain atomically: %s',
    (constraint) => {
      const data = workflow(3);
      const { members, internalEdges } = extendPrivateChain(data, 'key', 3);
      const template = internalEdges[0];
      if (constraint === 'port') {
        template.startSide = 'left';
      } else if (constraint === 'minlen') {
        template.minlen = 3;
      } else if (constraint === 'incident') {
        data.edges.push({ ...template, id: 'incident', start: members[1].id, end: 'terminal' });
      } else if (constraint === 'branch') {
        const orphan = addPrivateOrphan(data, 'inner');
        data.edges.push({ ...template, id: 'branch', start: members[0].id, end: orphan.id });
      } else if (constraint === 'coordinate') {
        members[1].x = Infinity;
      } else if (constraint === 'chain cycle') {
        data.edges.push({
          ...template,
          id: 'chain-cycle',
          start: members.at(-1)!.id,
          end: members[0].id,
        });
      } else {
        const [wrapper] = wrapPrivateFrame(data, 'inner', 1);
        wrapper.parentId = 'inner';
      }
      const before = structuredClone(data);
      expect(arrangeNestedLinearWorkflow(data)).toBe(false);
      expect(data).toEqual(before);
    }
  );
});

describe('private workflow semantic bridge caption reservations', () => {
  const bridges = [
    { start: 'entry', end: 'source' },
    { start: 'merge', end: 'nested' },
    { start: 'inner', end: 'state' },
    { start: 'key', end: 'update' },
  ];
  const cases = bridges.flatMap((bridge) =>
    ['outer', 'nested', 'inner', 'store', 'update-frame'].map((parentId) => ({
      ...bridge,
      parentId,
    }))
  );
  const caption = (data: LayoutData, start: string, end: string): void => {
    const edge = data.edges.find((edge) => edge.start === start && edge.end === end)!;
    edge.label = 'Measured bridge caption<br/>with three lines<br/>and clearance';
    edge.width = 220;
    edge.height = 72;
  };
  const assertRoutedSafely = (data: LayoutData): void => {
    routeStressAndGridEdges(data, 180);
    const result = validateLayout(data);
    expect(result.ok, JSON.stringify(result.issues)).toBe(true);
    expect(result.breakdown.crossings).toBe(0);
    expect(result.issues.filter((issue) => issue.type.startsWith('edge-label'))).toEqual([]);
    assertContained(data);
    expect(
      data.edges.every((edge) => edge.startSide === undefined && edge.endSide === undefined)
    ).toBe(true);
  };

  it('reserves a measured item-to-inner caption without straddling an intermediate wrapper', () => {
    const data = workflow(3);
    wrapPrivateFrame(data, 'inner', 1);
    caption(data, 'item', 'inner');
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    assertRoutedSafely(data);
  });

  it.each([300, 1000])(
    'reserves an unwrapped item-to-inner caption measured %i pixels wide inside its parent',
    (width) => {
      const data = workflow(3);
      caption(data, 'item', 'inner');
      const edge = data.edges.find((edge) => edge.start === 'item' && edge.end === 'inner')!;
      edge.width = width;
      edge.height = 48;
      expect(arrangeNestedLinearWorkflow(data)).toBe(true);
      assertRoutedSafely(data);
    }
  );

  it.each(cases)(
    'reserves $start-to-$end captions with a private orphan in $parentId',
    ({ start, end, parentId }) => {
      const data = workflow(3);
      addPrivateOrphan(data, parentId);
      caption(data, start, end);
      expect(arrangeNestedLinearWorkflow(data)).toBe(true);
      assertRoutedSafely(data);
    }
  );

  it('retains reserved caption routes after frame packing beside a tall private Store note', () => {
    const data = workflow(3);
    const orphan = addPrivateOrphan(data, 'store');
    orphan.width = 40;
    orphan.height = 1000;
    for (const edge of data.edges) {
      edge.label = 'Measured semantic caption<br/>with clearance';
      edge.width = 160;
      edge.height = 48;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    alignSiblingFrameRows(data);
    compactRootFrameBands(data, 50);
    expect(nestedLinearWorkflowPorts(data).size).toBe(data.edges.length);
    assertRoutedSafely(data);
  });

  it('retains distinct semantic bridge rows when group titles have no measured size', () => {
    const data = workflow(2);
    for (const frame of data.nodes.filter((node) => node.isGroup)) {
      frame.labelBBox = undefined;
    }
    expect(arrangeNestedLinearWorkflow(data)).toBe(true);
    expect(nestedLinearWorkflowPorts(data).size).toBe(data.edges.length);
    assertRoutedSafely(data);
  });

  it.each(cases)(
    'safely arranges or atomically rejects $start-to-$end captions beside a tall $parentId note',
    ({ start, end, parentId }) => {
      const data = workflow(3);
      const orphan = addPrivateOrphan(data, parentId);
      orphan.width = 260;
      orphan.height = 720;
      caption(data, start, end);
      const before = structuredClone(data);
      if (!arrangeNestedLinearWorkflow(data)) {
        expect(data).toEqual(before);
        return;
      }
      assertRoutedSafely(data);
    }
  );
});
