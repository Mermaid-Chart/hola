import { JSDOM } from 'jsdom';
import { select } from 'd3';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MermaidConfig } from '../../../config.type.js';
import type { Node } from '../../types.js';

const config: MermaidConfig = {};

vi.mock('../../../diagram-api/diagramAPI.js', () => ({
  getConfig: vi.fn(() => config),
}));

vi.mock('../../createText.js', () => ({
  // The real one measures text; here we only need an element back, and a record of the
  // wrap width it was asked for.
  createText: vi.fn((parent: { node: () => Element }, text: string) => {
    const section = parent.node();
    const el = section.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'text');
    el.textContent = text;
    section.append(el);
    return Promise.resolve(el);
  }),
}));

const setupParent = () => {
  const dom = new JSDOM('<html lang="en"><body></body></html>');
  const { document } = dom.window;
  // c4LabelHelper measures each section to stack them; the geometry is irrelevant here.
  dom.window.Element.prototype.getBBox = () => ({ x: 0, y: 0, width: 10, height: 10 }) as DOMRect;
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  document.body.append(svg);
  return select(svg);
};

/** The wrap width `c4LabelHelper` asked `createText` for, per section. */
const requestedWidths = async () => {
  const { createText } = await import('../../createText.js');
  return vi.mocked(createText).mock.calls.map(([, , options]) => options?.width);
};

const c4Node = (overrides: Partial<Node> = {}): Node =>
  ({
    id: 'n',
    label: 'Banking Customer A',
    stereotype: '[Person]',
    description: ['A customer of the bank.'],
    width: 216,
    padding: 20,
    ...overrides,
  }) as Node;

describe('c4LabelHelper', () => {
  beforeEach(async () => {
    vi.mocked(await import('../../createText.js')).createText.mockClear();
    for (const key of Object.keys(config)) {
      delete config[key as keyof MermaidConfig];
    }
  });

  it('wraps to the padded node width by default', async () => {
    const { c4LabelHelper } = await import('./c4LabelHelper.js');

    // `c4.wrap` defaults to true in the schema, so an absent value must not read as "off".
    await c4LabelHelper(setupParent(), c4Node());

    // 216 outer - 2 * 20 padding.
    expect(await requestedWidths()).toEqual([176, 176, 176]);
  });

  it('wraps a node that sizes itself from the label, not just one with a pinned width', async () => {
    const { c4LabelHelper } = await import('./c4LabelHelper.js');

    // The person shape passes node.width straight through and never sets wrappingWidth;
    // it has to reach the same wrap width as the rect shapes, which pin it.
    await c4LabelHelper(setupParent(), c4Node({ wrappingWidth: undefined }));

    expect(await requestedWidths()).toEqual([176, 176, 176]);
  });

  it('prefers an explicit wrappingWidth over deriving one from node.width', async () => {
    const { c4LabelHelper } = await import('./c4LabelHelper.js');

    // drawRect hands the label box over directly, having already taken the padding off.
    await c4LabelHelper(setupParent(), c4Node({ wrappingWidth: 176, width: undefined }));

    expect(await requestedWidths()).toEqual([176, 176, 176]);
  });

  it('stops wrapping when c4.wrap is turned off', async () => {
    config.c4 = { wrap: false };
    const { c4LabelHelper } = await import('./c4LabelHelper.js');

    await c4LabelHelper(setupParent(), c4Node());

    expect(await requestedWidths()).toEqual([
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
      Number.POSITIVE_INFINITY,
    ]);
  });

  it('still wraps a pinned width when c4.wrap is off, so the label cannot spill out', async () => {
    config.c4 = { wrap: false };
    const { c4LabelHelper } = await import('./c4LabelHelper.js');

    await c4LabelHelper(setupParent(), c4Node({ wrappingWidth: 176, width: undefined }));

    expect(await requestedWidths()).toEqual([176, 176, 176]);
  });
});
