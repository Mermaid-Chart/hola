import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';

test.describe('Requirement diagram', () => {
  ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'].forEach((theme) => {
    test.describe(theme, () => {
      test('should render a Requirement Diagram', async ({ page }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
          requirementDiagram

          requirement test_req {
          id: 1
          text: the test text.
          risk: high
          }

          element test_entity {
          type: simulation
          }

          test_entity - satisfies -> test_req
          `,
          { theme }
        );
      });
    });
  });
});
