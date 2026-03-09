import type { ParserDefinition } from '../../../diagram-api/types.js';
import { ANTLRFlowParser } from './antlr/antlr-parser.js';

// Create a singleton instance of the ANTLR parser
const antlrParser = new ANTLRFlowParser();

// Create a wrapper that provides the expected interface (same pattern as sequence)
const newParser = {
  parser: antlrParser,
  parse: (src: string): void => {
    // remove the trailing whitespace after closing curly braces when ending a line break
    const newSrc = src.replaceAll(/}\s*\n/g, '}\n');
    antlrParser.parse(newSrc);
  },
  features: {
    // Use raw text for ANTLR parser to preserve comments and blank lines
    processRawText: true,
  },
} satisfies ParserDefinition;

export default newParser;
