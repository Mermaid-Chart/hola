interface CaptionDimensions {
  width: number;
  height: number;
}

/**
 * Fallback geometry before a renderer has measured the caption. Keep the same
 * HTML-break handling and minimum band in placement and routing.
 * Empty captions are filtered by callers; an empty fallback still reserves a band.
 */
export function estimateCaptionDimensions(label: string): CaptionDimensions {
  const lines = label
    .replace(/<br\s*\/?\s*>/giu, '\n')
    .replace(/<[^>]+>/gu, '')
    .split('\n');
  return {
    width: Math.max(40, ...lines.map((line) => line.trim().length * 8)),
    height: lines.length * 24,
  };
}

/**
 * Select the reservation policy explicitly. Wrapped renderer measurements are
 * authoritative for workflow/routing plans. Nested frame entries retain their
 * conservative lower bound until that policy is changed separately.
 * Invalid dimensions are left to each plan's existing admission guard.
 */
export function captionDimensions(
  label: string,
  measured: Partial<CaptionDimensions>,
  policy: 'renderer' | 'conservative'
): CaptionDimensions {
  const estimated = estimateCaptionDimensions(label);
  const span = (axis: keyof CaptionDimensions) =>
    policy === 'conservative'
      ? Math.max(measured[axis] ?? 0, estimated[axis])
      : (measured[axis] ?? 0) > 0
        ? measured[axis]!
        : estimated[axis];
  return { width: span('width'), height: span('height') };
}
