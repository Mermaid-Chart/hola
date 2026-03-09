import type { FlowchartElementMapping, ElementPosition } from '../../types.js';

/**
 * Utility class for element mapping operations
 * Provides helper methods for finding and managing element mappings
 */
export class ElementMappingUtils {
  /**
   * Find element at specific position
   */
  static findElementAtPosition(
    mappings: FlowchartElementMapping[],
    line: number,
    column: number
  ): FlowchartElementMapping | undefined {
    return mappings.find((mapping) => {
      const pos = mapping.position;
      if (line < pos.startLine || line > pos.endLine) {
        return false;
      }
      if (line === pos.startLine && column < pos.startColumn) {
        return false;
      }
      if (line === pos.endLine && column > pos.endColumn) {
        return false;
      }
      return true;
    });
  }

  /**
   * Find element by ID
   */
  static findElementById(
    mappings: FlowchartElementMapping[],
    id: string
  ): FlowchartElementMapping | undefined {
    return mappings.find((m) => m.id === id);
  }

  /**
   * Find element by SVG ID
   */
  static findElementBySvgId(
    mappings: FlowchartElementMapping[],
    svgId: string
  ): FlowchartElementMapping | undefined {
    return mappings.find((m) => m.svgId === svgId);
  }

  /**
   * Get all elements of specific type
   */
  static getElementsByType(
    mappings: FlowchartElementMapping[],
    type: string
  ): FlowchartElementMapping[] {
    return mappings.filter((m) => m.type === type);
  }

  /**
   * Create element position from tokens
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static createPosition(startToken: any, stopToken: any, _originalText: string): ElementPosition {
    return {
      startLine: startToken.line,
      startColumn: startToken.column,
      endLine: stopToken.line,
      endColumn: stopToken.column + (stopToken.text?.length ?? 0),
      startIndex: startToken.start,
      endIndex: stopToken.stop,
    };
  }

  /**
   * Get all vertices from mappings
   */
  static getVertices(mappings: FlowchartElementMapping[]): FlowchartElementMapping[] {
    return this.getElementsByType(mappings, 'vertex');
  }

  /**
   * Get all edges from mappings
   */
  static getEdges(mappings: FlowchartElementMapping[]): FlowchartElementMapping[] {
    return this.getElementsByType(mappings, 'edge');
  }

  /**
   * Get all subgraphs from mappings
   */
  static getSubgraphs(mappings: FlowchartElementMapping[]): FlowchartElementMapping[] {
    return this.getElementsByType(mappings, 'subgraph');
  }

  /**
   * Get statistics about element mappings
   */
  static getStats(mappings: FlowchartElementMapping[]): {
    vertices: number;
    edges: number;
    subgraphs: number;
    totalElements: number;
  } {
    return {
      vertices: this.getVertices(mappings).length,
      edges: this.getEdges(mappings).length,
      subgraphs: this.getSubgraphs(mappings).length,
      totalElements: mappings.length,
    };
  }
}
