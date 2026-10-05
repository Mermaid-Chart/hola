/**
 * Render one diagram with one layout, then measure it.
 *
 * Two captures, because one is not enough:
 *
 * - **Structure** comes from `window.mermaidLastStructureCapture`, taken by the
 *   shared layout renderer *before* any layout touches `data4Layout`. It has to
 *   be the pre-layout snapshot: dagre replaces `data4Layout.edges` with the
 *   edges it renders at the top level, so a diagram whose edges all live inside
 *   a subgraph looks edgeless afterwards. Measuring the post-layout object would
 *   make node and edge counts depend on which layout ran, which is precisely
 *   what these metrics must not do.
 * - **Positions** come from `window.mermaidLastLayoutCapture`, the finished
 *   `LayoutData` — node centres and sizes, which is what stress and the drawing
 *   box need.
 * - **The validator's verdict** comes from
 *   `window.mermaidValidateLastLayoutSummary()`, the same `validateLayout` run
 *   the Dev Explorer's validation panel shows. It grades the finished drawing,
 *   so it is a property of the (diagram, layout) pair, and it is deliberately
 *   invoked *after* the render returns rather than inside it — validation is
 *   several quadratic passes and would otherwise hold the picture off screen.
 *
 * Both are installed by `layout-algorithms/ddlt/validationCapture.ts`, behind
 * the single `window.mermaidCaptureValidation` flag.
 *
 * Renders are strictly sequential. `mermaid.initialize` writes global config, so
 * two overlapping runs would race over which layout is in force.
 */

import { computeMetrics } from '../metrics/index.js';
import type {
  DiagramMetrics,
  LabEdge,
  LabLayoutData,
  LabNode,
  ValidationSummary,
} from '../metrics/index.js';

interface CapturedLayout {
  svgId: string;
  layoutAlgorithm?: string;
  capturedAt: number;
  layout: LabLayoutData;
}

export interface CapturedStructure {
  capturedAt: number;
  diagramType?: string;
  nodes: LabNode[];
  edges: LabEdge[];
}

interface MermaidLike {
  initialize: (config: Record<string, unknown>) => Promise<void> | void;
  render: (id: string, text: string) => Promise<{ svg: string }>;
}

declare global {
  interface Window {
    mermaid?: MermaidLike;
    mermaidReady?: Promise<MermaidLike>;
    mermaidCaptureValidation?: boolean;
    mermaidLastLayoutCapture?: CapturedLayout;
    mermaidLastStructureCapture?: CapturedStructure;
    mermaidValidateLastLayoutSummary?: () => ValidationSummary | undefined;
  }
}

/** Generous caps so a big corpus diagram is measured rather than refused. */
const LAB_MAX_TEXT_SIZE = 50_000_000;
const LAB_MAX_EDGES = 1_000_000;

export interface RunResult {
  metrics: DiagramMetrics;
  svg: string;
  durationMs: number;
}

async function getMermaid(): Promise<MermaidLike> {
  const mermaid = (await window.mermaidReady?.catch(() => undefined)) ?? window.mermaid;
  if (!mermaid) {
    throw new Error('window.mermaid is not available — did /mermaid.esm.mjs fail to load?');
  }
  return mermaid;
}

/**
 * Render settings that change the drawing without changing the diagram.
 *
 * An object rather than two more positional arguments: both are plain strings,
 * so a swapped pair would be a silent wrong-measurement bug rather than a type
 * error.
 */
export interface RenderSettings {
  theme?: string;
  look?: string;
}

const DEFAULT_THEME = 'default';
const DEFAULT_LOOK = 'classic';

/**
 * Fixed seed for the `handDrawn` look.
 *
 * Mermaid's default seed of 0 means "pick a random one per render", which makes
 * every rough-edge offset differ between runs. The lab exists to compare
 * measurements, so a diagram measured twice under the same settings has to come
 * out the same both times; pinning the seed is what makes that true. Harmless
 * under the other looks, which never read it.
 */
const HAND_DRAWN_SEED = 1;

let queue: Promise<unknown> = Promise.resolve();

/**
 * Render `source` with `layout` and compute its metrics.
 *
 * Calls are serialised against each other, so callers may fire this in a loop
 * without coordinating.
 */
export function runDiagram(
  source: string,
  layout: string,
  settings: RenderSettings = {}
): Promise<RunResult> {
  const run = queue.then(() => renderAndMeasure(source, layout, settings));
  // Keep the chain alive even when one diagram throws.
  queue = run.catch(() => undefined);
  return run;
}

/**
 * Graft the laid-out geometry of the post-layout capture onto the pre-layout
 * structure.
 *
 * The result is a `LayoutData`-shaped object whose nodes and edges are the ones
 * the diagram actually declares, and whose nodes carry whatever positions the
 * layout settled on. Nodes the layout never positioned (dagre leaves nested
 * cluster children in their own coordinate space) simply arrive without `x`/`y`,
 * and the metrics already treat those as unpositioned.
 */
export function graftPositions(
  structure: CapturedStructure,
  laidOut: LabLayoutData
): LabLayoutData {
  const positioned = new Map<string, LabNode>();
  for (const node of laidOut.nodes ?? []) {
    if (node && typeof node.id === 'string') {
      positioned.set(node.id, node);
    }
  }

  return {
    nodes: structure.nodes.map((node) => {
      const match = positioned.get(node.id);
      return match
        ? { ...node, x: match.x, y: match.y, width: match.width, height: match.height }
        : { ...node };
    }),
    edges: structure.edges,
  };
}

async function renderAndMeasure(
  source: string,
  layout: string,
  settings: RenderSettings
): Promise<RunResult> {
  const mermaid = await getMermaid();

  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    maxTextSize: LAB_MAX_TEXT_SIZE,
    maxEdges: LAB_MAX_EDGES,
    theme: settings.theme ?? DEFAULT_THEME,
    look: settings.look ?? DEFAULT_LOOK,
    handDrawnSeed: HAND_DRAWN_SEED,
    layout,
    logLevel: 'error',
  });

  window.mermaidCaptureValidation = true;
  const layoutBefore = window.mermaidLastLayoutCapture?.capturedAt;
  const structureBefore = window.mermaidLastStructureCapture?.capturedAt;

  const started = performance.now();
  const id = `lab-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const { svg } = await mermaid.render(id, source);
  const durationMs = performance.now() - started;

  const structure = window.mermaidLastStructureCapture;
  if (!structure || structure.capturedAt === structureBefore) {
    throw new Error(
      `Layout "${layout}" produced no structure capture — it may not route through the shared layout renderer.`
    );
  }

  const captured = window.mermaidLastLayoutCapture;
  const hasLayout = Boolean(captured && captured.capturedAt !== layoutBefore);
  const laidOut = hasLayout ? (captured as CapturedLayout).layout : { nodes: [], edges: [] };

  // Only meaningful when this render actually produced a layout capture —
  // otherwise the accessor would grade whatever drawing came before.
  let validation: ValidationSummary | undefined;
  if (hasLayout) {
    try {
      validation = window.mermaidValidateLastLayoutSummary?.();
    } catch (e) {
      // A validator crash must not lose the metrics that did compute.
      console.warn('[lab] validateLayout failed', e);
    }
  }

  const { metrics } = computeMetrics(graftPositions(structure, laidOut), validation);
  return { metrics, svg, durationMs };
}

/** Render `source` with `layout` and measure it, returning the error instead of throwing. */
export async function tryRunDiagram(
  source: string,
  layout: string,
  settings: RenderSettings = {}
): Promise<{ ok: true; result: RunResult } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await runDiagram(source, layout, settings) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
