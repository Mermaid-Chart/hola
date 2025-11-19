import { imgSnapshotTest } from '../../helpers/util.ts';
describe('StateDiagram theme, look and layout', () => {
  ['neo', 'handDrawn', 'classic'].forEach((look) => {
    [
      'mc',
      'neo',
      'dark',
      'neo-dark',
      'default',
      'forest',
      'base',
      'neutral',
      'redux',
      'redux-dark',
    ].forEach((theme) => {
      ['dagre', 'elk'].forEach((layout) => {
        it(`should render a state diagram using look: ${look}, theme:${theme}, layout: ${layout}`, () => {
          imgSnapshotTest(
            `
            stateDiagram
              [*] --> Still
              Still --> [*]

              Still --> Moving
              Moving --> Still
              Moving --> Crash
              Crash --> [*]
      `,
            { logLevel: 1, htmlLabels: true, look: look, theme, layout: layout }
          );
        });
      });
    });
  });
});
