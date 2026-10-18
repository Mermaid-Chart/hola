import type { Selection } from 'd3';
import type { LayoutData } from '../../types.js';
import { isSoftIssueType, validateLayout } from '../layout-utils/validateLayout.js';
import type { ValidateLayoutResult } from '../layout-utils/validateLayout.js';

// ─────────────────────────────────────────────────────────────────────────────
// Layout validation capture (dev / test tooling — NOT part of production
// rendering)
//
// Sibling of `sizeCapture.ts`, and loaded the same way: `common/index.ts`
// dynamically imports this module ONLY when `window.mermaidCaptureValidation`
// is set, so it never lands in a production render path — it compiles to a
// lazily-loaded chunk that is fetched only when a developer turns capture on.
//
// Toggle from the browser devtools:
//
//   window.mermaidCaptureValidation = true;   // enable
//   window.mermaidCaptureValidation = false;  // disable
//
// Each diagram rendered while enabled updates `window.mermaidLastLayoutCapture`
// with the finished `LayoutData`, and installs `window.mermaidValidateLastLayout()`
// to grade it.
//
// ## Why capture and validation are two steps
//
// Validation is not cheap — several quadratic passes over nodes and edges — and
// running it inside `render()` would hold the diagram off the screen until it
// finished. So the render path only *stores* the layout (a reference; see
// below), and the caller decides when to grade it. The Dev Explorer waits for
// the browser to paint the SVG and then calls
// `window.mermaidValidateLastLayout()`, so the picture appears first and the
// score arrives after.
// ─────────────────────────────────────────────────────────────────────────────

type D3Selection<T extends SVGElement = SVGElement> = Selection<
  T,
  unknown,
  Element | null,
  unknown
>;

export interface CapturedLayout {
  /** `id` of the owning `<svg>`, so captures can be told apart on a page with many diagrams. */
  svgId: string;
  /** Layout name this render used, when the render path stamped one. */
  layoutAlgorithm?: string;
  /** `Date.now()` at capture. */
  capturedAt: number;
  /**
   * The finished layout, held by reference rather than cloned.
   *
   * A clone is what you would want if the object could still change, but it
   * cannot: `render()` has finished with it by the time this runs, and the next
   * render builds fresh `LayoutData` rather than mutating this one. Cloning
   * would also be the expensive half of the operation on a large diagram, and
   * a structural clone would not survive the DOM handles some nodes carry.
   */
  layout: LayoutData;
}

interface ValidationCaptureGlobal {
  mermaidCaptureValidation?: boolean;
  mermaidLastLayoutCapture?: CapturedLayout;
  mermaidValidateLastLayout?: () => ValidateLayoutResult | undefined;
}

function getCaptureGlobal(): ValidationCaptureGlobal | undefined {
  if (typeof globalThis === 'undefined') {
    return undefined;
  }
  return globalThis as unknown as ValidationCaptureGlobal;
}

/**
 * Whether validation capture is enabled. Kept here so callers need not import
 * this module at all in production — the `common/index.ts` guard reads the raw
 * `globalThis.mermaidCaptureValidation` flag and only imports when it is truthy.
 */
export function shouldCaptureValidation(): boolean {
  return Boolean(getCaptureGlobal()?.mermaidCaptureValidation);
}

/**
 * Record a finished {@link LayoutData} so it can be graded after paint.
 *
 * Deliberately does not call `validateLayout` itself — see the module comment.
 *
 * @param element - The container the diagram was rendered into.
 * @param data4Layout - The laid-out, painted layout data.
 */
export function captureLayoutForValidation(element: D3Selection, data4Layout: LayoutData): void {
  const g = getCaptureGlobal();
  if (!g) {
    return;
  }

  const domNode = element.node();
  const ownerSvg =
    (domNode && 'ownerSVGElement' in domNode ? domNode.ownerSVGElement : null) ?? domNode;

  g.mermaidLastLayoutCapture = {
    svgId: ownerSvg?.id ?? '(unknown)',
    layoutAlgorithm: (data4Layout as { layoutAlgorithm?: string }).layoutAlgorithm,
    capturedAt: Date.now(),
    layout: data4Layout,
  };

  // Installed on every capture rather than once, so it is present no matter
  // which render first enabled the flag.
  g.mermaidValidateLastLayout = () => {
    const captured = getCaptureGlobal()?.mermaidLastLayoutCapture;
    return captured ? validateLayout(captured.layout) : undefined;
  };
  installValidationSummary();
}

// ─────────────────────────────────────────────────────────────────────────────
// Structure capture (dev / test tooling — NOT part of production rendering)
//
// `captureLayoutForValidation` above runs *after* layout, which is what a
// validator wants: it grades the drawing. A tool that wants to describe the
// *graph* cannot use it, because a layout is free to rewrite `data4Layout` on
// its way through. Dagre does exactly that — `applyDagreLayoutResult` replaces
// `data4Layout.edges` with the edges rendered at the top level, so every
// intra-cluster edge is missing from the post-layout capture (the limitation is
// documented on that function). A diagram whose edges all live inside a
// subgraph therefore looks edgeless afterwards.
//
// So this second hook snapshots the structure *before* any layout touches it,
// under the same `window.mermaidCaptureValidation` flag. Only ids, parentage
// and edge endpoints are copied — never the node objects, which carry DOM
// handles — so the snapshot stays small and cannot be invalidated by later
// mutation.
// ─────────────────────────────────────────────────────────────────────────────

