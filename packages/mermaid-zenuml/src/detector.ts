import type { ExternalDiagramDefinition } from '@mermaid-chart/mermaid';

const id = 'zenuml';

const detector = (txt: string) => {
  return /^\s*zenuml/.test(txt);
};

const loader = async () => {
  const { diagram } = await import('./zenuml-definition.js');
  return { id, diagram };
};

const plugin: ExternalDiagramDefinition = {
  id,
  detector,
  loader,
};

export default plugin;
