import type { SequenceAST, ElementMapping, ElementPosition, SequenceStatement } from './SequenceAST.js';

/**
 * Bidirectional mapping between sequence diagram code and SVG elements
 *
 * This class provides the core functionality for the bidirectional synchronization system:
 * - Maps code positions to SVG elements
 * - Maps SVG elements back to code positions
 * - Handles highlighting and selection synchronization
 */
export class SequenceElementMapper {
  private ast: SequenceAST;
  private mappings: Map<string, ElementMapping> = new Map();
  private svgToCodeMap: Map<string, string> = new Map();
  private positionIndex: ElementMapping[] = [];

  constructor(ast: SequenceAST) {
    this.ast = ast;
    this.buildMappings();
  }

  /**
   * Build internal mapping structures from AST
   */
  private buildMappings(): void {
    if (!this.ast.elementMappings) {
      return;
    }

    this.mappings.clear();
    this.svgToCodeMap.clear();
    this.positionIndex = [];

    for (const mapping of this.ast.elementMappings) {
      this.mappings.set(mapping.id, mapping);

      if (mapping.svgId) {
        this.svgToCodeMap.set(mapping.svgId, mapping.id);
      }

      this.positionIndex.push(mapping);
    }

    // Sort position index by start position for efficient lookups
    this.positionIndex.sort((a, b) => {
      if (a.position.startLine !== b.position.startLine) {
        return a.position.startLine - b.position.startLine;
      }
      return a.position.startColumn - b.position.startColumn;
    });
  }

  /**
   * Get element mapping by ID
   */
  getElementById(id: string): ElementMapping | undefined {
    return this.mappings.get(id);
  }

  /**
   * Get element mapping by SVG ID
   */
  getElementBySvgId(svgId: string): ElementMapping | undefined {
    const elementId = this.svgToCodeMap.get(svgId);
    return elementId ? this.mappings.get(elementId) : undefined;
  }

  /**
   * Find element at specific code position
   */
  getElementAtPosition(line: number, column: number): ElementMapping | undefined {
    for (const mapping of this.positionIndex) {
      const pos = mapping.position;

      // Check if position is within element bounds
      if (line >= pos.startLine && line <= pos.endLine) {
        if (line === pos.startLine && line === pos.endLine) {
          // Single line element
          if (column >= pos.startColumn && column <= pos.endColumn) {
            return mapping;
          }
        } else if (line === pos.startLine) {
          // Start line of multi-line element
          if (column >= pos.startColumn) {
            return mapping;
          }
        } else if (line === pos.endLine) {
          // End line of multi-line element
          if (column <= pos.endColumn) {
            return mapping;
          }
        } else {
          // Middle line of multi-line element
          return mapping;
        }
      }
    }
    return undefined;
  }

  /**
   * Find element at specific character index
   */
  getElementAtIndex(index: number): ElementMapping | undefined {
    for (const mapping of this.positionIndex) {
      const pos = mapping.position;
      if (index >= pos.startIndex && index <= pos.endIndex) {
        return mapping;
      }
    }
    return undefined;
  }

  /**
   * Get all elements of a specific type
   */
  getElementsByType(type: string): ElementMapping[] {
    return Array.from(this.mappings.values()).filter(mapping => mapping.type === type);
  }

  /**
   * Get all participant elements
   */
  getParticipants(): ElementMapping[] {
    return this.getElementsByType('participant');
  }

  /**
   * Get all message elements
   */
  getMessages(): ElementMapping[] {
    return this.getElementsByType('message');
  }

  /**
   * Get all note elements
   */
  getNotes(): ElementMapping[] {
    return this.getElementsByType('note');
  }

  /**
   * Get all loop/control structure elements
   */
  getControlStructures(): ElementMapping[] {
    return Array.from(this.mappings.values()).filter(mapping =>
      ['loop', 'alt', 'opt', 'par', 'rect', 'break', 'critical'].includes(mapping.type)
    );
  }

  /**
   * Update SVG ID for an element
   */
  updateSvgId(elementId: string, svgId: string): void {
    const mapping = this.mappings.get(elementId);
    if (mapping) {
      // Remove old SVG mapping if exists
      if (mapping.svgId) {
        this.svgToCodeMap.delete(mapping.svgId);
      }

      // Update mapping
      mapping.svgId = svgId;
      this.svgToCodeMap.set(svgId, elementId);
    }
  }

