import { expect, it } from 'vitest';
import { route } from './orthogonalRouter.js';
import { finalRouterConfig } from './finalRouting.js';
import { resolveOptions } from '../options.js';

it('counts terminal joins when choosing the shortest bent path between locked ports', () => {
  const source = { id: 'source', rect: { x: -140, y: 260, width: 80, height: 54 } };
  const target = { id: 'target', rect: { x: 0, y: 0, width: 80, height: 54 } };
  const routed = route(
    {
      edgeId: 'edge',
      accountForTerminalBends: true,
      source,
      target,
      obstacles: [source, target],
      lockedSourceSide: 'top',
      lockedTargetSide: 'left',
    },
    finalRouterConfig(resolveOptions())
  );
  expect(routed).not.toBeNull();
  expect(routed!.bendCount).toBe(1);
  expect(routed!.points).toEqual([
    { x: -140, y: 233 },
    { x: -140, y: 0 },
    { x: -40, y: 0 },
  ]);
});
