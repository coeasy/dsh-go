import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  OSV_BATCH_SIZE,
  OSV_MAX_ATTEMPTS,
  OSV_TIMEOUT_MS,
  RETRY_DELAY_MS,
  buildAuditArgs,
  collectLockfilePackages,
  isTransientAuditFailure,
  parseArgs,
  parseOsvAuditResults,
  run,
  runOsvAudit,
} from '../scripts/npm-audit-retry.mjs';

describe('npm audit retry gate', () => {
  it('keeps the audit command bounded and fail-closed', () => {
    expect(MAX_ATTEMPTS).toBe(4);
    expect(AUDIT_TIMEOUT_MS).toBe(45_000);
    expect(RETRY_DELAY_MS).toBe(10_000);
    expect(OSV_TIMEOUT_MS).toBe(30_000);
    expect(OSV_MAX_ATTEMPTS).toBe(2);
    expect(OSV_BATCH_SIZE).toBe(1_000);
    expect(buildAuditArgs()).toEqual([
      'audit',
      '--audit-level=high',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
    ]);
  });

  it('classifies npm service failures as retryable but vulnerability findings as final', () => {
    expect(isTransientAuditFailure('npm warn audit 503 Service Unavailable')).toBe(true);
    expect(isTransientAuditFailure('npm warn audit 400 Bad Request')).toBe(false);
    expect(isTransientAuditFailure('npm warn audit 500 Internal Server Error')).toBe(true);
    expect(isTransientAuditFailure('npm error audit endpoint returned an error')).toBe(true);
    expect(
      isTransientAuditFailure(
        'npm warn audit 500 Internal Server Error\nnpm error audit endpoint returned an error',
      ),
    ).toBe(true);
    expect(isTransientAuditFailure('npm error code ECONNRESET')).toBe(true);
    expect(isTransientAuditFailure('found 1 high severity vulnerability')).toBe(false);
  });

  it('parses an explicit project workspace', () => {
    expect(parseArgs(['--cwd', 'site', '--label', 'site'])).toEqual({
      cwd: resolve('site'),
      label: 'site',
    });
  });

  it('retries only transient failures and stops after the bounded budget', async () => {
    const attempts: string[] = [];
    const sleeps: number[] = [];
    const exitCode = await run(['--label', 'root'], {
      audit: async () => {
        attempts.push('audit');
        return {
          code: 1,
          output: 'npm warn audit 503 Service Unavailable',
          timedOut: false,
        };
      },
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      },
      fallbackAudit: async () => ({ code: 1, output: 'OSV fallback unavailable' }),
    });

    expect(exitCode).toBe(1);
    expect(attempts).toHaveLength(4);
    expect(sleeps).toEqual([10_000, 20_000, 30_000]);
  });

  it('retries a timed-out audit and accepts the next successful result', async () => {
    let attempts = 0;
    const sleeps: number[] = [];
    const exitCode = await run(['--label', 'site'], {
      audit: async () => {
        attempts += 1;
        if (attempts === 1) return { code: 124, output: '', timedOut: true };
        return { code: 0, output: 'found 0 vulnerabilities', timedOut: false };
      },
      sleep: async (milliseconds: number) => {
        sleeps.push(milliseconds);
      },
    });

    expect(exitCode).toBe(0);
    expect(attempts).toBe(2);
    expect(sleeps).toEqual([10_000]);
  });

  it('does not retry a vulnerability failure', async () => {
    let attempts = 0;
    const exitCode = await run(['--label', 'site'], {
      audit: async () => {
        attempts += 1;
        return { code: 1, output: 'found 1 high severity vulnerability', timedOut: false };
      },
      sleep: async () => {},
    });

    expect(exitCode).toBe(1);
    expect(attempts).toBe(1);
  });

  it('uses the OSV fallback after the bounded npm outage budget', async () => {
    let fallbackCalls = 0;
    const exitCode = await run(['--label', 'root'], {
      audit: async () => ({
        code: 1,
        output: 'npm warn audit 500 Internal Server Error',
        timedOut: false,
      }),
      sleep: async () => {},
      fallbackAudit: async ({ cwd, label }: { cwd: string; label: string }) => {
        fallbackCalls += 1;
        expect(cwd).toBe(resolve('.'));
        expect(label).toBe('root');
        return { code: 0, output: 'OSV fallback passed' };
      },
    });

    expect(exitCode).toBe(0);
    expect(fallbackCalls).toBe(1);
  });

  it('extracts unique package versions from v3 and legacy lockfiles', () => {
    expect(
      collectLockfilePackages({
        packages: {
          '': { version: '0.1.0' },
          'node_modules/astro': { version: '7.2.4' },
          'node_modules/@scope/pkg': { version: '1.2.3' },
          'node_modules/astro/node_modules/semver': { version: '7.7.2' },
          'node_modules/duplicate': { name: 'astro', version: '7.2.4' },
        },
      }),
    ).toEqual([
      { name: 'astro', version: '7.2.4' },
      { name: '@scope/pkg', version: '1.2.3' },
      { name: 'semver', version: '7.7.2' },
    ]);

    expect(
      collectLockfilePackages({
        dependencies: {
          astro: { version: '7.2.4', dependencies: { semver: { version: '7.7.2' } } },
        },
      }),
    ).toEqual([
      { name: 'astro', version: '7.2.4' },
      { name: 'semver', version: '7.7.2' },
    ]);
  });

  it('fails only on high, critical, or unknown OSV findings', () => {
    const dependencies = [
      { name: 'a', version: '1.0.0' },
      { name: 'b', version: '2.0.0' },
      { name: 'c', version: '3.0.0' },
    ];
    expect(
      parseOsvAuditResults(
        {
          results: [
            { vulns: [{ id: 'OSV-low', database_specific: { severity: 'LOW' } }] },
            { vulns: [{ id: 'OSV-high', database_specific: { severity: 'HIGH' } }] },
            { vulns: [{ id: 'OSV-unknown' }] },
          ],
        },
        dependencies,
      ).findings,
    ).toEqual([
      { id: 'OSV-high', name: 'b', version: '2.0.0', severity: 'high' },
      { id: 'OSV-unknown', name: 'c', version: '3.0.0', severity: 'unknown' },
    ]);
  });

  it('queries locked packages through OSV in bounded batches', async () => {
    const dependencies = Array.from({ length: 1_001 }, (_, index) => ({
      name: `pkg-${index}`,
      version: '1.0.0',
    }));
    const requests: Array<{ queries: unknown[]; signal: AbortSignal }> = [];
    const result = await runOsvAudit({
      cwd: resolve('.'),
      readFileImpl: (async () =>
        JSON.stringify({
          packages: Object.fromEntries(
            dependencies.map(({ name, version }) => [`node_modules/${name}`, { version }]),
          ),
        })) as unknown as typeof readFile,
      fetchImpl: (async (_url: string | URL | Request, options: RequestInit = {}) => {
        const body = JSON.parse(String(options.body));
        requests.push({ queries: body.queries, signal: options.signal as AbortSignal });
        return {
          ok: true,
          status: 200,
          json: async () => ({ results: body.queries.map(() => ({ vulns: [] })) }),
        };
      }) as unknown as typeof fetch,
    });

    expect(result.code).toBe(0);
    expect(requests.map(({ queries }) => queries.length)).toEqual([1_000, 1]);
    expect(requests.every(({ signal }) => signal instanceof AbortSignal)).toBe(true);
  });

  it('bounds an OSV request that ignores abort signals', async () => {
    let attempts = 0;
    const result = await runOsvAudit({
      cwd: resolve('.'),
      timeoutMs: 1,
      maxAttempts: 2,
      retryDelayMs: 0,
      sleep: async () => {},
      readFileImpl: (async () =>
        JSON.stringify({
          packages: { 'node_modules/astro': { version: '7.2.4' } },
        })) as unknown as typeof readFile,
      fetchImpl: (async () => {
        attempts += 1;
        return new Promise(() => {});
      }) as unknown as typeof fetch,
    });

    expect(result.code).toBe(1);
    expect(attempts).toBe(2);
    expect(result.output).toContain('timed out');
  });
});
