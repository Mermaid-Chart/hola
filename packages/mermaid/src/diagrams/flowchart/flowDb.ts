import { select } from 'd3';
import * as yaml from 'js-yaml';
import type { MermaidConfig } from '../../config.type.js';
import { getConfig, defaultConfig } from '../../diagram-api/diagramAPI.js';
import type { DiagramDB } from '../../diagram-api/types.js';
import { log } from '../../logger.js';
import { isValidShape, type ShapeID } from '../../rendering-util/rendering-elements/shapes.js';
import type { Edge, Node } from '../../rendering-util/types.js';
import type { EdgeMetaData, NodeMetaData } from '../../types.js';
import utils, { getEdgeId } from '../../utils.js';
import common from '../common/common.js';
import {
  setAccTitle,
  getAccTitle,
  getAccDescription,
  setAccDescription,
  clear as commonClear,
  setDiagramTitle,
  getDiagramTitle,
} from '../common/commonDb.js';
import { createTooltip } from '../common/svgDrawCommon.js';
import type {
  BlankLineData,
  CommentData,
  EdgeData,
  ElementPosition,
  FlowClass,
  FlowEdge,
  FlowchartAST,
  FlowchartElementMapping,
  FlowchartStatement,
  FlowLink,
  FlowSubGraph,
  FlowText,
  FlowVertex,
  FlowVertexTypeParam,
  JisonLocation,
  SubgraphData,
  VertexData,
} from './types.js';
import DOMPurify from 'dompurify';
import { attachSyncMethodsToAST } from './parser/FlowchartSyncMethods.js';
interface LinkData {
  id: string;
}

const MERMAID_DOM_ID_PREFIX = 'flowchart-';

// We are using arrow functions assigned to class instance fields instead of methods as they are required by flow JISON
export class FlowDB implements DiagramDB {
  private vertexCounter = 0;
  private config = getConfig();
  private diagramId = '';
  private vertices = new Map<string, FlowVertex>();
  private edges: FlowEdge[] & { defaultInterpolate?: string; defaultStyle?: string[] } = [];
  private classes = new Map<string, FlowClass>();
  private subGraphs: FlowSubGraph[] = [];
  private subGraphLookup = new Map<string, FlowSubGraph>();
  private tooltips = new Map<string, string>();
  private subCount = 0;
  private firstGraphFlag = true;
  private direction: string | undefined;
  private version: string | undefined; // As in graph
  private secCount = -1;
  private posCrossRef: number[] = [];

  // AST storage (built from inline mappings or set by ANTLR parser)
  private ast?: FlowchartAST;

  // Opt into comment-preserving parsing: `Diagram.fromText` keeps `%%` comments
  // in the parsed text and hands over the frontmatter line offset, so the
  // captured Jison `@$` positions below are reported in original-source space
  // (including any YAML frontmatter the parser never saw).
  public readonly preserveCommentsWhenParsing = true;

  // Inline position tracking: populated by Jison grammar rules during parsing
  private sourceText?: string;
  private lineOffsets: number[] = [];
  private inlineMappings: {
    type: 'vertex' | 'edge' | 'subgraph' | 'comment';
    id: string;
    position: ElementPosition;
    svgId?: string;
    data: Record<string, unknown>;
    statementOriginalIndex: number;
  }[] = [];
  private inlineMappingCount = 0;
  private inlineEdgeMappingCount = 0;
  private inlineStatementIndex = 0;
  // Tracks how many times each (start->end) pair has been consumed during addEdgeMapping
  private edgePairOccurrences = new Map<string, number>();
  // Number of frontmatter lines to offset all positions by (so they match the original source)
  private frontmatterLineOffset = 0;

  // Functions to be run after graph rendering
  private funs: ((element: Element) => void)[] = []; // cspell:ignore funs

  constructor() {
    this.funs.push(this.setupToolTips.bind(this));

    // Needed for JISON since it only supports direct properties
    this.addVertex = this.addVertex.bind(this);
    this.firstGraph = this.firstGraph.bind(this);
    this.setDirection = this.setDirection.bind(this);
    this.addSubGraph = this.addSubGraph.bind(this);
    this.addLink = this.addLink.bind(this);
    this.setLink = this.setLink.bind(this);
    this.updateLink = this.updateLink.bind(this);
    this.addClass = this.addClass.bind(this);
    this.setClass = this.setClass.bind(this);
    this.destructLink = this.destructLink.bind(this);
    this.setClickEvent = this.setClickEvent.bind(this);
    this.setTooltip = this.setTooltip.bind(this);
    this.updateLinkInterpolate = this.updateLinkInterpolate.bind(this);
    this.setClickFun = this.setClickFun.bind(this);
    this.bindFunctions = this.bindFunctions.bind(this);
    // Inline position capture (called from Jison grammar rules)
    this.setSourceText = this.setSourceText.bind(this);
    this.setFrontmatterLineOffset = this.setFrontmatterLineOffset.bind(this);
    this.addVertexMapping = this.addVertexMapping.bind(this);
    this.addEdgeMapping = this.addEdgeMapping.bind(this);
    this.addSubgraphMapping = this.addSubgraphMapping.bind(this);
    this.addComment = this.addComment.bind(this);

    this.lex = {
      firstGraph: this.firstGraph.bind(this),
    };

    this.clear();
    this.setGen('gen-2');
  }

  private sanitizeText(txt: string) {
    return common.sanitizeText(txt, this.config);
  }

  private sanitizeNodeLabelType(labelType?: string) {
    switch (labelType) {
      case 'markdown':
      case 'string':
      case 'text':
        return labelType;
      default:
        return 'markdown';
    }
  }

  /**
   * Sets the diagram's SVG element ID, used to prefix domIds for uniqueness
   * across multiple diagrams on the same page.
   */
  public setDiagramId(svgElementId: string) {
    this.diagramId = svgElementId;
  }

  /**
   * Function to lookup domId from id in the graph definition.
   * When diagramId is set, returns the prefixed version for DOM uniqueness.
   *
   * @param id - id of the node
   */
  public lookUpDomId(id: string) {
    for (const vertex of this.vertices.values()) {
      if (vertex.id === id) {
        return this.diagramId ? `${this.diagramId}-${vertex.domId}` : vertex.domId;
      }
    }
    return this.diagramId ? `${this.diagramId}-${id}` : id;
  }

