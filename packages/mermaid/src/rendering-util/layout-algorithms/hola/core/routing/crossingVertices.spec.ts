import { expect, it } from 'vitest';
import { countCrossings, route, segmentsOf } from './orthogonalRouter.js';
import { resolveOptions } from '../options.js';
import { finalRouterConfig } from './finalRouting.js';

it('charges crossings at grid junctions when scoring occupied routes', () => {
  const source = { id: 'a', rect: { x: -120, y: 0, width: 40, height: 40 } };
  const target = { id: 'b', rect: { x: 120, y: 0, width: 40, height: 40 } };
  const guide = { id: 'guide', rect: { x: 0, y: 200, width: 40, height: 40 } };
  const occupied = [{ a: { x: 0, y: -60 }, b: { x: 0, y: 60 } }];
  const routed = route(
    {
      edgeId: 'test',
      source,
      target,
      obstacles: [source, target, guide],
      lockedSourceSide: 'right',
      lockedTargetSide: 'left',
      existingSegments: occupied,
      accountForVertexCrossings: true,
    },
    finalRouterConfig(resolveOptions({ routingCrossingPenalty: 1000 }))
  );
  expect(routed).not.toBeNull();
  const crossings = segmentsOf(routed!.points).reduce(
    (sum, segment) => sum + countCrossings(segment.a, segment.b, occupied),
    0
  );
  expect(crossings, JSON.stringify(routed)).toBe(0);
  expect(routed!.crossings).toBe(crossings);
});

it('keeps a long routing rail clear of a permitted boundary without blocking crossings of it', () => {
  const source = { id: 'a', rect: { x: 0, y: 0, width: 40, height: 40 } };
  const target = { id: 'b', rect: { x: 240, y: 0, width: 40, height: 40 } };
  const routed = route(
    {
      edgeId: 'boundary',
      source,
      target,
      obstacles: [source, target],
      lockedSourceSide: 'top',
      lockedTargetSide: 'top',
      guidePoints: [{ x: 0, y: -52 }],
      boundarySegments: [{ a: { x: -60, y: -40 }, b: { x: 300, y: -40 } }],
    },
    finalRouterConfig(resolveOptions({ routingCrossingPenalty: 1000 }))
  );
  expect(routed).not.toBeNull();
  const rail = segmentsOf(routed!.points).find(
    (segment) => Math.abs(segment.a.x - segment.b.x) > 100
  )!;
  expect(Math.abs(rail.a.y + 40), JSON.stringify(routed)).toBeGreaterThanOrEqual(12);
});
