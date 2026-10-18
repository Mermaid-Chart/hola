import { describe, expect, it } from 'vitest';
import type { LayoutData, Node } from '../../types.js';
import { alignSiblingFrameRows, compactRootFrameBands } from './frameGrid.js';

function frame(id: string, x: number, y = 100): Node {
  return { id, x, y, width: 160, height: 160, shape: 'rect', isGroup: true } as Node;
}

describe('gipsec sibling frame spacing', () => {
  it('moves entire nested frame trees and preserves internal offsets', () => {
    const a = frame('a', 80);
    const b = frame('b', 400, 120);
    const c = frame('c', 720, 105);
    const inner = { ...frame('inner', 400, 140), width: 80, height: 80, parentId: b.id } as Node;
    const leaf = {
      ...frame('leaf', 410, 150),
      width: 30,
      height: 30,
      parentId: inner.id,
      isGroup: false,
    } as Node;
    const data = { nodes: [c, leaf, b, inner, a], edges: [] } as unknown as LayoutData;
    alignSiblingFrameRows(data);
    expect(b.x! - b.width! / 2 - (a.x! + a.width! / 2)).toBeCloseTo(
      c.x! - c.width! / 2 - (b.x! + b.width! / 2)
    );
    expect([a.y, b.y, c.y]).toEqual([100, 100, 100]);
    expect(inner.x! - b.x!).toBe(0);
    expect(inner.y! - b.y!).toBe(20);
    expect(leaf.x! - inner.x!).toBe(10);
    expect(leaf.y! - inner.y!).toBe(10);
  });

  it('rolls back the whole row when equal spacing would overlap an unrelated node', () => {
    const nodes = [
      frame('a', 80),
      frame('b', 400),
      frame('c', 720),
      { ...frame('obstacle', 260), width: 20, height: 20, isGroup: false } as Node,
    ];
    const before = nodes.map((node) => ({ ...node }));
    alignSiblingFrameRows({ nodes, edges: [] } as unknown as LayoutData);
    expect(nodes).toEqual(before);
  });

  it('reserves the widest measured label in every inter-frame gap', () => {
    const nodes = [frame('a', 80), frame('b', 400), frame('c', 720)];
    const data = {
      nodes,
      edges: [{ id: 'label', start: 'a', end: 'b', label: 'Wide label', width: 200 }],
    } as unknown as LayoutData;
    alignSiblingFrameRows(data);
    const gaps = nodes
      .slice(1)
      .map(
        (node, index) => node.x! - node.width! / 2 - (nodes[index].x! + nodes[index].width! / 2)
      );
    expect(gaps[0]).toBeGreaterThanOrEqual(264);
    expect(gaps[1]).toBeCloseTo(gaps[0]);
  });

  it('moves a private aligned root terminal with its source frame row', () => {
    const a = frame('a', 80);
    const b = { ...frame('b', 500, 140), width: 240, height: 200 } as Node;
    const c = { ...frame('c', 1000, 110), width: 120, height: 140 } as Node;
    const source = {
      ...frame('source', 1000, 130),
      width: 40,
      height: 40,
      isGroup: false,
      parentId: c.id,
    } as Node;
    const terminal = {
      ...frame('terminal', 1000, 300),
      width: 40,
      height: 40,
      isGroup: false,
    } as Node;
    const data = {
      nodes: [a, b, c, source, terminal],
      edges: [{ id: 'tail', start: source.id, end: terminal.id, type: 'arrow' }],
    } as unknown as LayoutData;
    const before = data.nodes.map((member) => ({ ...member }));
    alignSiblingFrameRows(data);
    expect(c.x).not.toBe(before[2].x);
    expect(terminal.x! - before[4].x!).toBe(c.x! - before[2].x!);
    expect(terminal.y! - before[4].y!).toBe(c.y! - before[2].y!);
    expect(source.x).toBe(terminal.x);
    expect(terminal.y! - source.y!).toBe(before[4].y! - before[3].y!);
  });

  it('rolls back the frame row when moving its root terminal would hit an outsider', () => {
    const a = frame('a', 80);
    const b = { ...frame('b', 500, 140), width: 240, height: 200 } as Node;
    const c = { ...frame('c', 1000, 110), width: 120, height: 140 } as Node;
    const source = {
      ...frame('source', 1000, 130),
      width: 40,
      height: 40,
      isGroup: false,
      parentId: c.id,
    } as Node;
    const terminal = {
      ...frame('terminal', 1000, 300),
      width: 40,
      height: 40,
      isGroup: false,
    } as Node;
    // The proposed row positions c at x=588, y=90. Its companion terminal
    // would land on this outsider, while the frame itself remains clear.
    const outsider = {
      ...frame('outsider', 588, 280),
      width: 40,
      height: 40,
      isGroup: false,
    } as Node;
    const data = {
      nodes: [a, b, c, source, terminal, outsider],
      edges: [{ id: 'tail', start: source.id, end: terminal.id, type: 'arrow' }],
    } as unknown as LayoutData;
    const before = structuredClone(data);
    alignSiblingFrameRows(data);
    expect(data).toEqual(before);
  });

  it.each(['node', 'frame'] as const)(
    'preserves aligned %s bridges while spacing different frame tops',
    (endpoint) => {
      const a = frame('a', 80, 100);
      const b = { ...frame('b', 500, 120), height: 200 } as Node;
      const c = frame('c', 1000, 105);
      const leaves = [a, b, c].map(
        (owner, index) =>
          ({
            ...frame(`stage-${index}`, owner.x!, 100),
            width: 40,
            height: 40,
            parentId: owner.id,
            isGroup: index === 0 && endpoint === 'frame',
          }) as Node
      );
      const data = {
        nodes: [a, b, c, ...leaves],
        edges: [
          { id: 'first', start: leaves[0].id, end: leaves[1].id },
          { id: 'second', start: leaves[1].id, end: leaves[2].id },
        ],
      } as unknown as LayoutData;
      alignSiblingFrameRows(data);
      expect(leaves[0].y).toBe(leaves[1].y);
      expect(leaves[1].y).toBe(leaves[2].y);
      expect(b.x! - b.width! / 2 - a.x! - a.width! / 2).toBeCloseTo(
        c.x! - c.width! / 2 - b.x! - b.width! / 2
      );
      expect(leaves.map((leaf) => leaf.parentId)).toEqual(['a', 'b', 'c']);
    }
  );
});

