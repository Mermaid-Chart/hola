import { describe, expect, it } from 'vitest';
import { compareBase, nextAlpha, parseVersion } from './version.mjs';

describe('parseVersion', () => {
  it.each([
    ['11.17.1-a.2', { base: '11.17.1', tag: 'a', n: 2 }],
    ['11.17.1-b.0', { base: '11.17.1', tag: 'b', n: 0 }],
    ['0.2.3', { base: '0.2.3', tag: null, n: null }],
    ['11.15.0-a.10', { base: '11.15.0', tag: 'a', n: 10 }],
  ])('parses %s', (input, expected) => {
    expect(parseVersion(input)).toStrictEqual(expected);
  });

  it('rejects a version it cannot parse', () => {
    expect(() => parseVersion('not-a-version')).toThrow(/Cannot parse version/);
  });
});

describe('compareBase', () => {
  it('orders by major, then minor, then patch', () => {
    expect(compareBase('11.18.0', '11.17.1')).toBe(1);
    expect(compareBase('12.0.0', '11.17.1')).toBe(1);
    expect(compareBase('11.17.1', '11.17.0')).toBe(1);
    expect(compareBase('11.17.1', '11.17.1')).toBe(0);
    expect(compareBase('11.17.0', '11.17.1')).toBe(-1);
  });

  it('compares numerically, not lexically', () => {
    // '9' > '10' as strings, but 9 < 10 as numbers.
    expect(compareBase('11.9.0', '11.10.0')).toBe(-1);
  });
});

describe('nextAlpha', () => {
  it('adopts a higher upstream base and restarts the counter', () => {
    // The cases from the plan: a minor and a major upstream jump both land on -a.0.
    expect(nextAlpha('11.17.1-a.2', '11.18.0').version).toBe('11.18.0-a.0');
    expect(nextAlpha('11.17.1-a.2', '12.0.0').version).toBe('12.0.0-a.0');
    // A patch bump upstream counts too.
    expect(nextAlpha('11.17.1-a.2', '11.17.2').version).toBe('11.17.2-a.0');
  });

  it('bumps the alpha counter when the fork is level with or ahead of upstream', () => {
    expect(nextAlpha('11.17.1-a.2', '11.17.1').version).toBe('11.17.1-a.3');
    expect(nextAlpha('11.17.1-a.2', '11.17.0').version).toBe('11.17.1-a.3');
  });

  it('counts numerically past 9, so a.9 becomes a.10 rather than a.1', () => {
    expect(nextAlpha('11.15.0-a.9', '11.15.0').version).toBe('11.15.0-a.10');
  });

  it('starts the alpha line at 0 when coming off a beta', () => {
    // The live transition: develop currently sits on a -b.0 that belongs to main.
    expect(nextAlpha('11.17.1-b.0', '11.17.0').version).toBe('11.17.1-a.0');
    expect(nextAlpha('0.2.3-b.1', '0.2.3').version).toBe('0.2.3-a.0');
  });

  it('starts the alpha line at 0 from a bare release version', () => {
    expect(nextAlpha('11.17.1', '11.17.0').version).toBe('11.17.1-a.0');
  });

  it('bumps its own counter when there is no upstream counterpart', () => {
    expect(nextAlpha('11.17.1-a.4', null).version).toBe('11.17.1-a.5');
  });

  it('is idempotent across repeated runs before the PR merges', () => {
    // A rolling PR is recomputed every day from origin/develop, which does not
    // move until the PR lands. Five runs must all produce the same version
    // rather than inflating the counter to -a.8.
    const developVersion = '11.17.1-a.2';
    const results = Array.from({ length: 5 }, () => nextAlpha(developVersion, '11.17.0').version);
    expect(new Set(results)).toStrictEqual(new Set(['11.17.1-a.3']));
  });

  it('does not regress the base when upstream is behind the fork', () => {
    // Upstream develop lags its own releases, so this is the common case and
    // must never drag the fork backwards.
    expect(nextAlpha('11.17.1-a.0', '11.17.0').version).toBe('11.17.1-a.1');
  });
});
