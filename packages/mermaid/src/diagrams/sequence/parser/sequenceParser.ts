import type { ParserDefinition } from '../../../diagram-api/types.js';
import antlrParser from './antlr/antlr-parser.js';

// Create a wrapper that provides the expected interface (same pattern as flowchart)
const newParser = {
  parser: antlrParser,
  parse: (src: string) => {
    // Normalize whitespace like flow does to keep parity with Jison behavior
    const newSrc = src.replace(/}\s*\n/g, '}\n');
    return antlrParser.parse(newSrc);
  },
  features: {
    processRawText: true,
  },
} satisfies ParserDefinition;

export default newParser;
