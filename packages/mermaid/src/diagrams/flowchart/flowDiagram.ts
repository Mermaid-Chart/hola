import type { DiagramDefinition } from '../../diagram-api/types.js';
import type { MermaidConfig } from '../../config.type.js';
import { getUserDefinedConfig } from '../../config.js';
import { setConfig } from '../../diagram-api/diagramAPI.js';
import { FlowDB } from './flowDb.js';
import renderer from './flowRenderer-v3-unified.js';
import jisonParser from './parser/flowParser.js';
import antlrParser from './parser/flowAntlrParser.js';
import flowStyles from './styles.js';

interface FlowDiagramOptions {
  defaultLayout?: string;
  styles?: typeof flowStyles;
}

export const createFlowDiagram = ({
  defaultLayout,
  styles = flowStyles,
}: FlowDiagramOptions = {}): DiagramDefinition => ({
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
  styles,
  init: (cnf: MermaidConfig) => {
    if (!cnf.flowchart) {
      cnf.flowchart = {};
    }
    const layout = getUserDefinedConfig().layout ?? defaultLayout ?? cnf.layout;
    if (layout) {
      setConfig({ layout });
    }
    cnf.flowchart.arrowMarkerAbsolute = cnf.arrowMarkerAbsolute;
    setConfig({ flowchart: { arrowMarkerAbsolute: cnf.arrowMarkerAbsolute } });
  },
});

export const diagram = createFlowDiagram();