describe('gipsec empty root-frame bands', () => {
  it('compacts several vacant bands while translating entire nested subtrees', () => {
    const a = frame('a', 80);
    const b = frame('b', 80, 600);
    const c = frame('c', 80, 1100);
    const inner = { ...frame('inner', 80, 620), width: 80, height: 80, parentId: b.id } as Node;
    const leaf = {
      ...frame('leaf', 90, 630),
      width: 30,
      height: 30,
      isGroup: false,
      parentId: inner.id,
    } as Node;
    const data = { nodes: [leaf, c, inner, b, a], edges: [] } as unknown as LayoutData;
    compactRootFrameBands(data, 50);
    expect([a.y, b.y, c.y]).toEqual([100, 324, 548]);
    expect(inner.y! - b.y!).toBe(20);
    expect(leaf.y! - inner.y!).toBe(10);
    expect(leaf.parentId).toBe(inner.id);
    expect(inner.parentId).toBe(b.id);
    expect(leaf.x).toBe(90);
  });

  it('treats vertically overlapping root boxes as one occupied band', () => {
    const a = frame('a', 80);
    const b = frame('b', 300, 220);
    const leaf = { ...frame('leaf', 600, 600), isGroup: false } as Node;
    compactRootFrameBands({ nodes: [a, b, leaf], edges: [] } as unknown as LayoutData, 50);
    expect([a.y, b.y, leaf.y]).toEqual([100, 220, 444]);
  });

  it('does not collapse an internal gap inside a containing frame', () => {
    const outer = { ...frame('outer', 100, 400), height: 800 } as Node;
    const a = { ...frame('a', 100, 100), parentId: outer.id } as Node;
    const b = { ...frame('b', 100, 700), parentId: outer.id } as Node;
    const nodes = [outer, a, b];
    const before = nodes.map((node) => ({ ...node }));
    compactRootFrameBands({ nodes, edges: [] } as unknown as LayoutData, 50);
    expect(nodes).toEqual(before);
  });

  it('reserves measured caption heights and configured rank spacing', () => {
    const a = frame('a', 80);
    const b = frame('b', 80, 600);
    const data = {
      nodes: [a, b],
      edges: [{ id: 'caption', start: a.id, end: b.id, label: 'Tall caption', height: 160 }],
    } as unknown as LayoutData;
    compactRootFrameBands(data, 180);
    expect(b.y! - b.height! / 2 - (a.y! + a.height! / 2)).toBe(212);
  });

  it('preserves the wider corridor for member-to-member frame bridges', () => {
    const a = frame('a', 80);
    const b = frame('b', 80, 600);
    const source = {
      ...frame('source', 80),
      isGroup: false,
      width: 40,
      height: 40,
      parentId: a.id,
    } as Node;
    const target = {
      ...frame('target', 80, 600),
      isGroup: false,
      width: 40,
      height: 40,
      parentId: b.id,
    } as Node;
    const data = {
      nodes: [a, b, source, target],
      edges: [{ id: 'bridge', start: source.id, end: target.id }],
    } as unknown as LayoutData;
    compactRootFrameBands(data, 50);
    expect(b.y! - b.height! / 2 - (a.y! + a.height! / 2)).toBe(96);
    expect(target.y).toBe(b.y);
  });

  it.each(['minlen', 'startSide', 'endSide'] as const)(
    'retains the solved corridor for a crossing edge with %s',
    (constraint) => {
      const nodes = [frame('a', 80), frame('b', 80, 600)];
      const edge = {
        id: 'constrained',
        start: 'a',
        end: 'b',
        [constraint]: constraint === 'minlen' ? 3 : 'right',
      };
      compactRootFrameBands({ nodes, edges: [edge] } as unknown as LayoutData, 50);
      expect(nodes[1].y).toBe(600);
    }
  );
});
