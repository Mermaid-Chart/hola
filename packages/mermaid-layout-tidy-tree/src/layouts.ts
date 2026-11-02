import type { LayoutLoaderDefinition } from '@mermaid-chart/mermaid';

const loader = async () => await import(`./render.js`);

const tidyTreeLayout: LayoutLoaderDefinition[] = [
  {
    name: 'tidy-tree',
    loader,
    algorithm: 'tidy-tree',
  },
];

export default tidyTreeLayout;
