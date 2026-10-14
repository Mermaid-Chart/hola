import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import type { LayoutData } from '../../packages/mermaid/src/rendering-util/types.js';
import { mermaidUrl } from '../helpers/util.js';

const diagram = readFileSync(
  new URL('../platform/dev-diagrams/test-dataset/MESSY windrose fixed.mmd', import.meta.url),
  'utf8'
);

const cases = [
  { name: 'TB', source: diagram },
  {
    name: 'unequal labels',
    source: diagram.replace('    NW\n', '    NW[North west with a longer label]\n'),
  },
];

for (const { name, source } of cases) {
  test(`HOLA settles grouped windrose nodes onto common grid lines: ${name}`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      (window as unknown as { mermaidCaptureValidation: boolean }).mermaidCaptureValidation = true;
    });
    await page.goto(
      mermaidUrl(source, { layout: 'hola', look: 'classic', theme: 'default' }, false)
    );
    await page.waitForFunction(
      () => (window as unknown as { rendered: boolean }).rendered === true
    );
    const captured = await page.evaluate(() => {
      const capture = window as unknown as {
        mermaidLastLayoutCapture: { layout: LayoutData };
        mermaidValidateLastLayout: () => {
          ok: boolean;
          score: number;
          issues: { type: string }[];
          breakdown: { crossings: number };
        };
      };
      return {
        layout: capture.mermaidLastLayoutCapture.layout,
        validation: capture.mermaidValidateLastLayout(),
      };
    });
    writeFileSync(testInfo.outputPath('layout.json'), JSON.stringify(captured, null, 2));
    await testInfo.attach('layout', {
      body: JSON.stringify(captured, null, 2),
      contentType: 'application/json',
    });
    await page.locator('svg').screenshot({ path: testInfo.outputPath('windrose.png') });
    const node = (id: string) => captured.layout.nodes.find((member) => member.id === id)!;
    expect(captured.layout.nodes.filter((member) => member.isGroup)).toHaveLength(2);
    if (name === 'TB') {
      expect(node('SW').x).toBeCloseTo(node('C').x!, 6);
      expect(node('NW').y).toBeCloseTo(node('SW').y!, 6);
      expect(node('SW').y).toBeCloseTo(node('SE').y!, 6);
      expect(node('NW').y).toBeCloseTo(node('NE').y!, 6);
      expect(captured.validation.score).toBeGreaterThan(950);
    }
    for (const [a, b] of [
      ['SW', 'SE'],
      ['NW', 'NE'],
    ]) {
      expect(
        Math.min(Math.abs(node(a).x! - node(b).x!), Math.abs(node(a).y! - node(b).y!))
      ).toBeCloseTo(0, 6);
    }
    expect(captured.validation.breakdown.crossings).toBe(0);
    expect(captured.validation.ok, JSON.stringify(captured.validation.issues)).toBe(true);
    expect(
      captured.validation.issues.filter((issue) => issue.type === 'grid-misalignment')
    ).toEqual([]);
  });
}
