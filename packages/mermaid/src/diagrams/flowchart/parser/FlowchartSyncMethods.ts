import type { FlowchartAST, FlowchartElementMapping } from '../types.js';

/**
 * Attach bidirectional synchronization methods to a FlowchartAST.
 *
 * This is a shared utility used by both the ANTLR and Jison AST builders
 * so that both parsers produce identical sync behaviour.
 */
export function attachSyncMethodsToAST(
  ast: FlowchartAST,
  mappings: FlowchartElementMapping[]
): void {
  // Sort mappings by position for efficient lookups
  const sortedByPosition = [...mappings].sort((a, b) => {
    if (a.position.startLine !== b.position.startLine) {
      return a.position.startLine - b.position.startLine;
    }
    return a.position.startColumn - b.position.startColumn;
  });

  // Create lookup maps
  const idMap = new Map(mappings.map((m) => [m.id, m]));

  // Attach methods to AST
  ast.getElementAtPosition = (line: number, column: number) => {
    // Find all elements that contain this position
    const matches = sortedByPosition.filter(
      (m) =>
        (line > m.position.startLine ||
          (line === m.position.startLine && column >= m.position.startColumn)) &&
        (line < m.position.endLine ||
          (line === m.position.endLine && column <= m.position.endColumn))
    );

    if (matches.length === 0) {
      return undefined;
    }

    if (matches.length === 1) {
      return matches[0];
    }

    // Return the element with the smallest range (most specific)
    return matches.reduce((smallest, current) => {
      const smallestSize =
        (smallest.position.endLine - smallest.position.startLine) * 1000 +
        (smallest.position.endColumn - smallest.position.startColumn);
      const currentSize =
        (current.position.endLine - current.position.startLine) * 1000 +
        (current.position.endColumn - current.position.startColumn);
      return currentSize < smallestSize ? current : smallest;
    });
  };

  // Get all elements on a given line (for highlighting all nodes/edges on a line)
  ast.getElementsOnLine = (line: number) => {
    return sortedByPosition.filter(
      (m) => m.position.startLine <= line && line <= m.position.endLine
    );
  };

  ast.getElementById = (id: string) => {
    return idMap.get(id);
  };

  ast.getElementAtIndex = (charIndex: number) => {
    return mappings.find(
      (m) => m.position.startIndex <= charIndex && charIndex <= m.position.endIndex
    );
  };

  ast.getVertices = () => {
    return mappings.filter((m) => m.type === 'vertex');
  };

  ast.getEdges = () => {
    return mappings.filter((m) => m.type === 'edge');
  };

  ast.getSubgraphs = () => {
    return mappings.filter((m) => m.type === 'subgraph');
  };

  ast.getStats = () => {
    const vertices = ast.getVertices?.() ?? [];
    const edges = ast.getEdges?.() ?? [];
    const subgraphs = ast.getSubgraphs?.() ?? [];
    return {
      vertices: vertices.length,
      edges: edges.length,
      subgraphs: subgraphs.length,
      totalElements: mappings.length,
    };
  };

  // getElementByDataId: Maps SVG data-id attribute to element mappings
  // For nodes: data-id is the node ID (e.g., "A", "B")
  // For edges: data-id is the svgId (e.g., "L_A_B_0" for auto-generated, or user-defined ID)
  // For subgraphs: data-id is the subgraph ID (e.g., "one", "two")
  ast.getElementByDataId = (dataId: string) => {
    // First, try to find a vertex with matching ID
    for (const mapping of mappings) {
      if (mapping.type === 'vertex' && 'id' in mapping.data && mapping.data.id === dataId) {
        return mapping;
      }
    }

    // Then, try to find an edge with matching svgId
    for (const mapping of mappings) {
      if (mapping.type === 'edge' && 'svgId' in mapping.data && mapping.data.svgId === dataId) {
        return mapping;
      }
    }

    // Try to find a subgraph with matching ID
    for (const mapping of mappings) {
      if (mapping.type === 'subgraph' && 'id' in mapping.data && mapping.data.id === dataId) {
        return mapping;
      }
    }

    return undefined;
  };
}
