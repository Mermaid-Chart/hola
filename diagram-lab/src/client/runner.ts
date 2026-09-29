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
 *
 * Both are installed by `layout-algorithms/ddlt/validationCapture.ts`, behind
 * the single `window.mermaidCaptureValidation` flag.
 *
 * Renders are strictly sequential. `mermaid.initialize` writes global config, so
 * two overlapping runs would race over which layout is in force.
 */

import { computeMetrics } from '../metrics/index.js';
import type { DiagramMetrics, LabEdge, LabLayoutData, LabNode } from '../metrics/index.js';

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

let queue: Promise<unknown> = Promise.resolve();

/**
 * Render `source` with `layout` and compute its metrics.
 *
 * Calls are serialised against each other, so callers may fire this in a loop
 * without coordinating.
 */
export function runDiagram(source: string, layout: string, theme = 'default'): Promise<RunResult> {
  const run = queue.then(() => renderAndMeasure(source, layout, theme));
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

async function renderAndMeasure(source: string, layout: string, theme: string): Promise<RunResult> {
  const mermaid = await getMermaid();

  await mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    maxTextSize: LAB_MAX_TEXT_SIZE,
    maxEdges: LAB_MAX_EDGES,
    theme,
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
  const laidOut =
    captured && captured.capturedAt !== layoutBefore ? captured.layout : { nodes: [], edges: [] };

  const { metrics } = computeMetrics(graftPositions(structure, laidOut));
  return { metrics, svg, durationMs };
}

/** Render `source` with `layout` and measure it, returning the error instead of throwing. */
export async function tryRunDiagram(
  source: string,
  layout: string,
  theme = 'default'
): Promise<{ ok: true; result: RunResult } | { ok: false; error: string }> {
  try {
    return { ok: true, result: await runDiagram(source, layout, theme) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
