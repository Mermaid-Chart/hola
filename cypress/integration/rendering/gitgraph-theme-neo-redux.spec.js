import { imgSnapshotTest } from '../../helpers/util.ts';

describe('Git Graph', () => {
  ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'].forEach((theme) => {
    describe(theme, () => {
      it('should render a git graph', () => {
        imgSnapshotTest(
          `
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
          `,
          { theme }
        );
      });
    });
  });
});
