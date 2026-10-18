import { describe, expect, it, vi } from 'vitest';
import type { LayoutData } from '../../types.js';
import type { CommonLayoutRendererDefinition, CommonLayoutRenderContext } from '../common/index.js';
import type { GridLikeLayoutResult } from '../hola/grid/layoutCore.js';
import { runStressAndGridLayoutCore } from './index.js';

const createRenderer = vi.hoisted(() =>
  vi.fn<(definition: CommonLayoutRendererDefinition<GridLikeLayoutResult>) => () => void>(
    () => () => undefined
  )
);

vi.mock('../common/index.js', () => ({ createCommonLayoutRenderer: createRenderer }));

const definition = createRenderer.mock.calls[0][0];

function diagram(): LayoutData {
  return {
    direction: 'TB',
    config: {},
    nodes: [{ id: 'member', isGroup: false, shape: 'rect', width: 80, height: 40 }],
    edges: [],
  };
}

describe('gipsec renderer/core boundary', () => {
  it('does not forward DOM render context as numerical layout overrides', async () => {
    const actualData = diagram();
    const expectedData = diagram();
    const context: CommonLayoutRenderContext<void> = {
      element: {} as CommonLayoutRenderContext['element'],
      options: {},
    };
    const actual = await definition.runLayoutCore(actualData, context);
    const expected = runStressAndGridLayoutCore(expectedData);

    expect(actual.options).toEqual(expected.options);
    expect(actualData).toEqual(expectedData);
  });

  it('still allows numerical overrides through the pure core API', () => {
    expect(runStressAndGridLayoutCore(diagram(), { gridSpacing: 96 }).options.gridSpacing).toBe(96);
  });
});