  /**
   * Function called by parser when a node definition has been found
   */
  public addVertex(
    id: string,
    textObj: FlowText,
    type: FlowVertexTypeParam,
    style: string[],
    classes: string[],
    dir: string,
    props = {},
    metadata?: string
  ) {
    log.debug('FlowDB: Adding vertex', { id, textObj, type, style, classes, dir });
    if (!id || id.trim().length === 0) {
      log.warn('FlowDB: Skipping vertex with empty ID');
      return;
    }
    // Extract the metadata from the shapeData, the syntax for adding metadata for nodes and edges is the same
    // so at this point we don't know if it's a node or an edge, but we can still extract the metadata
    let doc;
    let originalYamlData = '';
    if (metadata !== undefined) {
      let yamlData;
      // detect if shapeData contains a newline character
      if (!metadata.includes('\n')) {
        yamlData = '{\n' + metadata + '\n}';
      } else {
        yamlData = metadata + '\n';
      }
      originalYamlData = yamlData; // Store original for multiline detection
      doc = yaml.load(yamlData, { schema: yaml.JSON_SCHEMA }) as NodeMetaData;
    }

    // Check if this is metadata for an already-declared subgraph
    // (e.g. `sub1@{ view: collapsed }`). The id refers to a subgraph, so
    // route the metadata onto the subgraph instead of creating a vertex.
    const subGraph = this.subGraphLookup.get(id);
    if (subGraph && doc) {
      subGraph.metadata = { ...subGraph.metadata, ...doc };
      return;
    }

    // Check if this is an edge
    const edge = this.edges.find((e) => e.id === id);
    if (edge) {
      const edgeDoc = doc as EdgeMetaData;
      if (edgeDoc?.animate !== undefined) {
        edge.animate = edgeDoc.animate;
      }
      if (edgeDoc?.animation !== undefined) {
        edge.animation = edgeDoc.animation;
      }
      if (edgeDoc?.curve !== undefined) {
        edge.interpolate = edgeDoc.curve;
      }
      return;
    }

    let txt;

    let vertex = this.vertices.get(id);
    if (vertex === undefined) {
      if (textObj === undefined && type === undefined && style !== undefined && style !== null) {
        log.warn(
          `Style applied to unknown node "${id}". This may indicate a typo. The node will be created automatically.`
        );
      }
      vertex = {
        id,
        labelType: 'text',
        domId: MERMAID_DOM_ID_PREFIX + id + '-' + this.vertexCounter,
        styles: [],
        classes: [],
      };
      this.vertices.set(id, vertex);
    }
    this.vertexCounter++;

    if (textObj !== undefined) {
      this.config = getConfig();
      txt = this.sanitizeText(textObj.text.trim());
      vertex.labelType = textObj.type;
      // strip quotes if string starts and ends with a quote
      if (txt.startsWith('"') && txt.endsWith('"')) {
        txt = txt.substring(1, txt.length - 1);
      }
      vertex.text = txt;
    } else {
      if (vertex.text === undefined) {
        vertex.text = id;
      }
    }
    if (type !== undefined) {
      vertex.type = type;
    }
    if (style !== undefined && style !== null) {
      style.forEach((s) => {
        vertex.styles.push(s);
      });
    }
    if (classes !== undefined && classes !== null) {
      classes.forEach((s) => {
        vertex.classes.push(s);
      });
    }
    if (dir !== undefined) {
      vertex.dir = dir;
    }
    if (vertex.props === undefined) {
      vertex.props = props;
    } else if (props !== undefined) {
      Object.assign(vertex.props, props);
    }

    if (doc !== undefined) {
      if (doc.shape) {
        if (doc.shape !== doc.shape.toLowerCase() || doc.shape.includes('_')) {
          throw new Error(`No such shape: ${doc.shape}. Shape names should be lowercase.`);
        } else if (!isValidShape(doc.shape)) {
          throw new Error(`No such shape: ${doc.shape}.`);
        }
        vertex.type = doc?.shape;
      }

      if (doc?.label) {
        // Convert newlines to <br/> tags for HTML rendering (except for YAML pipe syntax which preserves \n)
        let labelText = doc.label;

        // Check if the original YAML had a quoted multiline string pattern
        const quotedMultilinePattern = /label:\s*"[^"]*\n[^"]*"/;
        const isQuotedMultiline = quotedMultilinePattern.test(originalYamlData);

        if (typeof labelText === 'string' && labelText.includes('\n')) {
          // Check if this is a YAML block scalar (ends with \n) vs quoted multiline string
          if (labelText.endsWith('\n')) {
            // YAML block scalar (label: |) - preserve as-is with \n
            vertex.text = labelText;
          } else {
            // Quoted multiline string (label: "text\nmore text") - convert \n to <br/>
            labelText = labelText.replace(/\n/g, '<br/>');
            vertex.text = labelText;
          }
        } else if (isQuotedMultiline && typeof labelText === 'string') {
          // YAML parsed away the newlines, but original had quoted multiline - add <br/>
          // Find where the line break should be by analyzing the original YAML
          const match = /label:\s*"([^"]*)\n\s*([^"]*)"/.exec(originalYamlData);
          if (match) {
            const part1 = match[1].trim();
            const part2 = match[2].trim();
            vertex.text = `${part1}<br/>${part2}`;
          } else {
            vertex.text = labelText;
          }
        } else {
          vertex.text = labelText;
        }
        vertex.labelType = this.sanitizeNodeLabelType(doc?.labelType);
      }
      if (doc?.icon) {
        vertex.icon = doc?.icon;
        if (!doc.label?.trim() && vertex.text === id) {
          vertex.text = '';
        }
      }
      if (doc?.form) {
        vertex.form = doc?.form;
      }
      if (doc?.pos) {
        vertex.pos = doc?.pos;
      }
      if (doc?.img) {
        vertex.img = doc?.img;
        if (!doc.label?.trim() && vertex.text === id) {
          vertex.text = '';
        }
      }
      if (doc?.constraint) {
        vertex.constraint = doc.constraint;
      }
      if (doc.w) {
        vertex.assetWidth = Number(doc.w);
      }
      if (doc.h) {
        vertex.assetHeight = Number(doc.h);
      }
    }
  }

  /**
   * Function called by parser when a link/edge definition has been found
   *
   */
  public addSingleLink(_start: string, _end: string, type: FlowLink | null, id?: string) {
    const start = _start;
    const end = _end;

    const edge: FlowEdge = {
      start: start,
      end: end,
      type: undefined,
      text: '',
      labelType: 'text',
      classes: [],
      isUserDefinedId: false,
      interpolate: this.edges.defaultInterpolate,
    };
    log.info('abc78 Got edge...', edge);
    const linkTextObj = type?.text;

    if (linkTextObj !== undefined) {
      // Handle both string and object forms of link text
      // Jison parser may return {text: string, type: 'text'|'markdown'|'string'} object
      const linkText = typeof linkTextObj === 'string' ? linkTextObj : (linkTextObj.text ?? '');
      edge.text = this.sanitizeText(linkText.trim());

      // strip quotes if string starts and ends with a quote
      if (edge.text.startsWith('"') && edge.text.endsWith('"')) {
        edge.text = edge.text.substring(1, edge.text.length - 1);
      }
      // Only set labelType if linkTextObj is an object with a type property
      edge.labelType =
        typeof linkTextObj === 'object' ? this.sanitizeNodeLabelType(linkTextObj.type) : 'text';
    }

    if (type !== null && type !== undefined) {
      edge.type = type.type;
      edge.stroke = type.stroke as FlowEdge['stroke'];
      edge.length = type.length !== undefined && type.length > 10 ? 10 : type.length;
    }
    if (id && !this.edges.some((e) => e.id === id)) {
      edge.id = id;
      edge.isUserDefinedId = true;
    } else {
      const existingLinks = this.edges.filter((e) => e.start === edge.start && e.end === edge.end);
      if (existingLinks.length === 0) {
        edge.id = getEdgeId(edge.start, edge.end, { counter: 0, prefix: 'L' });
      } else {
        edge.id = getEdgeId(edge.start, edge.end, {
          counter: existingLinks.length + 1,
          prefix: 'L',
        });
      }
    }

    if (this.edges.length < (this.config.maxEdges ?? 500)) {
      // Reduced logging for performance - only log every 5000th edge for huge diagrams
      if (this.edges.length % 5000 === 0) {
        log.info(`Pushing edge ${this.edges.length}...`);
      }
      this.edges.push(edge);
    } else {
      throw new Error(
        `Edge limit exceeded. ${this.edges.length} edges found, but the limit is ${this.config.maxEdges}.

Initialize mermaid with maxEdges set to a higher number to allow more edges.
You cannot set this config via configuration inside the diagram as it is a secure config.
You have to call mermaid.initialize.`
      );
    }
  }

  private isLinkData(value: unknown): value is LinkData {
    return (
      value !== null &&
      typeof value === 'object' &&
      'id' in value &&
      typeof (value as LinkData).id === 'string'
    );
  }

  private isFlowLink(value: unknown): value is FlowLink {
    return value !== null && typeof value === 'object' && 'stroke' in value && 'type' in value;
  }

  public addLink(_start: string[], _end: string[], linkData: unknown) {
    const startTime = performance.now();
    const id = this.isLinkData(linkData) ? linkData.id.replace('@', '') : undefined;

    log.debug('FlowDB: Adding link', { _start, _end, linkData, id });
    log.info('addLink', _start, _end, id);

    // Track performance for huge diagrams - less frequent logging
    if (this.edges.length % 10000 === 0 && this.edges.length > 0) {
      log.info(`FlowDB Progress: ${this.edges.length} edges added`);
    }

    // Convert linkData to FlowLink | null for addSingleLink
    const typedLinkData: FlowLink | null = this.isFlowLink(linkData) ? linkData : null;

    // for a group syntax like A e1@--> B & C, only the first edge should have a userDefined id
    // the rest of the edges should have auto generated ids
    for (const start of _start) {
      for (const end of _end) {
        //use the id only for last node in _start and first node in _end
        const isLastStart = start === _start[_start.length - 1];
        const isFirstEnd = end === _end[0];
        if (isLastStart && isFirstEnd) {
          this.addSingleLink(start, end, typedLinkData, id);
        } else {
          this.addSingleLink(start, end, typedLinkData, undefined);
        }
      }
    }

    const duration = performance.now() - startTime;
    if (duration > 1) {
      // Only log if it takes more than 1ms
      log.debug(`FlowDB: addLink took ${duration.toFixed(2)}ms`);
    }
  }

