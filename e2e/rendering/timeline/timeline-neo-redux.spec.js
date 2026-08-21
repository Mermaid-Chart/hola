import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';

test.describe('Timeline', () => {
  ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'].forEach((theme) => {
    test.describe(theme, () => {
      test('should render a Timeline Diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
        timeline
          title MermaidChart 2023 Timeline
          section 2023 Q1 <br> Release Personal Tier
            Bullet 1 : sub-point 1a : sub-point 1b
                : sub-point 1c
            Bullet 2 : sub-point 2a : sub-point 2b
          section 2023 Q2 <br> Release XYZ Tier
            Bullet 3 : sub-point <br> 3a : sub-point 3b
                : sub-point 3c
            Bullet 4 : sub-point 4a : sub-point 4b
          `,
          { theme }
        );
      });
    });
  });
});
