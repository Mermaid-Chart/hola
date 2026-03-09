// @ts-ignore: JISON doesn't support types
import flowJisonParser from './flow.jison';

// Create a wrapper that provides the expected interface for the Jison parser
// Parser selection (jison vs antlr) is handled by getParser() in flowDiagram.ts based on config
const newParser = { ...flowJisonParser };

newParser.parse = (src: string): unknown => {
  // remove the trailing whitespace after closing curly braces when ending a line break
  const newSrc = src.replaceAll(/}\s*\n/g, '}\n');
  return flowJisonParser.parse(newSrc);
};

export default newParser;