  /**
   * Updates a link's line interpolation algorithm
   */
  public updateLinkInterpolate(positions: ('default' | number)[], interpolate: string) {
    positions.forEach((pos) => {
      if (pos === 'default') {
        this.edges.defaultInterpolate = interpolate;
      } else {
        this.edges[pos].interpolate = interpolate;
      }
    });
  }

  /**
   * Updates a link with a style
   *
   */
  public updateLink(positions: ('default' | number)[], style: string[]) {
    positions.forEach((pos) => {
      if (typeof pos === 'number' && pos >= this.edges.length) {
        throw new Error(
          `The index ${pos} for linkStyle is out of bounds. Valid indices for linkStyle are between 0 and ${
            this.edges.length - 1
          }. (Help: Ensure that the index is within the range of existing edges.)`
        );
      }
      if (pos === 'default') {
        this.edges.defaultStyle = style;
      } else {
        this.edges[pos].style = style;
        // if edges[pos].style does have fill not set, set it to none
        if (
          (this.edges[pos]?.style?.length ?? 0) > 0 &&
          !this.edges[pos]?.style?.some((s) => s?.startsWith('fill'))
        ) {
          this.edges[pos]?.style?.push('fill:none');
        }
      }
    });
  }

  public addClass(ids: string, _style: string[]) {
    const style = _style
      .join()
      .replace(/\\,/g, '§§§')
      .replace(/,/g, ';')
      .replace(/§§§/g, ',')
      .split(';');
    ids.split(',').forEach((id) => {
      let classNode = this.classes.get(id);
      if (classNode === undefined) {
        classNode = { id, styles: [], textStyles: [] };
        this.classes.set(id, classNode);
      }

      if (style !== undefined && style !== null) {
        style.forEach((s) => {
          if (/color/.exec(s)) {
            const newStyle = s.replace('fill', 'bgFill'); // .replace('color', 'fill');
            classNode.textStyles.push(newStyle);
          }
          classNode.styles.push(s);
        });
      }
    });
  }

  /**
   * Called by parser when a graph definition is found, stores the direction of the chart.
   *
   */
  public setDirection(dir: string) {
    this.direction = dir.trim();

    if (/.*</.exec(this.direction)) {
      this.direction = 'RL';
    }
    if (/.*\^/.exec(this.direction)) {
      this.direction = 'BT';
    }
    if (/.*>/.exec(this.direction)) {
      this.direction = 'LR';
    }
    if (/.*v/.exec(this.direction)) {
      this.direction = 'TB';
    }
    if (this.direction === 'TD') {
      this.direction = 'TB';
    }
  }

  /**
   * Called by parser when a special node is found, e.g. a clickable element.
   *
   * @param ids - Comma separated list of ids
   * @param className - Class to add
   */
  public setClass(ids: string, className: string) {
    for (const id of ids.split(',')) {
      const vertex = this.vertices.get(id);
      if (vertex) {
        vertex.classes.push(className);
      }
      const edge = this.edges.find((e) => e.id === id);
      if (edge) {
        edge.classes.push(className);
      }
      const subGraph = this.subGraphLookup.get(id);
      if (subGraph) {
        subGraph.classes.push(className);
      }
    }
  }

  public setTooltip(ids: string, tooltip: string) {
    if (tooltip === undefined) {
      return;
    }
    tooltip = this.sanitizeText(tooltip);
    for (const id of ids.split(',')) {
      this.tooltips.set(this.version === 'gen-1' ? this.lookUpDomId(id) : id, tooltip);
    }
  }

  private setClickFun(id: string, functionName: string, functionArgs: string) {
    // if (_id[0].match(/\d/)) id = MERMAID_DOM_ID_PREFIX + id;
    if (getConfig().securityLevel !== 'loose') {
      return;
    }
    if (functionName === undefined) {
      return;
    }
    let argList: string[] = [];
    if (typeof functionArgs === 'string') {
      /* Splits functionArgs by ',', ignoring all ',' in double quoted strings */
      argList = functionArgs.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
      for (let i = 0; i < argList.length; i++) {
        let item = argList[i].trim();
        /* Removes all double quotes at the start and end of an argument */
        /* This preserves all starting and ending whitespace inside */
        if (item.startsWith('"') && item.endsWith('"')) {
          item = item.substr(1, item.length - 2);
        }
        argList[i] = item;
      }
    }

    /* if no arguments passed into callback, default to passing in id */
    if (argList.length === 0) {
      argList.push(id);
    }

    const vertex = this.vertices.get(id);
    if (vertex) {
      vertex.haveCallback = true;
      this.funs.push(() => {
        // Defer lookUpDomId to bind time so it includes the diagramId prefix
        const domId = this.lookUpDomId(id);
        const elem = document.querySelector(`[id="${domId}"]`);
        if (elem !== null) {
          elem.addEventListener(
            'click',
            () => {
              utils.runFunc(functionName, ...argList);
            },
            false
          );
        }
      });
    }
  }

  /**
   * Called by parser when a link is found. Adds the URL to the vertex data.
   *
   * @param ids - Comma separated list of ids
   * @param linkStr - URL to create a link for
   * @param target - Target attribute for the link
   */
  public setLink(ids: string, linkStr: string, target: string) {
    ids.split(',').forEach((id) => {
      const vertex = this.vertices.get(id);
      if (vertex !== undefined) {
        vertex.link = utils.formatUrl(linkStr, this.config);
        vertex.linkTarget = target;
      }
    });
    this.setClass(ids, 'clickable');
  }

  public getTooltip(id: string) {
    return this.tooltips.get(id);
  }

  /**
   * Called by parser when a click definition is found. Registers an event handler.
   *
   * @param ids - Comma separated list of ids
   * @param functionName - Function to be called on click
   * @param functionArgs - Arguments to be passed to the function
   */
  public setClickEvent(ids: string, functionName: string, functionArgs: string) {
    ids.split(',').forEach((id) => {
      this.setClickFun(id, functionName, functionArgs);
    });
    this.setClass(ids, 'clickable');
  }

  public bindFunctions(element: Element) {
    this.funs.forEach((fun) => {
      fun(element);
    });
  }
  public getDirection() {
    return this.direction?.trim();
  }
  /**
   * Retrieval function for fetching the found nodes after parsing has completed.
   *
   */
  public getVertices() {
    log.debug('FlowDB: Getting vertices, count:', this.vertices.size);
    return this.vertices;
  }

  /**
   * Retrieval function for fetching the found links after parsing has completed.
   *
   */
  public getEdges() {
    log.debug('FlowDB: Getting edges, count:', this.edges.length);
    return this.edges;
  }

  /**
   * Retrieval function for fetching the found class definitions after parsing has completed.
   *
   */
  public getClasses() {
    return this.classes;
  }

  private setupToolTips(element: Element) {
    const tooltipElem = createTooltip();

    const svg = select(element).select('svg');

    const nodes = svg.selectAll('g.node');
    nodes
      .on('mouseover', (e: MouseEvent) => {
        const el = select(e.currentTarget as Element);
        const title = el.attr('title');

        // Don't try to draw a tooltip if no data is provided
        if (title === null) {
          return;
        }
        const rect = (e.currentTarget as Element)?.getBoundingClientRect();
        // @ts-ignore - transition is not part of the d3 type definition
        tooltipElem.transition().duration(200).style('opacity', '.9');
        tooltipElem
          .text(el.attr('title'))
          .style('left', window.scrollX + rect.left + (rect.right - rect.left) / 2 + 'px')
          .style('top', window.scrollY + rect.bottom + 'px');
        tooltipElem.html(DOMPurify.sanitize(title));
        el.classed('hover', true);
      })
      .on('mouseout', (e: MouseEvent) => {
        // @ts-ignore - transition is not part of the d3 type definition
        tooltipElem.transition().duration(500).style('opacity', 0);
        const el = select(e.currentTarget as Element);
        el.classed('hover', false);
      });
  }

