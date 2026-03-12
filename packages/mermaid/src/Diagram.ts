import * as configApi from './config.js';
import { getDiagram, registerDiagram } from './diagram-api/diagramAPI.js';
import { detectType, getDiagramLoader } from './diagram-api/detectType.js';
import { UnknownDiagramError } from './errors.js';
import { encodeEntities } from './utils.js';
import { log } from './logger.js';
import type { DetailedError } from './utils.js';
import type { DiagramCode, DiagramDefinition, DiagramMetadata } from './diagram-api/types.js';
import type { BaseDiagramConfig, MermaidConfig } from './config.type.js';

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
export type ParseErrorFunction = (err: string | DetailedError | unknown, hash?: any) => void;

/**
 * An object representing a parsed mermaid diagram definition.
 * @privateRemarks This is exported as part of the public mermaidAPI.
 */
export class Diagram {
  public static async fromText(
    codeObjectOrText: DiagramCode | string,
    metadata: Pick<DiagramMetadata, 'title'> = {}
  ) {
    const code =
      typeof codeObjectOrText === 'string'
        ? { raw: codeObjectOrText, cleaned: codeObjectOrText }
        : codeObjectOrText;
    const config = configApi.getConfig();
    const type = detectType(code.cleaned, config);
    try {
      getDiagram(type);
    } catch {
      const loader = getDiagramLoader(type);
      if (!loader) {
        throw new UnknownDiagramError(`Diagram ${type} not found.`);
      }
      // Diagram not available, loading it.
      // new diagram will try getDiagram again and if fails then it is a valid throw
      const { id, diagram } = await loader();
      registerDiagram(id, diagram);
    }
    const { db, parser: defaultParser, renderer, init, getParser } = getDiagram(type);
    // Check if a parser is configured for this diagram type
    // Map diagram type to config key (e.g., 'flowchart-v2' -> 'flowchart')
    const configKey = type.replace(/-v2$/, '') as keyof MermaidConfig;
    const parserInConfig = (config[configKey] as BaseDiagramConfig)?.parser;
    // If a parser is configured, use the getParser function to get the parser instance
    const parser = (parserInConfig && getParser?.(parserInConfig)) ?? defaultParser;
    if (parser.parser) {
      // The parser.parser.yy is only present in JISON parsers. So, we'll only set if required.
      parser.parser.yy = db;
    }
    db.clear?.();
    init?.(config);
    // This block was added for legacy compatibility. Use frontmatter instead of adding more special cases.
    if (metadata.title) {
      db.setDiagramTitle?.(metadata.title);
    }
    // For flowcharts, use text with comments preserved so that Jison @$ positions
    // are in original-text space. The flowchart Jison grammar handles %% comments
    // natively. For all other diagram types, use the cleaned text (comments stripped).
    const dbAny = db as Record<string, unknown>;
    const supportsInlinePositions = typeof dbAny.setSourceText === 'function';
    let textToParse: string;
    if (parser.features?.processRawText) {
      textToParse = encodeEntities(code.raw) + '\n';
    } else if (supportsInlinePositions && code.withComments) {
      textToParse = encodeEntities(code.withComments) + '\n';
    } else {
      textToParse = encodeEntities(code.cleaned) + '\n';
    }
    // Pass frontmatter line offset so AST positions can be adjusted
    // to match the original source (which includes frontmatter) shown in the editor.
    if (
      supportsInlinePositions &&
      code.frontmatterLineOffset &&
      typeof dbAny.setFrontmatterLineOffset === 'function'
    ) {
      (dbAny.setFrontmatterLineOffset as (offset: number) => void)(code.frontmatterLineOffset);
    }
    await parser.parse(textToParse);
    return new Diagram(type, textToParse, db, parser, renderer);
  }

  private constructor(
    public type: string,
    public text: string,
    public db: DiagramDefinition['db'],
    public parser: DiagramDefinition['parser'],
    public renderer: DiagramDefinition['renderer']
  ) {}

  async render(id: string, version: string, positions?: any) {
    const config = configApi.getConfig();
    if (config.securityLevel === 'parseOnly') {
      log.warn('Cannot render diagram in parseOnly mode');
      return;
    }
    await this.renderer.draw(this.text, id, version, this, positions);
  }

  getParser() {
    return this.parser;
  }

  getType() {
    return this.type;
  }
}
