import { imgSnapshotTest } from '../../helpers/util.ts';
describe('Sequence diagram theme, look', () => {
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
      it(`should render a sequencediagram using look: ${look}, theme:${theme}, layout: dagre`, () => {
        imgSnapshotTest(
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
