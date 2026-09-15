import type { LayoutData } from '../../types.js';
import { createCommonLayoutRenderer } from '../common/index.js';
import { runGridLikeLayoutCore, type GridLikeLayoutResult } from '../hola/grid/layoutCore.js';
import type { GridLikeOptions } from '../hola/grid/options.js';

/**
 * Stress-and-grid layout, exposed as `layout: 'stress-and-grid'`.
 *
 * This is the grid-like layout from Kieffer, Dwyer, Marriott & Wybrow (2013):
 * IPSEP-COLA supplies the constrained stress-majorisation placement, then
 * HOLA's grid module applies adaptive constrained alignment and grid snapping.
 *
 * Unlike `hola`, every node remains in the same solve. It deliberately omits
 * HOLA's core/tree decomposition, tree placement, and orthogonal routing.
 */
export function runStressAndGridLayoutCore(
  data4Layout: LayoutData,
  overrides?: Partial<GridLikeOptions>
): GridLikeLayoutResult {
  return runGridLikeLayoutCore(data4Layout, overrides);
}

export const render = createCommonLayoutRenderer<GridLikeLayoutResult>({
  runLayoutCore: runStressAndGridLayoutCore,
});
