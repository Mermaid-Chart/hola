import { test } from '@playwright/test';
import { imgSnapshotTest } from '../../helpers/util.ts';
test.describe('Class diagram V3 HD', () => {
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
        test(`should render a full class diagram using look: ${look}, theme:${theme}, layout: ${layout}`, async ({
          page,
        }, testInfo) => {
          await imgSnapshotTest(
            page,
            testInfo,
            `
   classDiagram
    Animal <|-- Duck
    Animal <|-- Fish
    Animal <|-- Zebra
    Animal : +int age
    Animal : +String gender
    Animal: +isMammal()
    Animal: +mate()
    class Duck{
      +String beakColor
      +swim()
      +quack()
    }
    class Fish{
      -int sizeInFeet
      -canEat()
    }
    class Zebra{
      +bool is_wild
      +run()
    }
      `,
            { logLevel: 1, htmlLabels: true, look: look, theme, layout: layout }
          );
        });
      });
    });
  });
});
