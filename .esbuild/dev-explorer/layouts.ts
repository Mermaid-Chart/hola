/**
 * Layouts exposed by the Dev Explorer's picker and profiling controls.
 *
 * Keep this separate from Mermaid's registry: the explorer intentionally exposes
 * a curated set, but its URL and local-storage values must remain in step with
 * every selectable option.
 */
export const DEV_EXPLORER_LAYOUTS = [
  'dagre',
  'elk',
  'domus',
  'ipsep-cola',
  'stress-and-grid',
  'hola',
  'swimlane',
] as const;

export type MermaidLayout = (typeof DEV_EXPLORER_LAYOUTS)[number];

export function isDevExplorerLayout(value: unknown): value is MermaidLayout {
  return (
    typeof value === 'string' &&
    DEV_EXPLORER_LAYOUTS.includes(value as (typeof DEV_EXPLORER_LAYOUTS)[number])
  );
}
