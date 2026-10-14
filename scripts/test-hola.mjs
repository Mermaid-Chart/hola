/**
 * Focused HOLA checks for iterative layout changes.
 *
 * pnpm test:hola runs both sets; test:hola:unit and test:hola:browser run one.
 * Wider core/grid tests and corpus sweeps remain available in the regular suites.
 */
import { spawnSync } from 'node:child_process';

const hola = 'packages/mermaid/src/rendering-util/layout-algorithms/hola/';
const unitSpecs = [
  'attached/containerEdges.spec.ts',
  'attached/frame-ports.ddlt.spec.ts',
  'attached/gridAlignment.spec.ts',
  'attached/grid-alignment.ddlt.spec.ts',
  'attached/parallel-subgraphs.ddlt.spec.ts',
  'attached/subgraphs.spec.ts',
  'core/routing/convergingFans.spec.ts',
  'core/routing/crossingVertices.spec.ts',
  'core/routing/fanPorts.spec.ts',
  'core/routing/finalRouting.spec.ts',
  'core/routing/orthogonalRouter.spec.ts',
  'core/routing/parallelBundles.spec.ts',
  'core/routing/terminalBends.spec.ts',
].map((spec) => hola + spec);

const browserSpecs = [
  'e2e/rendering/hola-frame-ports.spec.ts',
  'e2e/rendering/hola-grid-alignment.spec.ts',
  'e2e/rendering/hola-parallel-subgraphs.spec.ts',
  'e2e/rendering/hola-shape-connections.spec.ts',
];

const commands = {
  unit: ['exec', 'vitest', 'run', ...unitSpecs],
  browser: ['e2e', ...browserSpecs, '--workers=2'],
};
const mode = process.argv[2] ?? 'all';
if (!['all', 'unit', 'browser'].includes(mode)) {
  throw new Error(`Unknown HOLA test mode: ${mode}. Use all, unit, or browser.`);
}
for (const suite of mode === 'all' ? ['unit', 'browser'] : [mode]) {
  const result = spawnSync('pnpm', [...commands[suite], ...process.argv.slice(3)], {
    stdio: 'inherit',
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
