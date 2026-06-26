import eyesPlugin from '@applitools/eyes-cypress';
import { argosAfterRun, argosAfterScreenshot } from '@argos-ci/cypress/task';
import coverage from '@cypress/code-coverage/task.js';
import { log } from './packages/mermaid/src/logger.js';
import { defineConfig } from 'cypress';
import { addMatchImageSnapshotPlugin } from 'cypress-image-snapshot/plugin.js';
import cypressSplit from 'cypress-split';
import 'dotenv/config';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const SWIMLANE_FIXTURE_DIR = 'cypress/platform/dev-diagrams/layout-tests/swimlanes';

const listSwimlaneFixtureNames = (projectRoot: string): string[] =>
  readdirSync(join(projectRoot, SWIMLANE_FIXTURE_DIR))
    .filter((file) => file.endsWith('.mmd'))
    .sort();

const baseConfig = defineConfig({
  projectId: 'n2sma2',
  viewportWidth: 1440,
  viewportHeight: 1024,
  e2e: {
    baseUrl: `http://localhost:${process.env.MERMAID_PORT ?? 9000}`,
    specPattern: 'cypress/integration/**/*.{js,ts}',
    setupNodeEvents(on, config) {
      coverage(on, config);
      cypressSplit(on, config);
      on('before:browser:launch', (browser, launchOptions) => {
        if (browser.name === 'chrome' && browser.isHeadless) {
          launchOptions.args.push('--window-size=1440,1024', '--force-device-scale-factor=1');
        }
        return launchOptions;
      });
      // copy any needed variables from process.env to config.env
      config.env.useAppli = process.env.USE_APPLI ? true : false;
      config.env.useArgos = process.env.RUN_VISUAL_TEST === 'true';
      config.env.swimlaneFixtures = listSwimlaneFixtureNames(config.projectRoot);

      if (config.env.useArgos) {
        const argosOptions = { uploadToArgos: !!process.env.CI };
        // Register after:screenshot so Argos can copy screenshots to its temp dir.
        on('after:screenshot', (details) => {
          return argosAfterScreenshot(config, details, argosOptions);
        });
        // Wrap after:run in try/catch so a failed upload (e.g. network error,
        // missing ARGOS_TOKEN, or metadata read failure) never crashes the
        // Cypress process and swallows the actual test results.
        on('after:run', async (results) => {
          try {
            await argosAfterRun(config, results, argosOptions);
          } catch (err) {
            log.error('⚠️  Argos upload failed (non-fatal):', err);
          }
        });
      } else {
        addMatchImageSnapshotPlugin(on, config);
      }
      on('task', {
        listSwimlaneFixtures() {
          return listSwimlaneFixtureNames(config.projectRoot);
        },
      });
      // do not forget to return the changed config object!
      return config;
    },
  },
  video: false,
});

// eyesPlugin must always wrap the config so that the browser-side
// @applitools/eyes-cypress/commands (imported unconditionally in e2e.js)
// can read Cypress.env('APPLITOOLS') without crashing.
// The pipeline-crash risk is mitigated by the try/catch around argosAfterRun above,
// which prevents Argos upload failures from propagating through Applitools' wrapper.
// Type cast needed because the @applitools/eyes-cypress type declarations export
// the default as a namespace re-export, which TypeScript resolves as non-callable.
type EyesPluginFn = (config: Cypress.ConfigOptions) => Cypress.ConfigOptions;
export default (eyesPlugin as unknown as EyesPluginFn)(baseConfig);
