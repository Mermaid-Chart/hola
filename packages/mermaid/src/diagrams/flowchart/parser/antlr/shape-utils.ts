/**
 * Shared utility functions for flowchart shape extraction and text extraction.
 * Used by both FlowchartParserCore (Listener pattern) and FlowchartASTBuilder (Visitor pattern)
 * to avoid code duplication.
 */

import type { ParserRuleContext, TerminalNode } from 'antlr4ng';

/*
 * Table-driven configuration for complete token text extraction.
 * Maps token names to [prefixLength, suffixLength] for slicing.
 *
 * Token patterns:
 * - SQUARE_COMPLETE: [text] uses slice(1, -1)
 * - DIAMOND_COMPLETE: \{text\} uses slice(1, -1)
 * - CIRCLE_COMPLETE: ((text)) uses slice(2, -2)
 * - STADIUM_COMPLETE: ([text]) uses slice(2, -2)
 * - ELLIPSE_COMPLETE: (-text-) uses slice(2, -2)
 * - CYLINDER_COMPLETE: [(text)] uses slice(2, -2)
 * - SUBROUTINE_COMPLETE: [[text]] uses slice(2, -2)
 * - TRAPEZOID_COMPLETE: [/text\\] uses slice(2, -2)
 * - INVTRAPEZOID_COMPLETE: [\\text/] uses slice(2, -2)
 * - LEANRIGHT_COMPLETE: [/text/] uses slice(2, -2)
 * - LEANLEFT_COMPLETE: [\\text\\] uses slice(2, -2)
 */
const COMPLETE_TOKEN_SLICES: Record<string, [number, number]> = {
  SQUARE_COMPLETE: [1, -1],
  DIAMOND_COMPLETE: [1, -1],
  ROUND_COMPLETE: [1, -1], // (text) -> 1 char prefix/suffix
  CIRCLE_COMPLETE: [2, -2],
  STADIUM_COMPLETE: [2, -2],
  ELLIPSE_COMPLETE: [2, -2],
  CYLINDER_COMPLETE: [2, -2],
  SUBROUTINE_COMPLETE: [2, -2],
  TRAPEZOID_COMPLETE: [2, -2],
  INVTRAPEZOID_COMPLETE: [2, -2],
  LEANRIGHT_COMPLETE: [2, -2],
  LEANLEFT_COMPLETE: [2, -2],
  HEXAGON_COMPLETE: [2, -2], // {{text}} -> 2 char prefix/suffix
  DOUBLECIRCLE_COMPLETE: [3, -3], // (((text))) -> 3 char prefix/suffix
};

/**
 * List of complete token names in priority order.
 * More specific patterns (trapezoid variants) should be checked before less specific ones.
 */
const COMPLETE_TOKEN_NAMES = [
  'TRAPEZOID_COMPLETE',
  'INVTRAPEZOID_COMPLETE',
  'LEANRIGHT_COMPLETE',
  'LEANLEFT_COMPLETE',
  'CYLINDER_COMPLETE',
  'SUBROUTINE_COMPLETE',
  'ELLIPSE_COMPLETE',
  'HEXAGON_COMPLETE', // {{text}} - must be before DIAMOND_COMPLETE
  'DOUBLECIRCLE_COMPLETE', // (((text))) - must be before CIRCLE_COMPLETE
  'SQUARE_COMPLETE',
  'DIAMOND_COMPLETE',
  'CIRCLE_COMPLETE',
  'STADIUM_COMPLETE',
  'ROUND_COMPLETE', // (text) - must be last among paren-based shapes
] as const;

/**
 * Extract inner text from a complete token string by removing delimiters.
 * Also handles quoted strings by removing surrounding double quotes.
 *
 * @param tokenText - The full token text (e.g., "[text]" or "((text))")
 * @param prefixLen - Number of characters to remove from start
 * @param suffixLen - Number of characters to remove from end (negative value)
 * @returns The extracted inner text with quotes removed if present
 */
export function extractInnerTextFromToken(
  tokenText: string,
  prefixLen: number,
  suffixLen: number
): string {
  // Handle empty or too-short strings
  if (!tokenText || tokenText.length < prefixLen + Math.abs(suffixLen)) {
    return '';
  }

  let innerText = tokenText.slice(prefixLen, suffixLen);

  // Handle quoted strings - remove surrounding double quotes
  if (innerText.startsWith('"') && innerText.endsWith('"') && innerText.length >= 2) {
    innerText = innerText.slice(1, -1);
  }

  return innerText;
}

/**
 * Interface for context with complete token accessor methods.
 * Each method returns a TerminalNode or null.
 */
