import { describe, expect, it } from 'vitest';
import type { LayoutData } from './types.js';
import type { SVG } from '../diagram-api/types.js';
import {
  getLayoutLoaderDefinition,
  getRegisteredLayoutAlgorithm,
  registerLayoutLoaders,
  render,
} from './render.js';
import { ELK_ALGORITHMS } from './layout-algorithms/elk/algorithms.js';

// `injected.includeLargeFeatures` is defined as `true` for the unit-test build
// (see vite.config.ts), so the ELK loaders are registered here. The tiny build
// flips that flag and is covered by the bundle assertions in .esbuild.
describe('default layout loaders', () => {
  it('registers elk alongside the built-in layouts', () => {
    expect(getRegisteredLayoutAlgorithm('elk')).toBe('elk');
    expect(getRegisteredLayoutAlgorithm('dagre')).toBe('dagre');
    expect(getRegisteredLayoutAlgorithm('swimlane')).toBe('swimlane');
  });

  it.each(ELK_ALGORITHMS)('registers the %s algorithm under its own name', (algorithm) => {
    expect(getRegisteredLayoutAlgorithm(algorithm)).toBe(algorithm);
  });

  it('falls back to dagre for a layout that was never registered', () => {
    expect(getRegisteredLayoutAlgorithm('does-not-exist')).toBe('dagre');
  });

  // Registration only records a name; this proves the lazy import behind it
  // resolves to a real layout module now that ELK lives inside the package.
  it('lazily loads a renderable elk module', async () => {
    const elk = await getLayoutLoaderDefinition('elk').loader();
    expect(typeof elk.render).toBe('function');
  });

  it('points every elk algorithm at the same loader', () => {
    const loaders = new Set(
      ['elk', 'elk.stress', 'elk.force', 'elk.mrtree'].map(
        (name) => getLayoutLoaderDefinition(name).loader
      )
    );
    expect(loaders.size).toBe(1);
  });

  // The standalone plugin entry declares its own loader so the tiny build can
  // compile core's away, which means the two lists could drift apart. They must
  // register exactly the same layout names.
  it('registers the same elk layouts as the standalone plugin entry', async () => {
    const pluginLayouts = (await import('./layout-algorithms/elk/plugin.js')).default;
    const expected = ['elk', ...ELK_ALGORITHMS];
    expect(pluginLayouts.map((layout) => layout.name)).toEqual(expected);
    for (const { name, algorithm } of pluginLayouts) {
      expect(getLayoutLoaderDefinition(name).algorithm).toBe(algorithm);
    }
  });

  it('maps the bare elk name to the layered algorithm', () => {
    expect(getLayoutLoaderDefinition('elk').algorithm).toBe('elk.layered');
    expect(getLayoutLoaderDefinition('elk.mrtree').algorithm).toBe('elk.mrtree');
  });
});

/**
 * `positions` is a legacy affordance that predates hola and gipsec. It must not
 * reach them — including when the structural gate has just redirected one of
 * them to ELK, since the diagram still asked for a grid-like layout.
 */
describe('positions are withheld from the grid-like layouts', () => {
  /** Registers `name` behind a loader that records the positions it was handed. */
  function spyLayout(name: string) {
    const seen: { positions?: unknown; calls: number } = { calls: 0 };
    registerLayoutLoaders([
      {
        name,
        // Neither function awaits anything, so both return their promise
        // directly rather than being `async` — `require-await` rejects an async
        // function with no await in it.
        loader: () =>
          Promise.resolve({
            render: (_data, _svg, _helpers, _options, positions) => {
              seen.calls += 1;
              seen.positions = positions;
              return Promise.resolve();
            },
          }),
      },
    ]);
    return seen;
  }

  /** A path: planar, low-degree, no subgraphs, so the structural gate leaves it be. */
  function plainGraph(layoutAlgorithm: string): LayoutData {
    return {
      layoutAlgorithm,
      nodes: [
        { id: 'a', isGroup: false },
        { id: 'b', isGroup: false },
      ],
      edges: [{ id: 'e0', start: 'a', end: 'b' }],
      config: {},
    } as unknown as LayoutData;
  }

  /** K3,3 — non-planar, so the gate redirects a grid-like layout away from it. */
  function nonPlanarGraph(layoutAlgorithm: string): LayoutData {
    const nodes = ['a1', 'a2', 'a3', 'b1', 'b2', 'b3'].map((id) => ({ id, isGroup: false }));
    const edges = [];
    for (const a of ['a1', 'a2', 'a3']) {
      for (const b of ['b1', 'b2', 'b3']) {
        edges.push({ id: `${a}-${b}`, start: a, end: b });
      }
    }
    return { layoutAlgorithm, nodes, edges, config: {} } as unknown as LayoutData;
  }

  /**
   * A chainable stand-in for the d3 selection `insertLookDefs` decorates. Every
   * method returns the same object, which is all that code needs to run through.
   */
  function fakeSvg(): SVG {
    const selection: Record<string, unknown> = {};
    selection.attr = () => selection;
    selection.append = () => selection;
    selection.insert = () => selection;
    return selection as unknown as SVG;
  }

  const svg = fakeSvg();
  const positions = { a: { x: 1, y: 2 } } as unknown as Parameters<typeof render>[2];

  it.each(['hola', 'gipsec'])('withholds positions from %s', async (layout) => {
    const seen = spyLayout(layout);
    await render(plainGraph(layout), svg, positions);
    expect(seen.calls).toBe(1);
    expect(seen.positions).toBeUndefined();
  });

  it('still passes positions to a layout that is not grid-like', async () => {
    const seen = spyLayout('spy-not-grid-like');
    await render(plainGraph('spy-not-grid-like'), svg, positions);
    expect(seen.calls).toBe(1);
    expect(seen.positions).toBe(positions);
  });

  // The redirect rewrites layoutAlgorithm to elk, so reading the decision after
  // the gate instead of before it would hand ELK the positions hola was denied.
  it('withholds positions when the gate redirects hola to elk', async () => {
    const seen = spyLayout('elk');
    const data = nonPlanarGraph('hola');
    await render(data, svg, positions);
    expect(data.layoutAlgorithm).toBe('elk');
    expect(seen.calls).toBe(1);
    expect(seen.positions).toBeUndefined();
  });
});
