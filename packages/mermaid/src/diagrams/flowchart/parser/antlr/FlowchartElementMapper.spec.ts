import { describe, it, expect } from 'vitest';
import { ElementMappingUtils } from './FlowchartElementMapper.js';
import type { FlowchartElementMapping } from '../../types.js';

describe('FlowchartElementMapper', () => {
  // Sample element mappings for testing
  const sampleMappings: FlowchartElementMapping[] = [
    {
      id: 'vertex-1',
      type: 'vertex',
      position: {
        startLine: 2,
        startColumn: 4,
        endLine: 2,
        endColumn: 9,
        startIndex: 20,
        endIndex: 25,
      },
      data: { id: 'A', text: 'Node A' },
      svgId: 'flowchart-vertex-1',
      svgSelector: '[data-et="vertex"][data-id="A"]',
    },
    {
      id: 'edge-1',
      type: 'edge',
      position: {
        startLine: 2,
        startColumn: 10,
        endLine: 2,
        endColumn: 15,
        startIndex: 26,
        endIndex: 31,
      },
      data: { start: 'A', end: 'B', text: '' },
      svgId: 'flowchart-edge-1',
      svgSelector: '[data-et="edge"][data-id="e0"]',
    },
    {
      id: 'vertex-2',
      type: 'vertex',
      position: {
        startLine: 3,
        startColumn: 4,
        endLine: 3,
        endColumn: 9,
        startIndex: 40,
        endIndex: 45,
      },
      data: { id: 'B', text: 'Node B' },
      svgId: 'flowchart-vertex-2',
      svgSelector: '[data-et="vertex"][data-id="B"]',
    },
    {
      id: 'subgraph-1',
      type: 'subgraph',
      position: {
        startLine: 4,
        startColumn: 4,
        endLine: 6,
        endColumn: 7,
        startIndex: 50,
        endIndex: 70,
      },
      data: { id: 'S1', title: 'Subgraph 1' },
      svgId: 'flowchart-subgraph-1',
      svgSelector: '[data-et="subgraph"][data-id="S1"]',
    },
  ];

  describe('findElementAtPosition', () => {
    it('should find element at valid position', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 2, 5);
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-1');
    });

    it('should return undefined for position outside any element', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 100, 100);
      expect(element).toBeUndefined();
    });

    it('should find element at start position', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 2, 4);
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-1');
    });

    it('should find element at end position', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 2, 9);
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-1');
    });

    it('should not find element before start position', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 2, 3);
      expect(element).toBeUndefined();
    });

    it('should find element on different line', () => {
      const element = ElementMappingUtils.findElementAtPosition(sampleMappings, 3, 5);
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-2');
    });
  });

  describe('findElementById', () => {
    it('should find element by ID', () => {
      const element = ElementMappingUtils.findElementById(sampleMappings, 'vertex-1');
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-1');
    });

    it('should return undefined for non-existent ID', () => {
      const element = ElementMappingUtils.findElementById(sampleMappings, 'non-existent');
      expect(element).toBeUndefined();
    });

    it('should find edge by ID', () => {
      const element = ElementMappingUtils.findElementById(sampleMappings, 'edge-1');
      expect(element).toBeDefined();
      expect(element!.type).toBe('edge');
    });

    it('should find subgraph by ID', () => {
      const element = ElementMappingUtils.findElementById(sampleMappings, 'subgraph-1');
      expect(element).toBeDefined();
      expect(element!.type).toBe('subgraph');
    });
  });

  describe('findElementBySvgId', () => {
    it('should find element by SVG ID', () => {
      const element = ElementMappingUtils.findElementBySvgId(sampleMappings, 'flowchart-vertex-1');
      expect(element).toBeDefined();
      expect(element!.id).toBe('vertex-1');
    });

    it('should return undefined for non-existent SVG ID', () => {
      const element = ElementMappingUtils.findElementBySvgId(sampleMappings, 'non-existent-svg');
      expect(element).toBeUndefined();
    });

    it('should find edge by SVG ID', () => {
      const element = ElementMappingUtils.findElementBySvgId(sampleMappings, 'flowchart-edge-1');
      expect(element).toBeDefined();
      expect(element!.type).toBe('edge');
    });
  });

  describe('getElementsByType', () => {
    it('should get all vertices', () => {
      const vertices = ElementMappingUtils.getElementsByType(sampleMappings, 'vertex');
      expect(vertices).toHaveLength(2);
      expect(vertices.every((v) => v.type === 'vertex')).toBe(true);
    });

    it('should get all edges', () => {
      const edges = ElementMappingUtils.getElementsByType(sampleMappings, 'edge');
      expect(edges).toHaveLength(1);
      expect(edges.every((e) => e.type === 'edge')).toBe(true);
    });

    it('should get all subgraphs', () => {
      const subgraphs = ElementMappingUtils.getElementsByType(sampleMappings, 'subgraph');
      expect(subgraphs).toHaveLength(1);
      expect(subgraphs.every((s) => s.type === 'subgraph')).toBe(true);
    });

    it('should return empty array for non-existent type', () => {
      const elements = ElementMappingUtils.getElementsByType(sampleMappings, 'non-existent');
      expect(elements).toHaveLength(0);
    });
  });

  describe('getVertices', () => {
    it('should get all vertices', () => {
      const vertices = ElementMappingUtils.getVertices(sampleMappings);
      expect(vertices).toHaveLength(2);
      expect(vertices.every((v) => v.type === 'vertex')).toBe(true);
    });

    it('should return empty array when no vertices', () => {
      const vertices = ElementMappingUtils.getVertices([]);
      expect(vertices).toHaveLength(0);
    });
  });

  describe('getEdges', () => {
    it('should get all edges', () => {
      const edges = ElementMappingUtils.getEdges(sampleMappings);
      expect(edges).toHaveLength(1);
      expect(edges.every((e) => e.type === 'edge')).toBe(true);
    });

    it('should return empty array when no edges', () => {
      const edges = ElementMappingUtils.getEdges([]);
      expect(edges).toHaveLength(0);
    });
  });

  describe('getSubgraphs', () => {
    it('should get all subgraphs', () => {
      const subgraphs = ElementMappingUtils.getSubgraphs(sampleMappings);
      expect(subgraphs).toHaveLength(1);
      expect(subgraphs.every((s) => s.type === 'subgraph')).toBe(true);
    });

    it('should return empty array when no subgraphs', () => {
      const subgraphs = ElementMappingUtils.getSubgraphs([]);
      expect(subgraphs).toHaveLength(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      const stats = ElementMappingUtils.getStats(sampleMappings);
      expect(stats.vertices).toBe(2);
      expect(stats.edges).toBe(1);
      expect(stats.subgraphs).toBe(1);
      expect(stats.totalElements).toBe(4);
    });

    it('should return zero statistics for empty mappings', () => {
      const stats = ElementMappingUtils.getStats([]);
      expect(stats.vertices).toBe(0);
      expect(stats.edges).toBe(0);
      expect(stats.subgraphs).toBe(0);
      expect(stats.totalElements).toBe(0);
    });

    it('should have totalElements equal to sum of all types', () => {
      const stats = ElementMappingUtils.getStats(sampleMappings);
      const sum = stats.vertices + stats.edges + stats.subgraphs;
      expect(stats.totalElements).toBe(sum);
    });
  });

  describe('createPosition', () => {
    it('should create position from tokens', () => {
      const startToken = {
        line: 2,
        column: 4,
        start: 20,
        text: 'A',
      };
      const stopToken = {
        line: 2,
        column: 5,
        stop: 21,
        text: 'A',
      };

      const position = ElementMappingUtils.createPosition(
        startToken,
        stopToken,
        'flowchart TD\nA-->B'
      );

      expect(position.startLine).toBe(2);
      expect(position.startColumn).toBe(4);
      expect(position.endLine).toBe(2);
      expect(position.endColumn).toBe(6); // column + text.length
      expect(position.startIndex).toBe(20);
      expect(position.endIndex).toBe(21);
    });
  });
});