  /**
   * Set the AST for this diagram (called by ANTLR parser)
   */
  public setAST(ast: FlowchartAST): void {
    this.ast = ast;
    log.debug(
      'ANTLR_DEBUG: AST set with',
      ast.statements.length,
      'statements',
      JSON.stringify(ast, null, 2)
    );
  }

  /**
   * Update the AST with edge data from the database
   * This should be called after the parse tree has been traversed
   */
  public updateASTWithEdges(): void {
    if (!this.ast?.metadata) {
      return;
    }

    // Populate metadata.edges from this.edges
    this.ast.metadata.edges = this.edges.map((edge) => ({
      id: edge.id,
      start: edge.start,
      end: edge.end,
      type: edge.type,
      text: edge.text,
      stroke: edge.stroke,
      length: edge.length,
      interpolate: edge.interpolate,
      isUserDefinedId: edge.isUserDefinedId,
      labelType: edge.labelType,
      classes: edge.classes,
    }));

    // Update edge statements with IDs from this.edges.
    // Use occurrence tracking so that the Nth (start, end) pair matches the Nth edge.
    const stmtOccurrences = new Map<string, number>();
    for (const statement of this.ast.statements) {
      if (
        statement.type === 'edge' &&
        statement.data &&
        'start' in statement.data &&
        'end' in statement.data
      ) {
        const edgeData = statement.data as EdgeData;
        const pairKey = `${edgeData.start}->${edgeData.end}`;
        const consumed = stmtOccurrences.get(pairKey) ?? 0;
        let idx = 0;
        let matchingEdge: (typeof this.edges)[number] | undefined;
        for (const e of this.edges) {
          if (e.start === edgeData.start && e.end === edgeData.end) {
            if (idx === consumed) {
              matchingEdge = e;
              break;
            }
            idx++;
          }
        }
        stmtOccurrences.set(pairKey, consumed + 1);
        if (matchingEdge) {
          edgeData.id = matchingEdge.id;
          edgeData.type = matchingEdge.type;
          edgeData.text = matchingEdge.text;
          edgeData.stroke = matchingEdge.stroke;
          edgeData.length = matchingEdge.length;
          edgeData.interpolate = matchingEdge.interpolate;
        }
      }
    }

    // Update element mappings with IDs from this.edges
    // This is needed for bidirectional sync to work correctly
    if (this.ast.elementMappings) {
      const mappingOccurrences = new Map<string, number>();
      for (const mapping of this.ast.elementMappings) {
        if (
          mapping.type === 'edge' &&
          mapping.data &&
          'start' in mapping.data &&
          'end' in mapping.data
        ) {
          const edgeData = mapping.data;
          const pairKey = `${edgeData.start}->${edgeData.end}`;
          const consumed = mappingOccurrences.get(pairKey) ?? 0;
          let idx = 0;
          let matchingEdge: (typeof this.edges)[number] | undefined;
          for (const e of this.edges) {
            if (e.start === edgeData.start && e.end === edgeData.end) {
              if (idx === consumed) {
                matchingEdge = e;
                break;
              }
              idx++;
            }
          }
          mappingOccurrences.set(pairKey, consumed + 1);
          if (matchingEdge) {
            edgeData.id = matchingEdge.id;
            edgeData.type = matchingEdge.type;
            edgeData.text = matchingEdge.text;
            edgeData.stroke = matchingEdge.stroke;
            edgeData.length = matchingEdge.length;
            edgeData.interpolate = matchingEdge.interpolate;
          }
        }
      }
    }

    log.debug('FlowDB: AST updated with', this.edges.length, 'edges in metadata and statements');
  }

  /**
   * Get the AST for this diagram
   */
  public getAST(): FlowchartAST | undefined {
    return this.ast;
  }

  // ────────────────────────────────────────────────────────────────
  // Inline position capture (called from Jison grammar rules via @$)
  // ────────────────────────────────────────────────────────────────

  /**
   * Store the source text and precompute line offsets for O(1) position conversion.
   * Called from Diagram.ts before parsing.
   */
  public setSourceText(text: string): void {
    this.sourceText = text;
    this.lineOffsets = [0];
    for (const [i, ch] of [...text].entries()) {
      if (ch === '\n') {
        this.lineOffsets.push(i + 1);
      }
    }
  }

  /**
   * Set the number of frontmatter lines to add to all AST positions.
   * This compensates for the frontmatter being stripped before parsing,
   * so that AST positions match the original source shown in the editor.
   */
  public setFrontmatterLineOffset(offset: number): void {
    this.frontmatterLineOffset = offset;
  }

  /**
   * Convert a Jison \@$ location to an ElementPosition.
   */
  private jisonLocToPosition(loc: JisonLocation): ElementPosition {
    const startLine = loc.first_line;
    const startColumn = loc.first_column;
    const endLine = loc.last_line;
    const endColumn = loc.last_column;
    const startIndex = (this.lineOffsets[startLine - 1] ?? 0) + startColumn;
    const endIndex = (this.lineOffsets[endLine - 1] ?? 0) + endColumn - 1;
    return { startLine, startColumn, endLine, endColumn, startIndex, endIndex };
  }

  /**
   * Record a vertex mapping during parsing.
   * Called from Jison grammar vertex rules with \@$.
   */
  public addVertexMapping(
    id: string,
    textObj: FlowText | undefined,
    type: string | undefined,
    loc: JisonLocation
  ): void {
    if (!loc) {
      return;
    }
    const position = this.jisonLocToPosition(loc);
    const data: Record<string, unknown> = { id };
    if (textObj !== undefined) {
      data.text = textObj.text.trim();
    } else {
      data.text = '';
    }
    if (type !== undefined) {
      data.type = type;
    }
    this.inlineMappings.push({
      id: `vertex-${this.inlineMappingCount++}`,
      type: 'vertex',
      position,
      data,
      statementOriginalIndex: this.inlineStatementIndex++,
    });
  }

  /**
   * Record an edge mapping during parsing.
   * Called from Jison grammar vertexStatement rules with \@$.
   */
  public addEdgeMapping(
    startArr: string[],
    endArr: string[],
    _linkData: unknown,
    loc: JisonLocation
  ): void {
    if (!loc) {
      return;
    }
    const stmtPosition = this.jisonLocToPosition(loc);
    const stmtOrigIdx = this.inlineStatementIndex++;

    for (const start of startArr) {
      for (const end of endArr) {
        // Find the Nth occurrence of this (start, end) pair in this.edges
        // by skipping edges that were already consumed by earlier mappings.
        const pairKey = `${start}->${end}`;
        const alreadyConsumed = this.edgePairOccurrences.get(pairKey) ?? 0;
        let occurrenceIdx = 0;
        let matchingEdge: (typeof this.edges)[number] | undefined;
        for (const e of this.edges) {
          if (e.start === start && e.end === end) {
            if (occurrenceIdx === alreadyConsumed) {
              matchingEdge = e;
              break;
            }
            occurrenceIdx++;
          }
        }
        this.edgePairOccurrences.set(pairKey, alreadyConsumed + 1);

        const edgeId = matchingEdge?.id ?? getEdgeId(start, end, { counter: 0, prefix: 'L' });

        this.inlineMappings.push({
          id: `edge-${this.inlineEdgeMappingCount++}`,
          type: 'edge',
          position: { ...stmtPosition },
          svgId: edgeId,
          data: {
            id: edgeId,
            start,
            end,
            text: matchingEdge?.text ?? '',
            svgId: edgeId,
            type: matchingEdge?.type ?? 'arrow_point',
            stroke: matchingEdge?.stroke ?? 'normal',
            length: matchingEdge?.length ?? 1,
          },
          statementOriginalIndex: stmtOrigIdx,
        });
      }
    }

    // Add vertex-reference mappings for all nodes in start and end arrays
    const allNodes = new Set([...startArr, ...endArr]);
    for (const nodeId of allNodes) {
      this.inlineMappings.push({
        id: `vertex-${this.inlineMappingCount++}`,
        type: 'vertex',
        position: { ...stmtPosition },
        data: { id: nodeId, text: nodeId },
        statementOriginalIndex: stmtOrigIdx,
      });
    }
  }

