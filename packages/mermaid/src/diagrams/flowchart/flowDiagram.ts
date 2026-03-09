import type { DiagramDefinition } from '../../diagram-api/types.js';
import type { MermaidConfig } from '../../config.type.js';
import { setConfig } from '../../diagram-api/diagramAPI.js';
import { FlowDB } from './flowDb.js';
import renderer from './flowRenderer-v3-unified.js';
import jisonParser from './parser/flowParser.js';
import antlrParser from './parser/flowAntlrParser.js';
import flowStyles from './styles.js';

export const diagram: DiagramDefinition = {
  parser: jisonParser,
  getParser: (parser: string) => {
    if (parser === 'antlr') {
      return antlrParser;
    }
    return jisonParser;
  },
  get db() {
    return new FlowDB();
  },
  renderer,
  styles: flowStyles,
  init: (cnf: MermaidConfig) => {
    cnf.flowchart ??= {};
    if (cnf.layout) {
      setConfig({ layout: cnf.layout });
    }
    cnf.flowchart.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
    setConfig({ flowchart: { arrowMarkerAbsolute: cnf.arrowMarkerAbsolute } });
  },
};
