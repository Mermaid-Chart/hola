import { imgSnapshotTest } from '../../helpers/util.ts';

describe('Requirement diagram', () => {
  ['neo', 'neo-dark', 'redux', 'redux-dark', 'redux-color', 'redux-dark-color'].forEach((theme) => {
    describe(theme, () => {
      it('should render a Requirement Diagram', () => {
        imgSnapshotTest(
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