  /**
   * Record a subgraph mapping during parsing.
   * Called from Jison grammar statement rules with \@1 (subgraph keyword) and \@end.
   */
  public addSubgraphMapping(
    id: { text: string } | undefined,
    title: { text: string; type: string } | undefined,
    loc: JisonLocation,
    endLoc?: JisonLocation
  ): void {
    if (!loc) {
      return;
    }
    const position = this.jisonLocToPosition(loc);
    const sgId = id?.text?.trim() ?? '';

    // Extend position to include the 'end' keyword
    if (endLoc) {
      const endPosition = this.jisonLocToPosition(endLoc);
      position.endLine = endPosition.endLine;
      position.endColumn = endPosition.endColumn;
      position.endIndex = endPosition.endIndex;
    }

    const titleText = title?.text ?? '';
    this.inlineMappings.push({
      id: `subgraph-${this.inlineMappingCount++}`,
      type: 'subgraph',
      position,
      svgId: sgId,
      data: { id: sgId, title: titleText },
      statementOriginalIndex: this.inlineStatementIndex++,
    });
  }

  /**
   * Record a comment during parsing.
   * Called from Jison grammar line rule when a COMMENT token is matched.
   */
  public addComment(text: string, loc: JisonLocation): void {
    if (!loc) {
      return;
    }
    const position = this.jisonLocToPosition(loc);
    this.inlineMappings.push({
      id: `comment-${this.inlineMappingCount++}`,
      type: 'comment',
      position,
      data: { text: text.trim() },
      statementOriginalIndex: this.inlineStatementIndex++,
    });
  }

