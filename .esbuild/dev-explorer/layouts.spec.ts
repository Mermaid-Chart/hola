import { describe, expect, it } from 'vitest';
import { DEV_EXPLORER_LAYOUTS, isDevExplorerLayout } from './layouts.js';

describe('Dev Explorer layout options', () => {
  it('exposes gipsec anywhere a layout can be selected', () => {
    expect(DEV_EXPLORER_LAYOUTS).toContain('gipsec');
    expect(isDevExplorerLayout('gipsec')).toBe(true);
  });
});
