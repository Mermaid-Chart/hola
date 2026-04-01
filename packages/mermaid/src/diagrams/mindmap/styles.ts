// @ts-expect-error Incorrect khroma types
import { darken, lighten, isDark } from 'khroma';
import type { DiagramStylesProvider } from '../../diagram-api/types.js';

/**
 * Generates CSS styles for mindmap sections based on theme colors and styling options.
 *
 * This function creates color-based sections that apply different styling to mindmap nodes
 * depending on their hierarchical level. It handles both standard and 'neo' look variants,
 * adjusting line colors for better contrast and generating appropriate stroke widths.
 *
 * @param options - Styling options containing theme colors, look preference, and color limits
 * @returns CSS string containing section-specific styles for hierarchical mindmap sections
 */
const genSections: DiagramStylesProvider = (options) => {
  const { look, theme } = options;

  let sections = '';

  // Adjust line colors for better contrast based on background darkness
  for (let i = 0; i < options.THEME_COLOR_LIMIT; i++) {
    // Fallback to inverted color scale if line color is not defined
    options['lineColor' + i] = options['lineColor' + i] || options['cScaleInv' + i];
    if (isDark(options['lineColor' + i])) {
      options['lineColor' + i] = lighten(options['lineColor' + i], 20);
    } else {
      options['lineColor' + i] = darken(options['lineColor' + i], 20);
    }
  }

  // Generate CSS for each section with appropriate stroke widths
  for (let i = 0; i < options.THEME_COLOR_LIMIT; i++) {
    // Calculate stroke width: neo look uses decreasing width per level, standard uses fixed calculation
    const sw = '' + (look === 'neo' ? Math.max(10 - i * 2, 2) : 17 - 3 * i);
    sections += `
    .section-${i - 1} rect, .section-${i - 1} path, .section-${i - 1} circle, .section-${
      i - 1
    } polygon, .section-${i - 1} path  {
      fill: ${options['cScale' + i]};
    }
    .section-${i - 1} text {
     fill: ${options['cScaleLabel' + i]};
    }
     .section-${i - 1} span {
     color: ${options['cScaleLabel' + i]};
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
      fill: ${theme === 'redux' || theme === 'redux-dark' || theme === 'neutral' ? options.mainBkg : options['cScale' + i]};
      stroke: ${theme === 'redux' || theme === 'redux-dark' ? options.nodeBorder : options['cScale' + i]};
      stroke-width:${options.strokeWidth};
    }
    [data-look="neo"].section-edge-${i - 1}{
      stroke: ${theme?.includes('redux') || theme === 'neo-dark' ? options.nodeBorder : options['cScale' + i]};
    }
    [data-look="neo"].section-${i - 1} text {
     fill: ${theme === 'redux' || theme === 'redux-dark' ? options.nodeBorder : options['cScaleLabel' + (theme === 'neutral' ? 1 : i)]};
    }
    `;
  }
  return sections;
};

const genGradient = (THEME_COLOR_LIMIT: number, svgId: string, mainBkg: string) => {
  let sections = '';
  for (let i = 0; i < THEME_COLOR_LIMIT; i++) {
    sections += `
    [data-look="neo"].mindmap-node.section-${i - 1} rect, [data-look="neo"].mindmap-node.section-${i - 1} path, [data-look="neo"].mindmap-node.section-${i - 1} circle, [data-look="neo"].mindmap-node.section-${i - 1} polygon {
      stroke: url(${svgId}-gradient);
      fill: ${mainBkg};
    }
    .section-${i - 1} line {
      stroke-width: 0;
    }`;
  }
  return sections;
};

/**
 * Generates the main CSS styles for mindmap diagrams.
 *
 * This is the primary style provider function that combines section-specific styles
 * with base mindmap styling. It handles theme variations, drop shadows, gradients,
 * and coordinates with the overall Mermaid theming system.
 *
 * @param options - Complete styling options including theme, colors, and SVG context
 * @returns Complete CSS string for mindmap diagram rendering
 */
const getStyles: DiagramStylesProvider = (options) => {
  const { theme } = options;
  // svgId is passed inside options by the caller in packages/mermaid/src/styles.ts
  // as `themes[type]({ ...options, svgId })`. The second parameter is never populated.
  const svgId: string | undefined = options.svgId;
  const scopedDropShadow = options.dropShadow
    ? options.dropShadow.replace('url(#drop-shadow)', `url(${svgId}-drop-shadow)`)
    : 'none';

  return `
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
  .section-root span {
    color: ${theme?.includes('redux') ? options.nodeBorder : options.gitBranchLabel0};
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
    filter: ${scopedDropShadow};
  }
  [data-look="neo"].mindmap-node.section-root rect, [data-look="neo"].mindmap-node.section-root path, [data-look="neo"].mindmap-node.section-root circle, [data-look="neo"].mindmap-node.section-root polygon  {
    fill: ${theme?.includes('redux') ? options.mainBkg : options.git0};
  }
  [data-look="neo"].mindmap-node.section-root .text-inner-tspan {
    fill:  ${theme?.includes('redux') ? options.nodeBorder : options['cScaleLabel' + (theme === 'neutral' ? 1 : 0)]};
  }
  ${options.useGradient && svgId && options.mainBkg ? genGradient(options.THEME_COLOR_LIMIT, svgId, options.mainBkg) : ''}
`;
};
export default getStyles;