interface ContextWithCompleteTokens {
  SQUARE_COMPLETE?(): TerminalNode | null;
  HEXAGON_COMPLETE?(): TerminalNode | null;
  DIAMOND_COMPLETE?(): TerminalNode | null;
  DOUBLECIRCLE_COMPLETE?(): TerminalNode | null;
  CIRCLE_COMPLETE?(): TerminalNode | null;
  STADIUM_COMPLETE?(): TerminalNode | null;
  ROUND_COMPLETE?(): TerminalNode | null;
  ELLIPSE_COMPLETE?(): TerminalNode | null;
  CYLINDER_COMPLETE?(): TerminalNode | null;
  SUBROUTINE_COMPLETE?(): TerminalNode | null;
  TRAPEZOID_COMPLETE?(): TerminalNode | null;
  INVTRAPEZOID_COMPLETE?(): TerminalNode | null;
  LEANRIGHT_COMPLETE?(): TerminalNode | null;
  LEANLEFT_COMPLETE?(): TerminalNode | null;
}

/**
 * Extract text from a complete token in a vertex shape context.
 * This is a table-driven approach that eliminates code duplication.
 *
 * @param ctx - The context containing complete token accessor methods
 * @returns The extracted text or null if no complete token is present
 */
export function extractTextFromCompleteToken(ctx: ContextWithCompleteTokens | null): string | null {
  if (!ctx) {
    return null;
  }

  for (const tokenName of COMPLETE_TOKEN_NAMES) {
    // Get the accessor method for this token type
    const accessor: (() => TerminalNode | null) | undefined =
      ctx[tokenName as keyof ContextWithCompleteTokens];
    if (typeof accessor !== 'function') {
      continue;
    }

    // Call the accessor to get the terminal node
    const token = accessor.call(ctx);
    if (!token) {
      continue;
    }

    // Get the token text and slice configuration
    const tokenText = token.getText();
    const sliceConfig = COMPLETE_TOKEN_SLICES[tokenName];
    if (!sliceConfig) {
      continue;
    }

    // Extract and return the inner text
    return extractInnerTextFromToken(tokenText, sliceConfig[0], sliceConfig[1]);
  }

  return null;
}

/**
 * Interface for vertexShape context with shape-related token accessors.
 * This is a subset of the ANTLR-generated VertexShapeContext.
 * After left-factoring optimization, shape tokens are in vertexShape rule, not vertex.
 */
interface VertexShapeContextWithShapes extends ParserRuleContext {
  TAGEND?(): unknown;
  TRAP_START?(): unknown;
  TRAPEND?(): unknown;
  INVTRAP_START?(): unknown;
  INVTRAPEND?(): unknown;
  CYLINDER_START?(): unknown;
  VERTEX_WITH_PROPS_START?(): unknown;
  SQS?(): unknown;
  CIRCLE_START?(): unknown;
  PS?(): unknown;
  DOUBLECIRCLE_START?(): unknown;
  ELLIPSE_COMPLETE?(): unknown;
  ELLIPSE_START?(): unknown;
  STADIUM_START?(): unknown;
  SUBROUTINE_START?(): unknown;
  DIAMOND_START?(): unknown[] | null;
  // PERFORMANCE: Complete tokens that avoid mode transitions
  SQUARE_COMPLETE?(): unknown;
  DIAMOND_COMPLETE?(): unknown;
  CIRCLE_COMPLETE?(): unknown;
  STADIUM_COMPLETE?(): unknown;
  CYLINDER_COMPLETE?(): unknown;
  SUBROUTINE_COMPLETE?(): unknown;
  // Trapezoid complete tokens
  TRAPEZOID_COMPLETE?(): unknown;
  INVTRAPEZOID_COMPLETE?(): unknown;
  LEANRIGHT_COMPLETE?(): unknown;
  LEANLEFT_COMPLETE?(): unknown;
  // New complete tokens for common shapes
  HEXAGON_COMPLETE?(): unknown;
  DOUBLECIRCLE_COMPLETE?(): unknown;
  ROUND_COMPLETE?(): unknown;
}

/**
 * Interface for vertex context after left-factoring optimization.
 * Structure: vertex = idString vertexShape?
 */
interface VertexContextWithOptionalShape extends ParserRuleContext {
  vertexShape?(): VertexShapeContextWithShapes | null;
}

/**
 * Extract shape from a vertexShape context based on grammar structure.
 * Returns undefined for contexts without shape tokens.
 *
 * @param shapeCtx - The vertexShape context from the parser
 * @returns The shape name (e.g., 'round', 'diamond', 'circle') or undefined
 */
