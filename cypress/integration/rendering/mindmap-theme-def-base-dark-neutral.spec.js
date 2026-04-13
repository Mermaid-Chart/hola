import { imgSnapshotTest } from '../../helpers/util.ts';

describe('Mindmap', () => {
  [
    'default',
    'base',
    'dark',
    'neutral',
    'neo',
    'neo-dark',
    'redux',
    'redux-dark',
    'redux-color',
    'redux-dark-color',
  ].forEach((theme) => {
    describe(theme, () => {
      it('should render a Mindmap', () => {
        imgSnapshotTest(
          `
        mindmap
          root((mindmap))
            Origins
              Long history
              ::icon(fa fa-bell)
              Popularization
                British popular psychology author Tony Buzan
            Research
              On effectiveness<br/>and features
              On Automatic creation
                Uses
                    Creative techniques
                    Strategic planning
                    Argument mapping
            Tools
              Pen and paper
              Mermaid
          `,
          { theme }
        );
      });
    });
  });
});
