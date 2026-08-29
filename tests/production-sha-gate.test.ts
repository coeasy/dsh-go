import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

type ShaGateOptions = {
  baseUrl: string;
  expectedSha: string;
  label?: string;
  attempts?: number;
  delayMs?: number;
  timeoutMs?: number;
  diagnosticFile?: string;
  fetchImpl?: (input: URL | RequestInfo, init?: RequestInit) => Promise<Response>;
  log?: (...args: unknown[]) => void;
  wait?: (ms: number) => Promise<void>;
  nonceFactory?: (attempt: number) => number;
};

type ShaGateResult = {
  actualSha: string;
};

const runShaGate = checkProductionSha as unknown as (options: ShaGateOptions) => Promise<ShaGateResult>;

describe('production SHA deployment gate', () => {
  it('requires an exact immutable commit SHA', () => {
    expect(validateExpectedSha(SHA.toUpperCase())).toBe(SHA);
    expect(() => validateExpectedSha('0123456')).toThrow('40-character commit SHA');
    expect(() => validateExpectedSha('g'.repeat(40))).toThrow('40-character commit SHA');
  });

  it('builds a cache-busted version URL while preserving signed query parameters', () => {
    const url = buildVersionUrl('https://preview.edgeone.app/base?eo_token=secret#fragment', 1);

    expect(url.pathname).toBe('/base/version.json');
    expect(url.searchParams.get('eo_token')).toBe('secret');
    expect(url.searchParams.get('__dsh_sha_gate')).toBe('1');
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

    const result = await runShaGate({
      baseUrl: 'https://dsh.example.com',
      expectedSha: SHA,
      attempts: 3,
      delayMs: 0,
      timeoutMs: 1_000,
      nonceFactory: (attempt) => attempt,
      fetchImpl: async (input) => {
        requested.push(new URL(String(input)));
        const body = responses.shift() ?? {};
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
    expect(requested[0].searchParams.get('__dsh_sha_gate')).toBe('1');
    expect(requested[1].searchParams.get('__dsh_sha_gate')).toBe('2');
    expect(waits).toBe(1);
  });

  it('fails closed when the stable endpoint never reaches the requested SHA', async () => {
    await expect(runShaGate({
      baseUrl: 'https://dsh.example.com',
      expectedSha: SHA,
      attempts: 2,
      delayMs: 0,
      timeoutMs: 1_000,
      nonceFactory: (attempt) => attempt,
      fetchImpl: async () => new Response(JSON.stringify({ git_sha: 'f'.repeat(40) }), { status: 200 }),
      log: () => undefined,
      wait: async () => undefined,
    })).rejects.toThrow(`did not converge to commit ${SHA}`);
  });

  it('records a sanitized HTTP failure diagnostic without signed query parameters', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-sha-gate-'));
    const diagnosticFile = join(directory, 'sha-diagnostic.json');

    try {
      await expect(runShaGate({
        baseUrl: 'https://preview.edgeone.cool/path?eo_token=secret&eo_time=123',
        expectedSha: SHA,
        attempts: 1,
        delayMs: 0,
        timeoutMs: 1_000,
        diagnosticFile,
        nonceFactory: (attempt) => attempt,
        fetchImpl: async () => ({
          ok: false,
          status: 401,
          url: 'https://preview.edgeone.cool/path/version.json?eo_token=secret&eo_time=123',
          headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
          json: async () => ({}),
        } as Response),
        log: () => undefined,
        wait: async () => undefined,
      })).rejects.toThrow('HTTP 401');

      const diagnostic = JSON.parse(readFileSync(diagnosticFile, 'utf8')) as Record<string, unknown>;
      expect(diagnostic.status).toBe('failure');
      expect(diagnostic.expected_sha).toBe(SHA);
      expect(diagnostic.http_status).toBe(401);
      expect(diagnostic.content_type).toBe('text/html; charset=utf-8');
      expect(diagnostic.problem).toBe('HTTP 401');
      expect(diagnostic.request_url).toBe('https://preview.edgeone.cool/path/version.json');
      expect(diagnostic.response_url).toBe('https://preview.edgeone.cool/path/version.json');
      expect(JSON.stringify(diagnostic)).not.toContain('secret');
      expect(JSON.stringify(diagnostic)).not.toContain('eo_token');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
