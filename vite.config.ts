import jison from './.vite/jisonPlugin.js';
import jsonSchemaPlugin from './.vite/jsonSchemaPlugin.js';
import typescript from '@rollup/plugin-typescript';
import { defaultExclude, defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    extensions: ['.js'],
  },
  plugins: [
    jison(),
    jsonSchemaPlugin(), // handles .schema.yaml JSON Schema files
    typescript({ compilerOptions: { declaration: false } }),
  ],
  test: {
    environment: 'jsdom',
    globals: true,
    /**
     * Vitest's 5s default is below what a layout test legitimately costs here.
     * The DDLT and fixture-sweep specs parse a diagram, run a full layout and
     * then validate the result — several quadratic passes over nodes and edges —
     * and the heaviest single cases run past 20s. At 5s they fail as
     * `Test timed out in 5000ms` rather than on any assertion, which reads as a
     * broken layout and is not one: the same specs pass unchanged at this limit.
     *
     * This does mean a genuinely hung test takes 30s to surface instead of 5s.
     * That is the cheaper mistake — the suite's cost is dominated by how many
     * slow-but-correct tests it runs, not by how fast a hang is caught.
     */
    testTimeout: 30_000,
    exclude: [
      ...defaultExclude,
      'e2e/rendering/**',
      'e2e/other/**',
      './tests/**',
      '**/__mocks__/**',
      '**/generated/',
    ],
    // TODO: should we move this to a mermaid-core package?
    coverage: {
      provider: 'v8',
      // Only report files that unit tests actually exercise. Diagram render/style
      // files are covered by the e2e suite, not unit tests; reporting them here at
      // 0% makes them merge with the e2e flag on Codecov and paint e2e-covered
      // files red in the combined view.
      all: false,
      reporter: ['text', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage/vitest',
      exclude: [
        ...defaultExclude,
        './tests/**',
        'e2e/rendering/**',
        'e2e/other/**',
        '**/__mocks__/**',
        '**/generated/',
      ],
    },
    includeSource: ['packages/*/src/**/*.{js,ts}'],
    clearMocks: true,
  },
  build: {
    /** If you set esmExternals to true, this plugins assumes that
     all external dependencies are ES modules */

    commonjsOptions: {
      esmExternals: true,
    },
  },
  define: {
    // Needs to be string
    'injected.includeLargeFeatures': 'true',
    'injected.profiling': 'false',
    'import.meta.vitest': 'undefined',
    packageVersion: "'0.0.0'",
  },
});