export interface CapturedStructureNode {
  id: string;
  parentId?: string;
  isGroup?: boolean;
  isEdgeLabel?: boolean;
  isLabelNode?: boolean;
  isDummy?: boolean;
}

export interface CapturedStructureEdge {
  id?: string;
  start?: string;
  end?: string;
  source?: string;
  target?: string;
  label?: string;
  isLayoutOnly?: boolean;
  labelNodeId?: string;
}

export interface CapturedStructure {
  /** `Date.now()` at capture. */
  capturedAt: number;
  /** Diagram type stamped by the renderer, when there is one. */
  diagramType?: string;
  nodes: CapturedStructureNode[];
  edges: CapturedStructureEdge[];
}

interface StructureCaptureGlobal {
  mermaidLastStructureCapture?: CapturedStructure;
}

/**
 * Record the parsed graph before any layout runs.
 *
 * @param data4Layout - The layout data as handed to the renderer, untouched.
 */
export function captureStructureBeforeLayout(data4Layout: LayoutData): void {
  if (typeof globalThis === 'undefined') {
    return;
  }
  const g = globalThis as unknown as StructureCaptureGlobal;
  g.mermaidLastStructureCapture = {
    capturedAt: Date.now(),
    diagramType: (data4Layout as { type?: string }).type,
    nodes: (data4Layout.nodes ?? []).map((node) => ({
      id: node.id,
      parentId: node.parentId,
      isGroup: node.isGroup,
      isEdgeLabel: node.isEdgeLabel,
      isLabelNode: (node as { isLabelNode?: boolean }).isLabelNode,
      isDummy: (node as { isDummy?: boolean }).isDummy,
    })),
    edges: (data4Layout.edges ?? []).map((edge) => ({
      id: edge.id,
      start: edge.start,
      end: edge.end,
      source: edge.source,
      target: edge.target,
      label: edge.label,
      isLayoutOnly: edge.isLayoutOnly,
      labelNodeId: edge.labelNodeId,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation summary (dev / test tooling — NOT part of production rendering)
//
// `mermaidValidateLastLayout` hands back the full `ValidateLayoutResult`, which
// is what a panel wants when it is going to render every issue. A tool that only
// wants to *record* the verdict needs a few numbers instead — and, crucially,
// needs to split hard issues from soft ones the same way the validator does.
//
// That split lives in `isSoftIssueType`. A consumer outside this package would
// have to copy the list and would then drift from it silently, so the summary is
// produced here, where the real predicate is in scope.
// ─────────────────────────────────────────────────────────────────────────────

export interface ValidationIssueTally {
  type: string;
  count: number;
  soft: boolean;
}

export interface CapturedValidationSummary {
  /** Whether the layout is valid at all. `score` is 0 when this is false. */
  ok: boolean;
  /** DDLT headline score in [0, 1000]. */
  score: number;
  issueCount: number;
  /** Issues that make the layout invalid, as opposed to merely lowering the score. */
  hardIssueCount: number;
  softIssueCount: number;
  /** Edge crossings counted globally by the validator. */
  crossings: number;
  /** Issue counts by type, most frequent first, hard types before soft ones. */
  byType: ValidationIssueTally[];
}

interface ValidationSummaryGlobal {
  mermaidValidateLastLayoutSummary?: () => CapturedValidationSummary | undefined;
}

function summarise(result: ValidateLayoutResult): CapturedValidationSummary {
  const tally = new Map<string, ValidationIssueTally>();
  let hardIssueCount = 0;
  for (const issue of result.issues) {
    const soft = isSoftIssueType(issue.type);
    if (!soft) {
      hardIssueCount++;
    }
    const entry = tally.get(issue.type);
    if (entry) {
      entry.count++;
    } else {
      tally.set(issue.type, { type: issue.type, count: 1, soft });
    }
  }

  return {
    ok: result.ok,
    score: result.score,
    issueCount: result.issues.length,
    hardIssueCount,
    softIssueCount: result.issues.length - hardIssueCount,
    crossings: result.breakdown?.crossings ?? 0,
    byType: [...tally.values()].sort((a, b) =>
      a.soft === b.soft ? b.count - a.count : Number(a.soft) - Number(b.soft)
    ),
  };
}

/**
 * Install `window.mermaidValidateLastLayoutSummary` next to the full-result
 * accessor. Called from {@link captureLayoutForValidation}.
 */
export function installValidationSummary(): void {
  if (typeof globalThis === 'undefined') {
    return;
  }
  const g = globalThis as unknown as ValidationSummaryGlobal & ValidationCaptureGlobal;
  g.mermaidValidateLastLayoutSummary = () => {
    const result = g.mermaidValidateLastLayout?.();
    return result ? summarise(result) : undefined;
  };
}
