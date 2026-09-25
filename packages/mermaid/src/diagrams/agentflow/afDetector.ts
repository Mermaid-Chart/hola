import type {
  DiagramDetector,
  DiagramLoader,
  ExternalDiagramDefinition,
} from '../../diagram-api/types.js';

const id = 'agentflow';

// `agentflow-beta` is the documented header; plain `agentflow` is accepted too
// because every document from the 11.15 line starts that way (issue #159).
// The `\b` keeps longer words that merely start with `agentflow` out.
const detector: DiagramDetector = (txt) => {
  return /^\s*agentflow(-beta)?\b/.test(txt);
};

const loader: DiagramLoader = async () => {
  const { diagram } = await import('./diagram.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default plugin;