  /**
   * Build a FlowchartAST from inline mappings captured during parsing.
   * Returns undefined if no inline mappings were captured.
   */
  public buildASTFromInlineMappings(): FlowchartAST | undefined {
    if (this.inlineMappings.length === 0) {
      return undefined;
    }

    const statements: FlowchartStatement[] = [];
    const elementMappings: FlowchartElementMapping[] = [];
    const direction = (this.getDirection()?.trim() as FlowchartAST['direction']) ?? 'TB';
    const firstDir = direction === 'TD' ? 'TB' : direction;

    // Track which vertices we've already created statements for
    const seenVertexStatements = new Set<string>();
    // Track vertex element mappings per (vertexId, line) to deduplicate
    const seenVertexLines = new Set<string>();
    // Track edge IDs for proper occurrence indexing
    let edgeMappingIndex = 0;

    // Sort by statement index to preserve parse order
    const sorted = [...this.inlineMappings].sort(
      (a, b) => a.statementOriginalIndex - b.statementOriginalIndex
    );

    // First pass: collect which lines have edges
    // (so we know which vertex mappings are standalone vs edge-embedded)
    const edgeLines = new Set<number>();
    for (const im of sorted) {
      if (im.type === 'edge') {
        for (let l = im.position.startLine; l <= im.position.endLine; l++) {
          edgeLines.add(l);
        }
      }
    }

    for (const im of sorted) {
      const dataId = typeof im.data.id === 'string' ? im.data.id : '';

      switch (im.type) {
        case 'vertex': {
          // Look up full vertex data from FlowDB
          const dbVertex = this.getVertices().get(dataId);
          const vtxText = dbVertex?.text ?? (typeof im.data.text === 'string' ? im.data.text : '');
          const vertexData: VertexData = {
            id: dataId,
            text: vtxText,
            type: (dbVertex?.type ??
              (typeof im.data.type === 'string' ? im.data.type : undefined)) as FlowVertexTypeParam,
          };

          // Create a vertex STATEMENT only for standalone vertex definitions
          // (not vertices embedded in edge lines)
          const isStandalone = !edgeLines.has(im.position.startLine);
          if (isStandalone && !seenVertexStatements.has(dataId)) {
            seenVertexStatements.add(dataId);
            statements.push({
              type: 'vertex',
              data: vertexData,
              position: { ...im.position },
              statementId: `stmt-vertex-${dataId}`,
              originalIndex: im.statementOriginalIndex,
            });
          }

          // Create element mapping, deduplicated per (vertexId, line).
          const vtxLineKey = `${dataId}@L${im.position.startLine}`;
          if (!seenVertexLines.has(vtxLineKey)) {
            seenVertexLines.add(vtxLineKey);
            elementMappings.push({
              id: `vertex-${dataId}-${im.statementOriginalIndex}`,
              type: 'vertex',
              position: { ...im.position },
              svgId: dataId,
              svgSelector: `[data-id="${dataId}"]`,
              data: vertexData,
              statementId: `stmt-vertex-${dataId}`,
              statementOriginalIndex: im.statementOriginalIndex,
            });
          }
          break;
        }

        case 'edge': {
          const edgeData: EdgeData = {
            id: typeof im.data.id === 'string' ? im.data.id : '',
            start: typeof im.data.start === 'string' ? im.data.start : '',
            end: typeof im.data.end === 'string' ? im.data.end : '',
            text: typeof im.data.text === 'string' ? im.data.text : '',
            svgId: im.svgId ?? (typeof im.data.svgId === 'string' ? im.data.svgId : ''),
            type: (typeof im.data.type === 'string'
              ? im.data.type
              : 'arrow_point') as EdgeData['type'],
            stroke: (typeof im.data.stroke === 'string'
              ? im.data.stroke
              : 'normal') as EdgeData['stroke'],
            length: typeof im.data.length === 'number' ? im.data.length : 1,
          };

          const stmtId = `stmt-edge-${edgeMappingIndex}`;
          const stmt: FlowchartStatement = {
            type: 'edge',
            data: edgeData,
            position: { ...im.position },
            statementId: stmtId,
            originalIndex: im.statementOriginalIndex,
          };
          statements.push(stmt);

          elementMappings.push({
            id: `edge-${edgeMappingIndex}`,
            type: 'edge',
            position: { ...im.position },
            svgId: edgeData.svgId,
            svgSelector: edgeData.svgId ? `[id*="${edgeData.svgId}"]` : undefined,
            data: edgeData,
            statementId: stmtId,
            statementOriginalIndex: im.statementOriginalIndex,
            occurrenceIndex: edgeMappingIndex,
          });
          edgeMappingIndex++;
          break;
        }

        case 'subgraph': {
          const sgId = typeof im.data.id === 'string' ? im.data.id : '';
          const sgTitle = typeof im.data.title === 'string' ? im.data.title : sgId;

          const sgData: SubgraphData = {
            id: sgId,
            title: sgTitle,
            statements: [],
          };

          // Subgraph declaration-line-only position (for element mapping / highlighting).
          // The full block span (subgraph...end) is kept in the statement.
          const declLinePos: ElementPosition = {
            startLine: im.position.startLine,
            startColumn: im.position.startColumn,
            endLine: im.position.startLine,
            endColumn: this.sourceText
              ? this.sourceText
                  .slice(
                    im.position.startIndex,
                    this.lineOffsets[im.position.startLine] ?? this.sourceText.length
                  )
                  .trimEnd().length + im.position.startColumn
              : im.position.endColumn,
            startIndex: im.position.startIndex,
            endIndex: this.sourceText
              ? im.position.startIndex +
                this.sourceText
                  .slice(
                    im.position.startIndex,
                    this.lineOffsets[im.position.startLine] ?? this.sourceText.length
                  )
                  .trimEnd().length -
                1
              : im.position.endIndex,
          };

          const sgStmtId = `stmt-subgraph-${sgId}`;
          const stmt: FlowchartStatement = {
            type: 'subgraph',
            data: sgData,
            position: { ...im.position }, // Full block span
            statementId: sgStmtId,
            originalIndex: im.statementOriginalIndex,
          };
          statements.push(stmt);

          elementMappings.push({
            id: `subgraph-${sgId}`,
            type: 'subgraph',
            position: declLinePos, // Declaration line only
            svgId: sgId,
            svgSelector: `[data-id="${sgId}"]`,
            data: sgData,
            statementId: sgStmtId,
            statementOriginalIndex: im.statementOriginalIndex,
          });
          break;
        }

        case 'comment': {
          const commentText = typeof im.data.text === 'string' ? im.data.text : '';
          const commentData: CommentData = { text: commentText };
          statements.push({
            type: 'comment',
            data: commentData,
            position: { ...im.position },
            statementId: im.id,
            originalIndex: im.statementOriginalIndex,
          });
          break;
        }
      }
    }

    // Insert blank lines for gaps between statements
    if (this.sourceText) {
      const totalLines = this.lineOffsets.length;
      const coveredLines = new Set<number>();
      for (const stmt of statements) {
        if (stmt.position) {
          for (let l = stmt.position.startLine; l <= stmt.position.endLine; l++) {
            coveredLines.add(l);
          }
        }
      }
      // Line 1 is typically the "flowchart LR" header — skip it
      for (let line = 2; line <= totalLines; line++) {
        if (!coveredLines.has(line)) {
          const lineStart = this.lineOffsets[line - 1] ?? 0;
          const lineEnd = (this.lineOffsets[line] ?? this.sourceText.length) - 1;
          const lineText = this.sourceText.slice(lineStart, lineEnd + 1).trim();
          // Only add blank lines for truly empty lines (not header/direction lines)
          if (lineText === '') {
            const blankData: BlankLineData = {};
            statements.push({
              type: 'blankLine',
              data: blankData,
              position: {
                startLine: line,
                startColumn: 0,
                endLine: line,
                endColumn: 0,
                startIndex: lineStart,
                endIndex: lineStart,
              },
              statementId: `blank-${line}`,
              originalIndex: line * 1000,
            });
          }
        }
      }
    }

    // Sort statements by originalIndex
    statements.sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));

    // Build metadata
    const nodesMap: Record<string, VertexData> = {};
    for (const [id, v] of this.getVertices()) {
      nodesMap[id] = {
        id,
        text: v.text ?? '',
        type: v.type as FlowVertexTypeParam,
      };
    }

    const sgMap = new Map<string, SubgraphData>();
    for (const sg of this.getSubGraphs()) {
      sgMap.set(sg.id, { id: sg.id, title: sg.title, statements: [] });
    }

    // Detect header keyword from source text
    const detectedHeader: 'flowchart' | 'graph' =
      this.sourceText && /^\s*graph\b/m.test(this.sourceText) ? 'graph' : 'flowchart';

    const ast: FlowchartAST = {
      header: detectedHeader,
      direction: firstDir,
      statements,
      elementMappings,
      metadata: {
        nodes: nodesMap,
        edges: this.getEdges(),
        subgraphs: sgMap,
      },
    };

    // Apply frontmatter line offset to all positions so they match
    // the original source (which includes the frontmatter block) shown in the editor.
    if (this.frontmatterLineOffset > 0) {
      const offset = this.frontmatterLineOffset;
      const offsetPos = (pos: ElementPosition) => {
        pos.startLine += offset;
        pos.endLine += offset;
      };
      for (const stmt of statements) {
        if (stmt.position) {
          offsetPos(stmt.position);
        }
      }
      for (const mapping of elementMappings) {
        if (mapping.position) {
          offsetPos(mapping.position);
        }
      }
    }

    attachSyncMethodsToAST(ast, elementMappings);
    return ast;
  }

  /**
   * Clears the internal graph db so that a new graph can be parsed.
   *
   */
  public clear(ver = 'gen-2') {
    log.debug('FlowDB: Clearing database state');
    this.vertices = new Map();
    this.classes = new Map();
    this.edges = [];
    this.funs = [this.setupToolTips.bind(this)];
    this.diagramId = '';
    this.subGraphs = [];
    this.subGraphLookup = new Map();
    this.subCount = 0;
    this.tooltips = new Map();
    this.firstGraphFlag = true;
    this.version = ver;
    this.config = getConfig();
    this.ast = undefined;
    // Clear inline position tracking
    this.sourceText = undefined;
    this.lineOffsets = [];
    this.inlineMappings = [];
    this.inlineMappingCount = 0;
    this.inlineEdgeMappingCount = 0;
    this.inlineStatementIndex = 0;
    this.edgePairOccurrences = new Map();
    this.frontmatterLineOffset = 0;
    commonClear();
    log.debug('FlowDB: Database cleared successfully');
  }

  public setGen(ver: string) {
    this.version = ver ?? 'gen-2';
  }

  public defaultStyle() {
    return 'fill:#ffa;stroke: #f66; stroke-width: 3px; stroke-dasharray: 5, 5;fill:#ffa;stroke: #666;';
  }

  public addSubGraph(
    _id: { text: string },
    list: string[],
    _title: { text: string; type: string }
  ) {
    let id: string | undefined = _id.text.trim();
    let title = _title.text;
    if (_id === _title && /\s/.exec(_title.text)) {
      id = undefined;
    }

    type SubgraphItem = string | { stmt: string; value: string };
    const uniq = (a: SubgraphItem[]) => {
      const prims: Record<string, Record<string, boolean>> = {
        boolean: {},
        number: {},
        string: {},
      };
      const objs: string[] = [];

      let dir: string | undefined;

      const nodeList = a.filter(function (item): item is string {
        if (typeof item !== 'string') {
          if (item.stmt && item.stmt === 'dir') {
            dir = item.value;
          }
          return false;
        }
        const type = typeof item;
        if (item.trim() === '') {
          return false;
        }
        if (type in prims) {
          return prims[type].hasOwnProperty(item) ? false : (prims[type][item] = true);
        } else {
          if (objs.includes(item)) {
            return false;
          }
          objs.push(item);
          return true;
        }
      });
      return { nodeList, dir };
    };

    const result = uniq(list.flat());
    const nodeList = result.nodeList;
    let dir = result.dir;
    const flowchartConfig = getConfig().flowchart ?? {};
    dir =
      dir ??
      (flowchartConfig.inheritDir
        ? (this.getDirection() ?? (getConfig() as { direction?: string }).direction ?? undefined)
        : undefined);

    if (this.version === 'gen-1') {
      for (let i = 0; i < nodeList.length; i++) {
        nodeList[i] = this.lookUpDomId(nodeList[i]);
      }
    }

    id = id ?? 'subGraph' + this.subCount;
    title = title ?? '';
    title = this.sanitizeText(title);
    this.subCount = this.subCount + 1;

    const subGraph = {
      id: id,
      nodes: nodeList,
      title: title.trim(),
      classes: [],
      dir,
      labelType: this.sanitizeNodeLabelType(_title?.type),
    };

    log.info('Adding', subGraph.id, subGraph.nodes, subGraph.dir);

    // Remove the members in the new subgraph if they already belong to another subgraph.
    // A subgraph never contains itself, so a redeclaration nested in its own body flattens.
    subGraph.nodes = this.makeUniq(subGraph, this.subGraphs).nodes.filter(
      (nodeId) => nodeId !== id
    );

    // A repeated id merges its members into the first declaration, which keeps its
    // title, direction and position, so every layout sees a single subgraph.
    const existing = this.subGraphs.find((sg) => sg.id === id);
    if (existing) {
      existing.nodes.push(...subGraph.nodes);
    } else {
      this.subGraphs.push(subGraph);
    }
    // The lookup points at the subgraph that is drawn, so classes and metadata such as
    // `view: collapsed` apply whichever declaration they follow.
    this.subGraphLookup.set(id, existing ?? subGraph);
    return id;
  }

  private getPosForId(id: string) {
    for (const [i, subGraph] of this.subGraphs.entries()) {
      if (subGraph.id === id) {
        return i;
      }
    }
    return -1;
  }

  private indexNodes2(id: string, pos: number): { result: boolean; count: number } {
    const nodes = this.subGraphs[pos].nodes;
    this.secCount = this.secCount + 1;
    if (this.secCount > 2000) {
      return {
        result: false,
        count: 0,
      };
    }
    this.posCrossRef[this.secCount] = pos;
    // Check if match
    if (this.subGraphs[pos].id === id) {
      return {
        result: true,
        count: 0,
      };
    }

    let count = 0;
    let posCount = 1;
    while (count < nodes.length) {
      const childPos = this.getPosForId(nodes[count]);
      // Ignore regular nodes (pos will be -1)
      if (childPos >= 0) {
        const res = this.indexNodes2(id, childPos);
        if (res.result) {
          return {
            result: true,
            count: posCount + res.count,
          };
        } else {
          posCount = posCount + res.count;
        }
      }
      count = count + 1;
    }

    return {
      result: false,
      count: posCount,
    };
  }

  public getDepthFirstPos(pos: number) {
    return this.posCrossRef[pos];
  }
  public indexNodes() {
    this.secCount = -1;
    if (this.subGraphs.length > 0) {
      this.indexNodes2('none', this.subGraphs.length - 1);
    }
  }

  public getSubGraphs() {
    return this.subGraphs;
  }

  public firstGraph() {
    if (this.firstGraphFlag) {
      this.firstGraphFlag = false;
      return true;
    }
    return false;
  }

  private destructStartLink(_str: string): FlowLink {
    let str = _str.trim();
    let type = 'arrow_open';

    switch (str[0]) {
      case '<':
        type = 'arrow_point';
        str = str.slice(1);
        break;
      case 'x':
        type = 'arrow_cross';
        str = str.slice(1);
        break;
      case 'o':
        type = 'arrow_circle';
        str = str.slice(1);
        break;
    }

    let stroke = 'normal';

    if (str.includes('=')) {
      stroke = 'thick';
    }

    if (str.includes('.')) {
      stroke = 'dotted';
    }

    return { type, stroke };
  }

  private countChar(char: string, str: string) {
    const length = str.length;
    let count = 0;
    for (let i = 0; i < length; ++i) {
      if (str[i] === char) {
        ++count;
      }
    }
    return count;
  }

  private destructEndLink(_str: string) {
    const str = _str.trim();
    let line = str.slice(0, -1);
    let type = 'arrow_open';

    switch (str.slice(-1)) {
      case 'x':
        type = 'arrow_cross';
        if (str.startsWith('x')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
      case '>':
        type = 'arrow_point';
        if (str.startsWith('<')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
      case 'o':
        type = 'arrow_circle';
        if (str.startsWith('o')) {
          type = 'double_' + type;
          line = line.slice(1);
        }
        break;
    }

    let stroke = 'normal';
    let length = line.length - 1;

    if (line.startsWith('=')) {
      stroke = 'thick';
    }

    if (line.startsWith('~')) {
      stroke = 'invisible';
    }

    const dots = this.countChar('.', line);

    if (dots) {
      stroke = 'dotted';
      length = dots;
    }

    return { type, stroke, length };
  }

  public destructLink(_str: string, _startStr: string) {
    const info = this.destructEndLink(_str);
    let startInfo;
    if (_startStr) {
      startInfo = this.destructStartLink(_startStr);

      if (startInfo.stroke !== info.stroke) {
        return { type: 'INVALID', stroke: 'INVALID' };
      }

      if (startInfo.type === 'arrow_open') {
        // -- xyz -->  - take arrow type from ending
        startInfo.type = info.type;
      } else {
        // x-- xyz -->  - not supported
        if (startInfo.type !== info.type) {
          return { type: 'INVALID', stroke: 'INVALID' };
        }

        startInfo.type = 'double_' + startInfo.type;
      }

      if (startInfo.type === 'double_arrow') {
        startInfo.type = 'double_arrow_point';
      }

      startInfo.length = info.length;
      return startInfo;
    }

    return info;
  }

  // Todo optimizer this by caching existing nodes
  public exists(allSgs: FlowSubGraph[], _id: string) {
    for (const sg of allSgs) {
      if (sg.nodes.includes(_id)) {
        return true;
      }
    }
    return false;
  }
  /**
   * Deletes an id from all subgraphs
   *
   */
  public makeUniq(sg: FlowSubGraph, allSubgraphs: FlowSubGraph[]) {
    const res: string[] = [];
    sg.nodes.forEach((_id, pos) => {
      if (!this.exists(allSubgraphs, _id)) {
        res.push(sg.nodes[pos]);
      }
    });
    return { nodes: res };
  }

  public lex: { firstGraph: typeof FlowDB.prototype.firstGraph };

  private getTypeFromVertex(vertex: FlowVertex): ShapeID {
    if (vertex.img) {
      return 'imageSquare';
    }
    if (vertex.icon) {
      if (vertex.form === 'circle') {
        return 'iconCircle';
      }
      if (vertex.form === 'square') {
        return 'iconSquare';
      }
      if (vertex.form === 'rounded') {
        return 'iconRounded';
      }
      return 'icon';
    }
    switch (vertex.type) {
      case 'square':
      case undefined:
        return 'squareRect';
      case 'round':
        return 'roundedRect';
      case 'ellipse':
        // @ts-expect-error -- Ellipses are broken, see https://github.com/mermaid-js/mermaid/issues/5976
        return 'ellipse';
      default:
        return vertex.type;
    }
  }

  private findNode(nodes: Node[], id: string) {
    return nodes.find((node) => node.id === id);
  }
  private destructEdgeType(type: string | undefined) {
    let arrowTypeStart = 'none';
    let arrowTypeEnd = 'arrow_point';
    switch (type) {
      case 'arrow_open':
      case 'arrow_point':
      case 'arrow_circle':
      case 'arrow_cross':
        arrowTypeEnd = type;
        break;

      case 'double_arrow_point':
      case 'double_arrow_circle':
      case 'double_arrow_cross':
        arrowTypeStart = type.replace('double_', '');
        arrowTypeEnd = arrowTypeStart;
        break;
    }
    return { arrowTypeStart, arrowTypeEnd };
  }

  private addNodeFromVertex(
    vertex: FlowVertex,
    nodes: Node[],
    parentDB: Map<string, string>,
    subGraphDB: Map<string, boolean>,
    config: MermaidConfig,
    look: string
  ) {
    const parentId = parentDB.get(vertex.id);
    const isGroup = subGraphDB.get(vertex.id) ?? false;

    const node = this.findNode(nodes, vertex.id);
    if (node) {
      node.cssStyles = vertex.styles;
      node.cssCompiledStyles = this.getCompiledStyles(vertex.classes);
      node.cssClasses = vertex.classes.join(' ');
    } else {
      const baseNode = {
        id: vertex.id,
        label: vertex.text,
        labelType: vertex.labelType,
        labelStyle: '',
        parentId,
        padding: (config.flowchart as { padding?: number })?.padding ?? 8,
        cssStyles: vertex.styles,
        cssCompiledStyles: this.getCompiledStyles(['default', 'node', ...vertex.classes]),
        cssClasses: 'default ' + vertex.classes.join(' '),
        dir: vertex.dir,
        domId: vertex.domId,
        look,
        link: vertex.link,
        linkTarget: vertex.linkTarget,
        tooltip: this.getTooltip(vertex.id),
        icon: vertex.icon,
        pos: vertex.pos,
        img: vertex.img,
        assetWidth: vertex.assetWidth,
        assetHeight: vertex.assetHeight,
        constraint: vertex.constraint,
      };
      if (isGroup) {
        nodes.push({
          ...baseNode,
          isGroup: true,
          shape: 'rect',
        });
      } else {
        const shapeFromVertex = this.getTypeFromVertex(vertex);
        nodes.push({
          ...baseNode,
          isGroup: false,
          shape: shapeFromVertex,
          minWidth: config.flowchart?.minNodeWidth,
        });
      }
    }
  }

  private getCompiledStyles(classDefs: string[]) {
    let compiledStyles: string[] = [];
    for (const customClass of classDefs) {
      const cssClass = this.classes.get(customClass);
      if (cssClass?.styles) {
        compiledStyles = [...compiledStyles, ...(cssClass.styles ?? [])].map((s) => s.trim());
      }
      if (cssClass?.textStyles) {
        compiledStyles = [...compiledStyles, ...(cssClass.textStyles ?? [])].map((s) => s.trim());
      }
    }
    return compiledStyles;
  }

  public getData() {
    const config = getConfig();
    const nodes: Node[] = [];
    const edges: Edge[] = [];

    const subGraphs = this.getSubGraphs();
    const parentDB = new Map<string, string>();
    const subGraphDB = new Map<string, boolean>();

    // ── Collapsible subgraphs (issue #7784) ──────────────────────────────
    // A subgraph carrying `@{ view: collapsed }` is drawn as a single compact
    // node; its descendants are hidden and any edge that crosses the boundary
    // is redirected to the outermost collapsed ancestor.
    //
    // `subGraphParent` maps a subgraph id to the subgraph that directly
    // contains it, so we can walk up the containment chain to find the
    // outermost collapsed ancestor regardless of declaration order.
    const subGraphParent = new Map<string, string>();
    for (const sg of subGraphs) {
      for (const childId of sg.nodes) {
        if (this.subGraphLookup.has(childId)) {
          subGraphParent.set(childId, sg.id);
        }
      }
    }
    /* Colour slots follow the order the subgraphs appear in the source.
     *
     * `subGraphs` is not in that order: the grammar reduces a subgraph when it *closes*,
     * so a nested one lands before its parent -- `Outer { InnerOne, InnerTwo }, Sibling`
     * arrives as [InnerOne, InnerTwo, Outer, Sibling]. Taking the array index directly
     * would hand Outer slot 2 while its own children took 0 and 1.
     *
     * A pre-order walk of the containment forest recovers source order: roots complete in
     * source order relative to each other, and a parent is always declared before the
     * children it contains. Assigned once here so the collapsed and expanded branches
     * below cannot drift apart.
     */
    const declarationIndex = new Map<string, number>();
    const childrenOf = new Map<string, string[]>();
    for (const sg of subGraphs) {
      const parent = subGraphParent.get(sg.id);
      if (parent !== undefined) {
        childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), sg.id]);
      }
    }
    let nextDeclarationIndex = 0;
    const walk = (sgId: string) => {
      declarationIndex.set(sgId, nextDeclarationIndex++);
      for (const childId of childrenOf.get(sgId) ?? []) {
        walk(childId);
      }
    };
    for (const sg of subGraphs) {
      if (!subGraphParent.has(sg.id)) {
        walk(sg.id);
      }
    }

    const isCollapsed = (sgId: string) =>
      this.subGraphLookup.get(sgId)?.metadata?.view === 'collapsed';
    const outermostCollapsed = (sgId: string): string | undefined => {
      let result: string | undefined;
      const seen = new Set<string>();
      let current: string | undefined = sgId;
      while (current !== undefined && !seen.has(current)) {
        seen.add(current);
        if (isCollapsed(current)) {
          result = current;
        }
        current = subGraphParent.get(current);
      }
      return result;
    };

    // `hiddenIds` are nodes/subgraphs that are not drawn; `collapsedAncestorMap`
    // maps each hidden id to the visible collapsed node that replaces it.
    const hiddenIds = new Set<string>();
    const collapsedAncestorMap = new Map<string, string>();
    for (const sg of subGraphs) {
      const ancestor = outermostCollapsed(sg.id);
      if (ancestor === undefined) {
        continue;
      }
      // Hide the subgraph itself unless it is the visible collapsed node.
      if (sg.id !== ancestor) {
        hiddenIds.add(sg.id);
        collapsedAncestorMap.set(sg.id, ancestor);
      }
      // Hide every member, redirecting it to the visible collapsed node.
      for (const childId of sg.nodes) {
        if (childId === ancestor) {
          continue;
        }
        hiddenIds.add(childId);
        collapsedAncestorMap.set(childId, ancestor);
      }
    }

    // Setup the subgraph data for adding nodes
    for (let i = subGraphs.length - 1; i >= 0; i--) {
      const subGraph = subGraphs[i];
      if (hiddenIds.has(subGraph.id)) {
        continue;
      }
      if (subGraph.nodes.length > 0) {
        subGraphDB.set(subGraph.id, true);
      }
      for (const id of subGraph.nodes) {
        parentDB.set(id, subGraph.id);
      }
    }

    // Data is setup, add the nodes
    for (let i = subGraphs.length - 1; i >= 0; i--) {
      const subGraph = subGraphs[i];
      if (hiddenIds.has(subGraph.id)) {
        continue;
      }
      if (subGraph.metadata?.view === 'collapsed') {
        // Collapsed: draw as a single compact node instead of a container.
        nodes.push({
          id: subGraph.id,
          label: subGraph.title,
          labelStyle: '',
          labelType: subGraph.labelType,
          parentId: parentDB.get(subGraph.id),
          padding: 8,
          cssCompiledStyles: this.getCompiledStyles(subGraph.classes),
          cssClasses: subGraph.classes.join(' '),
          shape: 'collapsedGroup',
          dir: subGraph.dir,
          isGroup: false,
          look: config.look,
          // A collapsed subgraph still consumes its slot, so the cycle does not shift
          // when one is collapsed.
          colorIndex: declarationIndex.get(subGraph.id),
        });
      } else {
        nodes.push({
          id: subGraph.id,
          label: subGraph.title,
          labelStyle: '',
          labelType: subGraph.labelType,
          parentId: parentDB.get(subGraph.id),
          padding: 8,
          cssCompiledStyles: this.getCompiledStyles(subGraph.classes),
          cssClasses: subGraph.classes.join(' '),
          shape: 'rect',
          dir: subGraph.dir,
          isGroup: true,
          look: config.look,
          colorIndex: declarationIndex.get(subGraph.id),
          // Forwarded so layout engines can read per-container settings such as
          // `@{ algorithm: elk.box }`. `view` is consumed above; everything else
          // is opaque here and simply passed through. The cast is the
          // interface-vs-index-signature gap: `NodeMetaData` is an interface, so
          // it is not structurally assignable to `Record<string, unknown>`.
          metadata: subGraph.metadata as Record<string, unknown> | undefined,
        });
      }
    }

    const n = this.getVertices();
    n.forEach((vertex) => {
      // Skip vertices hidden inside a collapsed subgraph
      if (hiddenIds.has(vertex.id)) {
        return;
      }
      this.addNodeFromVertex(vertex, nodes, parentDB, subGraphDB, config, config.look || 'classic');
    });

    const e = this.getEdges();
    e.forEach((rawEdge, index) => {
      const { arrowTypeStart, arrowTypeEnd } = this.destructEdgeType(rawEdge.type);
      const styles = [...(e.defaultStyle ?? [])];

      // Redirect boundary-crossing edges to the visible collapsed node. An
      // edge that becomes a self-loop purely because both endpoints collapsed
      // into the same node (i.e. it was internal to a collapsed subgraph) is
      // dropped — self-loops on nodes that are not collapsed are preserved.
      const start = collapsedAncestorMap.get(rawEdge.start) ?? rawEdge.start;
      const end = collapsedAncestorMap.get(rawEdge.end) ?? rawEdge.end;
      if (
        start === end &&
        (collapsedAncestorMap.has(rawEdge.start) || collapsedAncestorMap.has(rawEdge.end))
      ) {
        return;
      }

      if (rawEdge.style) {
        styles.push(...rawEdge.style);
      }

      const edge: Edge = {
        id: getEdgeId(start, end, { counter: index, prefix: 'L' }, rawEdge.id),
        isUserDefinedId: rawEdge.isUserDefinedId,
        start,
        end,
        type: rawEdge.type ?? 'normal',
        label: rawEdge.text,
        labelType: rawEdge.labelType,
        labelpos: 'c',
        thickness: rawEdge.stroke,
        minlen: rawEdge.length,
        classes:
          rawEdge?.stroke === 'invisible'
            ? ''
            : 'edge-thickness-normal edge-pattern-solid flowchart-link',
        arrowTypeStart:
          rawEdge?.stroke === 'invisible' || rawEdge?.type === 'arrow_open'
            ? 'none'
            : arrowTypeStart,
        arrowTypeEnd:
          rawEdge?.stroke === 'invisible' || rawEdge?.type === 'arrow_open' ? 'none' : arrowTypeEnd,
        arrowheadStyle: 'fill: #333',
        cssCompiledStyles: this.getCompiledStyles(rawEdge.classes),
        labelStyle: styles,
        style: styles,
        pattern: rawEdge.stroke,
        look: config.look,
        showPoints: config.flowchart?.edgeDebug,
        animate: rawEdge.animate,
        animation: rawEdge.animation,
        curve: rawEdge.interpolate ?? this.edges.defaultInterpolate ?? config.flowchart?.curve,
      };

      edges.push(edge);
    });

    return { nodes, edges, other: {}, config };
  }

  public defaultConfig() {
    return defaultConfig.flowchart;
  }
  public setAccTitle = setAccTitle;
  public setAccDescription = setAccDescription;
  public setDiagramTitle = setDiagramTitle;
  public getAccTitle = getAccTitle;
  public getAccDescription = getAccDescription;
  public getDiagramTitle = getDiagramTitle;
}
