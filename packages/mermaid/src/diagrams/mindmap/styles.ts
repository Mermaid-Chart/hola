// @ts-expect-error Incorrect khroma types
import { darken, lighten, isDark } from 'khroma';
import type { DiagramStylesProvider } from '../../diagram-api/types.js';
import * as configApi from '../../config.js';

const config = configApi.getConfig();
const { theme, look } = config;

const genSections: DiagramStylesProvider = (options) => {
  let sections = '';

  for (let i = 0; i < options.THEME_COLOR_LIMIT; i++) {
    options['lineColor' + i] = options['lineColor' + i] || options['cScaleInv' + i];
    if (isDark(options['lineColor' + i])) {
      options['lineColor' + i] = lighten(options['lineColor' + i], 20);
    } else {
      options['lineColor' + i] = darken(options['lineColor' + i], 20);
    }
  }

  for (let i = 0; i < options.THEME_COLOR_LIMIT; i++) {
    const m = look === 'neo' ? 1.5 : 1;
    const sw = '' + (17 - 3 * (i * m));
    sections += `
    .section-${i - 1} rect, .section-${i - 1} path, .section-${i - 1} circle, .section-${
      i - 1
    } polygon, .section-${i - 1} path  {
      fill: ${options['cScale' + i]};
    }
    .section-${i - 1} text {
     fill: ${options['cScaleLabel' + i]};
    }
    .node-icon-${i - 1} {
      font-size: 40px;
      color: ${options['cScaleLabel' + i]};
    }
    .section-edge-${i - 1}{
      stroke: ${options['cScale' + i]};
    }
    .edge-depth-${i - 1}{
      stroke-width: ${sw};
    }
    .section-${i - 1} line {
      stroke: ${options['cScaleInv' + i]} ;
      stroke-width: 3;
    }

    .disabled, .disabled circle, .disabled text {
      fill: lightgray;
    }
    .disabled text {
      fill: #efefef;
    }
    [data-look="neo"].section-${i - 1} rect, .section-${i - 1} path, .section-${i - 1} circle, .section-${i - 1} polygon, .section-${i - 1} path {
      fill: ${theme === 'redux' || theme === 'redux-dark' ? options.mainBkg : options['cScale' + i]};
      stroke: ${theme === 'redux' || theme === 'redux-dark' ? options.nodeBorder : options['cScale' + i]};
      stroke-width:${options.strokeWidth};
    }
    [data-look="neo"].section-edge-${i - 1}{
      stroke: ${theme?.includes('redux') ? options.nodeBorder : options['cScale' + i]};
    }
    [data-look="neo"].section-${i - 1} text {
     fill: ${theme === 'redux' || theme === 'redux-dark' ? options.nodeBorder : options['cScaleLabel' + i]};
    }
    `;
  }
  return sections;
};

// TODO: These options seem incorrect.
const getStyles: DiagramStylesProvider = (options) =>
  `
  .edge {
    stroke-width: 3;
  }
  ${genSections(options)}
  .section-root rect, .section-root path, .section-root circle, .section-root polygon  {
    fill: ${options.git0};
  }
  .section-root text {
    fill: ${options.gitBranchLabel0};
  }
  .icon-container {
    height:100%;
    display: flex;
    justify-content: center;
    align-items: center;
  }
  .edge {
    fill: none;
  }
  .mindmap-node-label {
    dy: 1em;
    alignment-baseline: middle;
    text-anchor: middle;
    dominant-baseline: middle;
    text-align: center;
  }
  [data-look="neo"].mindmap-node  {
    filter: ${options.dropShadow};
  }
  [data-look="neo"].section-root rect, .section-root path, .section-root circle, .section-root polygon  {
    fill: ${theme?.includes('redux') ? options.mainBkg : options.git0};
  }
  [data-look="neo"].section-root .text-inner-tspan {
    fill:  ${theme?.includes('redux') ? options.nodeBorder : options['cScaleLabel' + 0]};
  }
`;
export default getStyles;
