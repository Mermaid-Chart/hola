/** The HOLA subgraph renderer's common radius for orthogonal rounded corners. */
export const HOLA_ROUNDED_CORNER_RADIUS = 12;

/**
 * Straight-line distance a 90° turn needs on each adjoining segment for the
 * renderer to retain the full configured radius instead of collapsing it into a
 * sharp corner. `curveRounded` trims each leg at 45°, hence two `r / sin(45°)`
 * runs are required for the complete visible bend.
 */
export const FULL_ROUNDED_CORNER_RUN = Math.ceil(
  (2 * HOLA_ROUNDED_CORNER_RADIUS) / Math.sin(Math.PI / 4)
);
