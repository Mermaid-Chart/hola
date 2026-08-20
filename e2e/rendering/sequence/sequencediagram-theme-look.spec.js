import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';
test.describe('Sequence diagram theme, look', () => {
  ['neo', 'handDrawn', 'classic'].forEach((look) => {
    [
      'neo',
      'neo-dark',
      'default',
      'forest',
      'base',
      'dark',
      'neutral',
      'redux',
      'redux-dark',
      'redux-color',
      'redux-dark-color',
    ].forEach((theme) => {
      test(`should render a sequencediagram using look: ${look}, theme:${theme}, layout: dagre`, async ({
        page,
      }, testInfo) => {
        await imgSnapshotTest(
          page,
          testInfo,
          `
          sequenceDiagram
            Alice->>+John: Hello John, how are you?
            Alice->>+John: John, can you hear me?
            John-->>-Alice: Hi Alice, I can hear you!
            John-->>-Alice: I feel great!
      `,
          { logLevel: 1, htmlLabels: true, look: look, theme, layout: 'dagre' }
        );
      });
    });
  });
});
