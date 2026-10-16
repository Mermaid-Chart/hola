import { describe, expect, it } from 'vitest';
import { DEV_EXPLORER_LAYOUTS, isDevExplorerLayout } from './layouts.js';

describe('Dev Explorer layout options', () => {
  it('exposes stress-and-grid anywhere a layout can be selected', () => {
    expect(DEV_EXPLORER_LAYOUTS).toContain('stress-and-grid');
    expect(isDevExplorerLayout('stress-and-grid')).toBe(true);
  });
});
