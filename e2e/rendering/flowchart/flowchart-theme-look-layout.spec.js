import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';
test.describe('Flowchart theme, look and layout', () => {
  ['neo', 'handDrawn', 'classic'].forEach((look) => {
    [
      'default',
      'forest',
      'dark',
      'neutral',
      'neo',
      'neo-dark',
      'redux',
      'redux-dark',
      'redux-color',
      'redux-dark-color',
    ].forEach((theme) => {
      ['dagre', 'elk'].forEach((layout) => {
        test(`should render a full flowchart diagram using look: ${look}, theme:${theme}, layout: ${layout}`, async ({
          page,
        }, testInfo) => {
          await imgSnapshotTest(
            page,
            testInfo,
            `
            flowchart TD
            %% Nodes
                A("fab:fa-youtube Starter Guide")
                B("fab:fa-youtube Make Flowchart")
                n1@{ icon: "fa:gem", pos: "b", h: 24}
                C("fa:fa-book-open Learn More")
                D{"Use the editor"}
                n2(Many shapes)@{ shape: delay}
                E(fa:fa-shapes Visual Editor)
                F("fa:fa-chevron-up Add node in toolbar")
                G("fa:fa-comment-dots AI chat")
                H("fa:fa-arrow-left Open AI in side menu")
                I("fa:fa-code Text")
                J(fa:fa-arrow-left Type Mermaid syntax)

            %% Edge connections between nodes
                A --> B --> C --> n1 & D & n2
                D -- Build and Design --> E --> F
                D -- Use AI --> G --> H
                D -- Mermaid js --> I --> J

            %% Individual node styling. Try the visual editor toolbar for easier styling!
                style E color:#FFFFFF, fill:#AA00FF, stroke:#AA00FF
                style G color:#FFFFFF, stroke:#00C853, fill:#00C853
                style I color:#FFFFFF, stroke:#2962FF, fill:#2962FF

            %% You can add notes with two "%" signs in a row!
      `,
            { logLevel: 1, htmlLabels: true, look: look, theme, layout: layout }
          );
        });
      });
    });
  });
});
