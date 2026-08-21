import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';

// Alana-only. Upstream's gitGraph-neo-look.spec.js covers these same six themes
// but pins `look: 'neo'`; this exercises them with the default look, so the two
// complement each other rather than overlap.
const themes = ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'];

const diagram = `
gitGraph
  commit id: "ZERO"
  branch develop
  branch release
  commit id:"A"
  checkout main
  commit id:"ONE"
  checkout develop
  commit id:"B"
  checkout main
  merge develop id:"MERGE"
  commit id:"TWO"
  checkout release
  cherry-pick id:"MERGE" parent:"B"
  commit id:"THREE"
  checkout develop
  commit id:"C"

`;

themes.forEach((theme) => {
  test.describe(`Git Graph - ${theme} theme`, () => {
    test('should render a git graph', async ({ page }, testInfo) => {
      await imgSnapshotTest(page, testInfo, diagram, { theme });
    });
  });
});
