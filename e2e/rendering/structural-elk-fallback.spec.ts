import { expect, test } from '@playwright/test';
import { mermaidUrl } from '../helpers/util.js';

/**
 * The structural pre-check decides which layout actually runs, so what there is
 * to assert is which one did. `mermaidLastLayoutCapture.layoutAlgorithm` records
 * that, and is the only place the redirect is observable from outside the
 * renderer.
 */

/** K3,3 — the smallest non-planar bipartite graph. 6 nodes, every degree 3. */
const NON_PLANAR = `flowchart LR
  a1 --> b1
  a1 --> b2
  a1 --> b3
  a2 --> b1
  a2 --> b2
  a2 --> b3
  a3 --> b1
  a3 --> b2
  a3 --> b3
`;

/** A path: planar, low-degree, no subgraphs. Nothing for the gate to catch. */
const PLAIN = `flowchart LR
  n0 --> n1 --> n2 --> n3
`;

/** Five subgraphs, one over the limit, but otherwise a trivial graph. */
const MANY_SUBGRAPHS = `flowchart LR
  subgraph s1
    a --> b
  end
  subgraph s2
    c --> d
  end
  subgraph s3
    e --> f
  end
  subgraph s4
    g --> h
  end
  subgraph s5
    i --> j
  end
  b --> c
`;

const cases = [
  { name: 'non-planar K3,3', code: NON_PLANAR, redirected: true },
  { name: 'five subgraphs', code: MANY_SUBGRAPHS, redirected: true },
  { name: 'a plain path', code: PLAIN, redirected: false },
] as const;

for (const layout of ['hola', 'gipsec'] as const) {
  for (const { name, code, redirected } of cases) {
    const expected = redirected ? 'elk' : layout;
    test(`${layout} on ${name} runs ${expected}`, async ({ page }) => {
      await page.addInitScript(() => {
        (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation =
          true;
      });
      await page.goto(mermaidUrl(code, { layout, look: 'classic', theme: 'default' }, false));
      await page.waitForFunction(
        () => (window as unknown as { rendered: boolean }).rendered === true
      );
      const actual = await page.evaluate(
        () =>
          (window as unknown as { mermaidLastLayoutCapture?: { layoutAlgorithm?: string } })
            .mermaidLastLayoutCapture?.layoutAlgorithm
      );
      expect(actual).toBe(expected);
    });
  }
}