  /**
   * Update SVG selector for an element
   */
  updateSvgSelector(elementId: string, selector: string): void {
    const mapping = this.mappings.get(elementId);
    if (mapping) {
      mapping.svgSelector = selector;
    }
  }

  /**
   * Get all mappings as array
   */
  getAllMappings(): ElementMapping[] {
    return Array.from(this.mappings.values());
  }

  /**
   * Get mappings in position order
   */
  getMappingsInOrder(): ElementMapping[] {
    return [...this.positionIndex];
  }

  /**
   * Find overlapping elements at position
   */
  getOverlappingElements(line: number, column: number): ElementMapping[] {
    const overlapping: ElementMapping[] = [];

    for (const mapping of this.positionIndex) {
      const pos = mapping.position;

      if (line >= pos.startLine && line <= pos.endLine) {
        if (line === pos.startLine && line === pos.endLine) {
          if (column >= pos.startColumn && column <= pos.endColumn) {
            overlapping.push(mapping);
          }
        } else if (line === pos.startLine) {
          if (column >= pos.startColumn) {
            overlapping.push(mapping);
          }
        } else if (line === pos.endLine) {
          if (column <= pos.endColumn) {
            overlapping.push(mapping);
          }
        } else {
          overlapping.push(mapping);
        }
      }
    }

    return overlapping;
  }

  /**
   * Get element range for highlighting
   */
  getElementRange(elementId: string): ElementPosition | undefined {
    const mapping = this.mappings.get(elementId);
    return mapping?.position;
  }

  /**
   * Check if position is within any element
   */
  isPositionInElement(line: number, column: number): boolean {
    return this.getElementAtPosition(line, column) !== undefined;
  }

  /**
   * Get statistics about mappings
   */
  getStats(): {
    totalElements: number;
    participants: number;
    messages: number;
    notes: number;
    controlStructures: number;
    withSvgIds: number;
  } {
    const all = this.getAllMappings();
    return {
      totalElements: all.length,
      participants: this.getParticipants().length,
      messages: this.getMessages().length,
      notes: this.getNotes().length,
      controlStructures: this.getControlStructures().length,
      withSvgIds: all.filter(m => m.svgId).length,
    };
  }
}

/**
 * Utility functions for element mapping
 */
export class ElementMappingUtils {
  /**
   * Create a unique element ID
   */
  static generateElementId(type: string, index: number): string {
    return `${type}_${index}_${Date.now()}`;
  }

  /**
   * Create SVG ID from element ID
   */
  static generateSvgId(elementId: string): string {
    return `svg_${elementId}`;
  }

  /**
   * Create position from line/column info
   */
  static createPosition(
    startLine: number,
    startColumn: number,
    endLine: number,
    endColumn: number,
    startIndex: number,
    endIndex: number
  ): ElementPosition {
    return {
      startLine,
      startColumn,
      endLine,
      endColumn,
      startIndex,
      endIndex,
    };
  }

  /**
   * Check if two positions overlap
   */
  static positionsOverlap(pos1: ElementPosition, pos2: ElementPosition): boolean {
    return !(pos1.endIndex < pos2.startIndex || pos2.endIndex < pos1.startIndex);
  }

  /**
   * Merge two positions to create encompassing range
   */
  static mergePositions(pos1: ElementPosition, pos2: ElementPosition): ElementPosition {
    return {
      startLine: Math.min(pos1.startLine, pos2.startLine),
      startColumn: pos1.startLine < pos2.startLine ? pos1.startColumn :
                   pos1.startLine > pos2.startLine ? pos2.startColumn :
                   Math.min(pos1.startColumn, pos2.startColumn),
      endLine: Math.max(pos1.endLine, pos2.endLine),
      endColumn: pos1.endLine > pos2.endLine ? pos1.endColumn :
                 pos1.endLine < pos2.endLine ? pos2.endColumn :
                 Math.max(pos1.endColumn, pos2.endColumn),
      startIndex: Math.min(pos1.startIndex, pos2.startIndex),
      endIndex: Math.max(pos1.endIndex, pos2.endIndex),
    };
  }
}
