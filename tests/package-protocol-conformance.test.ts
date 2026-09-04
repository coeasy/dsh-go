import { describe, expect, it } from 'vitest';
import {
  compareVersion,
  normalizePackageRequest,
  parsePackageCoordinate,
  satisfiesRange,
} from '../packages/protocol-core/index.mjs';

describe('Package Protocol V2 conformance', () => {
  const cases = [
    ['plugin:owner/example', { type: 'plugin', id: 'owner/example', range: '*', channel: 'stable' }],
    ['mcp:owner/server@^1.2.0', { type: 'mcp', id: 'owner/server', range: '^1.2.0', channel: 'stable' }],
    ['skill:helper@latest', { type: 'skill', id: 'helper', range: 'latest', channel: 'stable' }],
    ['agent:worker@~2.3.0', { type: 'agent', id: 'worker', range: '~2.3.0', channel: 'stable' }],
  ] as const;

  it.each(cases)('normalizes %s through the one canonical parser', (spec, expected) => {
    expect(parsePackageCoordinate(spec)).toEqual(expected);
    expect(normalizePackageRequest(expected)).toEqual(expected);
  });

  it('rejects unsafe ids and unsupported channels', () => {
    for (const id of ['../escape', 'owner/../escape', 'bad id', '/absolute']) {
      expect(() => parsePackageCoordinate(`plugin:${id}`)).toThrow();
    }
    expect(() => normalizePackageRequest({ type: 'plugin', id: 'example', range: '*', channel: 'preview' })).toThrow();
  });

  const semverCases = [
    ['1.2.3', '*', true],
    ['1.2.3', 'latest', true],
    ['1.2.3', '^1.2.0', true],
    ['2.0.0', '^1.2.0', false],
    ['0.2.9', '^0.2.3', true],
    ['0.3.0', '^0.2.3', false],
    ['1.2.9', '~1.2.3', true],
    ['1.3.0', '~1.2.3', false],
    ['1.4.2', '1.x', true],
    ['2.0.0', '1.x', false],
    ['1.5.0', '>=1.2.0 <2.0.0', true],
    ['2.0.0', '>=1.2.0 <2.0.0', false],
    ['2.1.0', '^1.0.0 || ^2.0.0', true],
  ] as const;

  it.each(semverCases)('matches %s against %s', (version, range, expected) => {
    expect(satisfiesRange(version, range)).toBe(expected);
  });

  it('orders semantic versions using the canonical implementation', () => {
    expect(compareVersion('1.2.3', '1.2.2')).toBeGreaterThan(0);
    expect(compareVersion('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareVersion('1.0.0', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersion('1.0.0-beta.10', '1.0.0-beta.2')).toBeGreaterThan(0);
    expect(compareVersion('1.0.0', '1.0.0')).toBe(0);
  });
});
