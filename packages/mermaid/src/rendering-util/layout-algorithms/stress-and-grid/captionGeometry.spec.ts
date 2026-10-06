import { describe, expect, it } from 'vitest';
import { captionDimensions, estimateCaptionDimensions } from './captionGeometry.js';

describe('shared caption dimensions', () => {
  it.each([
    ['', 40, 24],
    ['Yes', 40, 24],
    ['  messages  ', 64, 24],
    ['<b>messages</b>', 64, 24],
    ['long caption\nshort', 96, 48],
    ['long caption<br>short', 96, 48],
    ['long caption<BR />short', 96, 48],
    ['first<br/>second<br />third', 48, 72],
    ['\n', 40, 48],
  ] as const)('estimates %j without DOM measurements', (label, width, height) => {
    expect(estimateCaptionDimensions(label)).toEqual({ width, height });
  });

  it('keeps wrapped renderer measurements authoritative when requested', () => {
    const label = 'a long caption whose rendered text wraps';
    const measured = { width: 80, height: 96 };
    expect(captionDimensions(label, measured, 'renderer')).toEqual(measured);
    // Nested frame entries historically reserve at least the text estimate.
    expect(captionDimensions(label, measured, 'conservative')).toEqual({
      width: label.length * 8,
      height: 96,
    });
  });

  it.each([undefined, 0, -1, NaN])(
    'estimates missing/nonpositive renderer dimensions (%s)',
    (size) => {
      expect(captionDimensions('messages', { width: size, height: size }, 'renderer')).toEqual({
        width: 64,
        height: 24,
      });
    }
  );

  it('chooses measurements independently on each axis', () => {
    expect(captionDimensions('messages<br/>next', { width: 120 }, 'renderer')).toEqual({
      width: 120,
      height: 48,
    });
    expect(captionDimensions('messages<br/>next', { height: 12 }, 'renderer')).toEqual({
      width: 64,
      height: 12,
    });
    expect(captionDimensions('messages<br/>next', { height: 12 }, 'conservative')).toEqual({
      width: 64,
      height: 48,
    });
  });

  it('preserves conservative nonfinite propagation for callers to reject', () => {
    expect(captionDimensions('messages', { width: NaN }, 'conservative').width).toBeNaN();
    for (const policy of ['renderer', 'conservative'] as const) {
      expect(captionDimensions('messages', { width: Infinity }, policy).width).toBe(Infinity);
    }
  });

  it('does not mutate measurements', () => {
    const measured = Object.freeze({ width: 80, height: 96 });
    captionDimensions('caption', measured, 'renderer');
    captionDimensions('caption', measured, 'conservative');
    expect(measured).toEqual({ width: 80, height: 96 });
  });
});
