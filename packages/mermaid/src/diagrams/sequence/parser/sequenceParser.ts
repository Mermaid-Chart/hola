import type { ParserDefinition } from '../../../diagram-api/types.js';
import antlrParser from './antlr/antlr-parser.js';

// Create a wrapper that provides the expected interface (same pattern as flowchart)
const newParser = {
  parser: antlrParser,
  parse: (src: string): void => {
    antlrParser.parse(src);
  },
  features: {
    processRawText: true,
  },
} satisfies ParserDefinition;

export default newParser;
