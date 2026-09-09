import { JSDOM } from 'jsdom';
import { select } from 'd3';
import { describe, it, expect, vi } from 'vitest';
import type { D3Selection } from '../../../types.js';
import type { Node, RectOptions } from '../../types.js';
import type * as HandDrawnShapeStyles from './handDrawnShapeStyles.js';
import type * as Util from './util.js';

const LABEL_BBOX = { width: 100, height: 50 };

/**
 * What the label helper saw at call time. `drawRect` hands the same node object back to
 * `updateNodeBounds` afterwards, so the sizing fields have to be snapshotted here rather
 * than read off the node once the call has returned.
 */
const measured: { width?: number; wrappingWidth?: number; minWidth?: number }[] = [];

vi.mock('./handDrawnShapeStyles.js', async (importOriginal) => ({
  ...(await importOriginal<typeof HandDrawnShapeStyles>()),
  styles2String: vi.fn().mockReturnValue({ labelStyles: '', nodeStyles: '' }),
}));

vi.mock('./util.js', async (importOriginal) => {
  const actual = await importOriginal<typeof Util>();
  return {
    ...actual,
    // The real label helper needs a full config/theme; the geometry under test only
    // depends on the measured label box, so return a fixed one.
    labelHelper: vi.fn((parent: D3Selection<SVGGElement>, node: Node) => {
      measured.push({
        width: node.width,
        wrappingWidth: node.wrappingWidth,
        minWidth: node.minWidth,
      });
      const shapeSvg = parent.insert('g');
      return Promise.resolve({
        shapeSvg,
        bbox: { ...LABEL_BBOX, x: 0, y: 0 },
        halfPadding: 0,
        label: shapeSvg.insert('g'),
      });
    }),
    getNodeClasses: vi.fn().mockReturnValue(''),
  };
});

const setupParent = () => {
  const dom = new JSDOM('<html lang="en"><body></body></html>');
  const { document } = dom.window;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return select(svg);
};

const options = (): RectOptions =>
  ({
    rx: 5,
    ry: 5,
    classes: '',
    labelPaddingX: 20,
    labelPaddingY: 20,
  }) as RectOptions;

describe('drawRect', () => {
  it('keeps the label-derived height when only a width is supplied', async () => {
    const { drawRect } = await import('./drawRect.js');
    // C4 sizes its elements to a fixed `c4.width` but leaves the height to the label
    // (see c4ShapeAdapter.buildC4Node).
    const node = { id: 'a', label: 'a', width: 216, padding: 20 } as Node;

    await drawRect(setupParent(), node, options());

    expect(node.width).toBe(216);
    expect(node.height).toBe(LABEL_BBOX.height + 20 * 2);
  });

  it('honours an explicit width and height', async () => {
    const { drawRect } = await import('./drawRect.js');
    const node = { id: 'b', label: 'b', width: 216, height: 120, padding: 20 } as Node;

    await drawRect(setupParent(), node, options());

    expect(node.width).toBe(216);
    expect(node.height).toBe(120);
  });

  it('sizes to the label when neither dimension is supplied', async () => {
    const { drawRect } = await import('./drawRect.js');
    const node = { id: 'c', label: 'c', padding: 20 } as Node;

    await drawRect(setupParent(), node, options());

    expect(node.width).toBe(LABEL_BBOX.width + 20 * 2);
    expect(node.height).toBe(LABEL_BBOX.height + 20 * 2);
  });

  it('tells the label to wrap inside a pinned width, without rewriting node.width', async () => {
    const { drawRect } = await import('./drawRect.js');
    const node = { id: 'd', label: 'd', width: 216, padding: 20 } as Node;
    measured.length = 0;

    await drawRect(setupParent(), node, options());

    // The label box is the pinned outer width minus the padding, handed over explicitly so
    // the label helper never has to guess whether node.width is the inner or outer box.
    expect(node.wrappingWidth).toBe(216 - 20 * 2);
    expect(measured.at(-1)).toEqual({ width: undefined, wrappingWidth: 176 });
  });

  it('drops the diagram-level minimum label width when the node width is pinned', async () => {
    const { drawRect } = await import('./drawRect.js');
    // A fixed-layout node sized narrower than `flowchart.minNodeWidth`. The label helper
    // only skips the minimum while `node.width` is set, and drawRect has just cleared it,
    // so the 120px minimum used to leak through and push the label off-centre.
    const node = { id: 'f', label: 'small', width: 50, minWidth: 120, padding: 20 } as Node;
    measured.length = 0;

    await drawRect(setupParent(), node, options());

    expect(measured.at(-1)).toEqual({ width: undefined, wrappingWidth: 10, minWidth: undefined });
    expect(node.width).toBe(50);
  });

  it('keeps the diagram-level minimum label width when no width is pinned', async () => {
    const { drawRect } = await import('./drawRect.js');
    const node = { id: 'g', label: 'small', minWidth: 120, padding: 20 } as Node;
    measured.length = 0;

    await drawRect(setupParent(), node, options());

    expect(measured.at(-1)).toEqual({ width: undefined, wrappingWidth: undefined, minWidth: 120 });
  });

  it('leaves the wrap width alone when no width is pinned', async () => {
    const { drawRect } = await import('./drawRect.js');
    const node = { id: 'e', label: 'e', padding: 20 } as Node;

    await drawRect(setupParent(), node, options());

    expect(node.wrappingWidth).toBeUndefined();
  });
});