function extractShapeFromVertexShapeContext(
  shapeCtx: VertexShapeContextWithShapes | null
): string | undefined {
  if (!shapeCtx) {
    return undefined;
  }

  // Node with shape tokens - determine shape based on tokens
  // cspell:ignore INVTRAP

  // PERFORMANCE: Check complete tokens first (no mode transitions)
  // Check more specific patterns before less specific ones
  // Trapezoid complete tokens must come before SQUARE_COMPLETE
  if (shapeCtx.TRAPEZOID_COMPLETE?.()) {
    return 'trapezoid';
  }
  if (shapeCtx.INVTRAPEZOID_COMPLETE?.()) {
    return 'inv_trapezoid';
  }
  if (shapeCtx.LEANRIGHT_COMPLETE?.()) {
    return 'lean_right';
  }
  if (shapeCtx.LEANLEFT_COMPLETE?.()) {
    return 'lean_left';
  }
  if (shapeCtx.CYLINDER_COMPLETE?.()) {
    return 'cylinder';
  }
  if (shapeCtx.SUBROUTINE_COMPLETE?.()) {
    return 'subroutine';
  }
  if (shapeCtx.SQUARE_COMPLETE?.()) {
    return 'square';
  }
  if (shapeCtx.HEXAGON_COMPLETE?.()) {
    return 'hexagon';
  }
  if (shapeCtx.DIAMOND_COMPLETE?.()) {
    return 'diamond';
  }
  if (shapeCtx.DOUBLECIRCLE_COMPLETE?.()) {
    return 'doublecircle';
  }
  if (shapeCtx.CIRCLE_COMPLETE?.()) {
    return 'circle';
  }
  if (shapeCtx.STADIUM_COMPLETE?.()) {
    return 'stadium';
  }
  if (shapeCtx.ROUND_COMPLETE?.()) {
    return 'round';
  }

  // Fallback to mode-based tokens
  if (shapeCtx.TAGEND?.()) {
    return 'odd';
  }
  if (shapeCtx.TRAP_START?.() && shapeCtx.TRAPEND?.()) {
    return 'trapezoid';
  }
  if (shapeCtx.INVTRAP_START?.() && shapeCtx.INVTRAPEND?.()) {
    return 'inv_trapezoid';
  }
  if (shapeCtx.TRAP_START?.() && shapeCtx.INVTRAPEND?.()) {
    return 'lean_right';
  }
  if (shapeCtx.INVTRAP_START?.() && shapeCtx.TRAPEND?.()) {
    return 'lean_left';
  }
  if (shapeCtx.CYLINDER_START?.()) {
    return 'cylinder';
  }
  if (shapeCtx.VERTEX_WITH_PROPS_START?.()) {
    return 'rect';
  }
  if (shapeCtx.SQS?.()) {
    return 'square';
  }
  if (shapeCtx.CIRCLE_START?.()) {
    return 'circle';
  }
  if (shapeCtx.PS?.()) {
    return 'round';
  }
  if (shapeCtx.DOUBLECIRCLE_START?.()) {
    return 'doublecircle';
  }
  if (shapeCtx.ELLIPSE_COMPLETE?.()) {
    return 'ellipse';
  }
  if (shapeCtx.ELLIPSE_START?.()) {
    return 'ellipse';
  }
  if (shapeCtx.STADIUM_START?.()) {
    return 'stadium';
  }
  if (shapeCtx.SUBROUTINE_START?.()) {
    return 'subroutine';
  }
  if (shapeCtx.DIAMOND_START?.()) {
    const diamondStarts = shapeCtx.DIAMOND_START();
    if (diamondStarts && diamondStarts.length >= 2) {
      return 'hexagon';
    }
    return 'diamond';
  }

  return undefined;
}

/**
 * Extract shape from a vertex context based on grammar structure.
 * Returns undefined for simple node IDs without shape tokens.
 *
 * After left-factoring optimization, the vertex rule has structure:
 *   vertex: idString vertexShape?
 *
 * Shape tokens are now in the optional vertexShape child context.
 *
 * @param vertexCtx - The vertex context from the parser
 * @returns The shape name (e.g., 'round', 'diamond', 'circle') or undefined
 */
export function extractShapeFromVertexContext(
  vertexCtx: VertexContextWithOptionalShape | null
): string | undefined {
  if (!vertexCtx) {
    return undefined;
  }

  // After left-factoring, vertex = idString vertexShape?
  // If there's no vertexShape child, it's a simple node ID without shape
  const vertexShapeCtx = vertexCtx.vertexShape?.();
  if (!vertexShapeCtx) {
    return undefined;
  }

  // Extract shape from the vertexShape context
  return extractShapeFromVertexShapeContext(vertexShapeCtx);
}
