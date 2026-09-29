import type { LayoutData } from '../../types.js';
import { createCommonLayoutRenderer } from '../common/index.js';
import { runIpsepColaLayoutCore } from '../layout-utils/ipsep-cola/layoutCore.js';
import type { IpsepColaLayoutResult } from '../layout-utils/ipsep-cola/layoutCore.js';

/**
 * IPSEP-COLA — constrained stress majorisation, exposed as `layout: 'ipsep-cola'`.
 *
 * Dwyer, Koren & Marriott, *IPSEP-COLA: An Incremental Procedure for Separation
 * Constraint Layout of Graphs* (2006). Nodes are placed by minimising a stress
 * model of the graph's shortest-path distances, subject to axis-aligned
 * separation constraints that enforce the diagram's declared direction and keep
 * node boxes from overlapping.
 *
 * This is the whole layout: the engine, and nothing on top of it. It is the
 * same engine `hola` runs as its first stage, which is the point of having it
 * registered separately — HOLA then adds alignment and grid snapping, peels the
 * trees off the core, and routes the result orthogonally, and each of those
 * stages is easier to judge when you can see the placement it started from.
 * The engine itself lives in `layout-utils/ipsep-cola/` precisely because two
 * layouts share it; see its `IPSEP-COLA-Pseudocode.md` for the
 * section-by-section correspondence with the paper.
 *
 * Edges are straight centre-to-centre lines. The shared painter clips both ends
 * against the node shapes, so `skipIntersect` is deliberately left at its
 * default (as with dagre) rather than set the way a layout that owns its own
 * router sets it.
 */
export const render = createCommonLayoutRenderer<IpsepColaLayoutResult>({
  // `defaultMeasureLayout` / `createGraphWithElements` is called by the factory,
  // so every node and edge label already carries a measured size by the time
  // `runLayoutCore` runs.
  runLayoutCore: (data4Layout: LayoutData) => runIpsepColaLayoutCore(data4Layout),
});
