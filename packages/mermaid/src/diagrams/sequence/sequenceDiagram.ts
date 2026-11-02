import type { DiagramDefinition } from '../../diagram-api/types.js';
// @ts-ignore: JISON doesn't support types
import jisonParser from './parser/sequenceDiagram.jison';
import antlrParser from './parser/sequenceParser.js';
import { SequenceDB } from './sequenceDb.js';
import styles from './styles.js';
import { setConfig } from '../../diagram-api/diagramAPI.js';
import renderer from './sequenceRenderer.js';
import type { MermaidConfig } from '../../config.type.js';

export const diagram: DiagramDefinition = {
  parser: jisonParser,
  getParser: (parser: string) => {
    if (parser === 'antlr') {
      return antlrParser;
    }
    return jisonParser;
  },
  get db() {
    return new SequenceDB();
  },
  renderer,
  styles,
  init: (cnf: MermaidConfig) => {
    cnf.sequence ??= {};
    if (cnf.wrap) {
      cnf.sequence.wrap = cnf.wrap;
      setConfig({ sequence: { wrap: cnf.wrap } });
    }
  },
};
