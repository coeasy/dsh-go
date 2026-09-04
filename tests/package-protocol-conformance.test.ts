import { describe, expect, it } from 'vitest';
import { parsePackageRequest } from '../runtime/package-model.mjs';
import { compareVersions, satisfiesVersion } from '../runtime/semver.mjs';
import {
  compareSemanticVersions,
  normalizeEdgePackageRequest,
  satisfiesSemanticVersion,
} from '../functions/_package-request';

describe('Package protocol conformance', () => {
  const cases = [
    {
      spec: 'plugin:owner/example',
      runtime: {},
      edge: { id: 'owner/example', type: 'plugin' },
      expected: { type: 'plugin', id: 'owner/example', versionRange: '*', channel: 'stable' },
    },
    {
      spec: 'mcp:owner/server@^1.2.0',
      runtime: {},
      edge: { id: 'owner/server', type: 'mcp', version: '^1.2.0' },
      expected: { type: 'mcp', id: 'owner/server', versionRange: '^1.2.0', channel: 'stable' },
    },
    {
      spec: 'skill:helper@latest',
      runtime: {},
      edge: { id: 'helper', type: 'skill', version: 'latest' },
      expected: { type: 'skill', id: 'helper', versionRange: 'latest', channel: 'stable' },
    },
    {
      spec: 'agent:worker@~2.3.0',
      runtime: { channel: 'beta' },
      edge: { id: 'worker', type: 'agent', version: '~2.3.0', channel: 'beta' },
      expected: { type: 'agent', id: 'worker', versionRange: '~2.3.0', channel: 'beta' },
    },
  ] as const;

  it.each(cases)('normalizes $spec consistently', ({ spec, runtime, edge, expected }) => {
    const local = parsePackageRequest(spec, runtime);
    const remote = normalizeEdgePackageRequest(edge);

    expect({
      type: local.type,
      id: local.id,
      versionRange: local.versionRange,
      channel: local.channel,
    }).toEqual(expected);
    expect(remote).toEqual(expected);
  });

  it('rejects unsafe ids and unsupported channels on both boundaries', () => {
    for (const id of ['../escape', 'owner/../escape', 'bad id', '/absolute']) {
      expect(() => parsePackageRequest(`plugin:${id}`)).toThrow();
      expect(() => normalizeEdgePackageRequest({ id, type: 'plugin' })).toThrow();
    }

    expect(() => parsePackageRequest('plugin:example', { channel: 'preview' })).toThrow();
    expect(() => normalizeEdgePackageRequest({ id: 'example', type: 'plugin', channel: 'preview' })).toThrow();
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

  it.each(semverCases)('matches %s against %s consistently', (version, range, expected) => {
    expect(satisfiesVersion(version, range)).toBe(expected);
    expect(satisfiesSemanticVersion(version, range)).toBe(expected);
  });

  it('orders semantic versions consistently', () => {
    const pairs = [
      ['1.2.3', '1.2.2'],
      ['2.0.0', '1.99.99'],
      ['1.0.0', '1.0.0-beta.2'],
      ['1.0.0-beta.10', '1.0.0-beta.2'],
      ['1.0.0', '1.0.0'],
    ] as const;

    for (const [left, right] of pairs) {
      expect(Math.sign(compareVersions(left, right))).toBe(
        Math.sign(compareSemanticVersions(left, right)),
      );
    }
  });
});
