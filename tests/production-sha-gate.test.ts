import { describe, expect, it } from 'vitest';
import {
  buildVersionUrl,
  checkProductionSha,
  deployedVersionSha,
  safeDisplayUrl,
  validateExpectedSha,
  versionMatches,
} from '../scripts/check-production-sha.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('production SHA deployment gate', () => {
  it('requires an exact immutable commit SHA', () => {
    expect(validateExpectedSha(SHA.toUpperCase())).toBe(SHA);
    expect(() => validateExpectedSha('0123456')).toThrow('40-character commit SHA');
    expect(() => validateExpectedSha('g'.repeat(40))).toThrow('40-character commit SHA');
  });

  it('builds a cache-busted version URL while preserving signed query parameters', () => {
    const url = buildVersionUrl('https://preview.edgeone.app/base?eo_token=secret#fragment', 'attempt-1');

    expect(url.pathname).toBe('/base/version.json');
    expect(url.searchParams.get('eo_token')).toBe('secret');
    expect(url.searchParams.get('__dsh_sha_gate')).toBe('attempt-1');
    expect(safeDisplayUrl(url)).toBe('https://preview.edgeone.app/base/version.json');
  });

  it('matches only the exact deployed git_sha', () => {
    expect(deployedVersionSha({ git_sha: SHA.toUpperCase() })).toBe(SHA);
    expect(versionMatches(SHA, { git_sha: SHA })).toBe(true);
    expect(versionMatches(SHA, { git_sha: 'f'.repeat(40) })).toBe(false);
    expect(versionMatches(SHA, {})).toBe(false);
  });

  it('waits for production to converge from an older SHA to the requested SHA', async () => {
    const responses = [
      { git_sha: 'f'.repeat(40) },
      { git_sha: SHA },
    ];
    const requested: URL[] = [];
    let waits = 0;

    const result = await checkProductionSha({
      baseUrl: 'https://dsh.example.com',
      expectedSha: SHA,
      attempts: 3,
      delayMs: 0,
      timeoutMs: 1_000,
      nonceFactory: (attempt) => `test-${attempt}`,
      fetchImpl: async (url) => {
        requested.push(new URL(String(url)));
        const body = responses.shift();
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      },
      log: () => undefined,
      wait: async () => {
        waits += 1;
      },
    });

    expect(result.actualSha).toBe(SHA);
    expect(requested).toHaveLength(2);
    expect(requested[0].searchParams.get('__dsh_sha_gate')).toBe('test-1');
    expect(requested[1].searchParams.get('__dsh_sha_gate')).toBe('test-2');
    expect(waits).toBe(1);
  });

  it('fails closed when the stable endpoint never reaches the requested SHA', async () => {
    await expect(checkProductionSha({
      baseUrl: 'https://dsh.example.com',
      expectedSha: SHA,
      attempts: 2,
      delayMs: 0,
      timeoutMs: 1_000,
      nonceFactory: (attempt) => `test-${attempt}`,
      fetchImpl: async () => new Response(JSON.stringify({ git_sha: 'f'.repeat(40) }), { status: 200 }),
      log: () => undefined,
      wait: async () => undefined,
    })).rejects.toThrow(`did not converge to commit ${SHA}`);
  });
});
