import { expect, test, type Page } from '@playwright/test';
import { apiRenderUrl, openURLAndVerifyRendering } from '../../helpers/util.ts';

/**
 * Fixed layout: every node is drawn at the size given in `positions`, and the label has to
 * sit centred inside that box. The sizes bracket `flowchart.minNodeWidth` (120): A and C
 * are narrower than it, B is wider. Until the minimum learned to yield to a pinned width
 * it widened the label box of A and C to 120px, which pushed their text left of centre and
 * out through the border of the 50px node.
 */
const diagram = `flowchart LR
  A["small"]
  B["big"]
  C["narrow and tall"]
`;

const positions = {
  nodes: {
    A: { x: -400, y: 10, width: 100, height: 50 },
    B: { x: 0, y: 10, width: 300, height: 200 },
    C: { x: 400, y: 10, width: 50, height: 200 },
  },
  edges: {},
};

interface Box {
  left: number;
  right: number;
  width: number;
  centerX: number;
}

interface NodeGeometry {
  id: string;
  rect: Box;
  label: Box;
}

const measureNodes = (page: Page, ids: string[]) =>
  page.evaluate((ids: string[]): NodeGeometry[] => {
    const box = (el: Element): Box => {
      const { left, right, width } = el.getBoundingClientRect();
      return { left, right, width, centerX: left + width / 2 };
    };
    return ids.map((id) => {
      const node = document.querySelector(`g.node[id*="flowchart-${id}-"]`);
      if (!node) {
        throw new Error(`node ${id} not rendered`);
      }
      const rect = node.querySelector('.label-container');
      // HTML labels measure the inner div; SVG labels the <text> element.
      const label =
        node.querySelector('.label foreignObject div') ?? node.querySelector('.label text');
      if (!rect || !label) {
        throw new Error(`node ${id} has no rect or label`);
      }
      return { id, rect: box(rect), label: box(label) };
    });
  }, ids);

test.describe('flowchart fixed layout', () => {
  for (const htmlLabels of [true, false]) {
    test(`keeps labels centred inside pinned node widths (htmlLabels: ${htmlLabels})`, async ({
      page,
    }, testInfo) => {
      const options = { look: 'neo', theme: 'neo', layout: 'fixed', htmlLabels } as const;
      await openURLAndVerifyRendering(
        page,
        testInfo,
        apiRenderUrl(diagram, { ...options }, positions),
        { ...options }
      );

      const nodes = await measureNodes(page, Object.keys(positions.nodes));
      for (const { id, rect, label } of nodes) {
        const pinned = positions.nodes[id as keyof typeof positions.nodes];
        expect(rect.width, `${id}: rect width`).toBeCloseTo(pinned.width, 0);
        expect(
          Math.abs(label.centerX - rect.centerX),
          `${id}: label centre vs rect centre`
        ).toBeLessThanOrEqual(1);
        expect(label.left, `${id}: label left edge`).toBeGreaterThanOrEqual(rect.left - 1);
        expect(label.right, `${id}: label right edge`).toBeLessThanOrEqual(rect.right + 1);
      }
    });
  }

  test('still widens unpinned nodes to minNodeWidth under dagre', async ({ page }, testInfo) => {
    const options = { look: 'neo', theme: 'neo', htmlLabels: true } as const;
    await openURLAndVerifyRendering(
      page,
      testInfo,
      apiRenderUrl('flowchart LR\n  A["small"]\n', { ...options }),
      { ...options }
    );
    const [a] = await measureNodes(page, ['A']);
    // 120px minimum label box plus the neo look's 16px padding on each side.
    expect(a.rect.width).toBeGreaterThanOrEqual(120 + 16 * 2 - 1);
    expect(Math.abs(a.label.centerX - a.rect.centerX)).toBeLessThanOrEqual(1);
  });
});
