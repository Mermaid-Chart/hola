import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { verifyScreenshot } from '../helpers/util.ts';

test.describe('native screenshot scaling', () => {
  test.use({ viewport: { width: 200, height: 150 }, deviceScaleFactor: 2 });

  for (const hasSvg of [true, false]) {
    test(`capture and comparison use device pixels (SVG: ${hasSvg})`, async ({
      page,
    }, testInfo) => {
      await page.setContent(
        '<style>body { margin: 0; }</style>' +
          (hasSvg
            ? '<svg aria-roledescription="test" width="60" height="40"><rect width="60" height="40" fill="blue" /></svg>'
            : '<div style="width: 60px; height: 40px; background: blue"></div>')
      );
      // These disposable baselines exercise the creation and comparison paths
      // without rewriting any checked-in visual reference.
      const name = `scaling-${randomUUID()}`;
      const path = testInfo.snapshotPath(`${name}.png`, { kind: 'screenshot' });
      expect(existsSync(path)).toBe(false);
      const previousAppli = process.env.USE_APPLI;
      const previousVisual = process.env.RUN_VISUAL_TEST;
      delete process.env.USE_APPLI;
      process.env.RUN_VISUAL_TEST = 'false';

      try {
        await verifyScreenshot(page, testInfo, name);
        const png = readFileSync(path);
        // PNG header width/height: both targets must retain the configured 2x DPI.
        expect(png.readUInt32BE(16)).toBe(hasSvg ? 120 : 400);
        expect(png.readUInt32BE(20)).toBe(hasSvg ? 80 : 300);
        await verifyScreenshot(page, testInfo, name);
      } finally {
        if (existsSync(path)) {
          unlinkSync(path);
        }
        if (previousAppli === undefined) {
          delete process.env.USE_APPLI;
        } else {
          process.env.USE_APPLI = previousAppli;
        }
        if (previousVisual === undefined) {
          delete process.env.RUN_VISUAL_TEST;
        } else {
          process.env.RUN_VISUAL_TEST = previousVisual;
        }
      }
    });
  }
});
