import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AUDIT_TIMEOUT_MS,
  MAX_ATTEMPTS,
  RETRY_DELAY_MS,
  buildAuditArgs,
  isTransientAuditFailure,
  parseArgs,
  run,
} from '../scripts/npm-audit-retry.mjs';

describe('npm audit retry gate', () => {
  it('keeps the audit command bounded and fail-closed', () => {
    expect(MAX_ATTEMPTS).toBe(3);
    expect(AUDIT_TIMEOUT_MS).toBe(60_000);
    expect(RETRY_DELAY_MS).toBe(10_000);
    expect(buildAuditArgs()).toEqual([
      'audit',
      '--audit-level=high',
      '--fetch-retries=0',
      '--fetch-timeout=30000',
    ]);
  });

  it('classifies npm service failures as retryable but vulnerability findings as final', () => {
    expect(isTransientAuditFailure('npm warn audit 503 Service Unavailable')).toBe(true);
    expect(isTransientAuditFailure('npm error audit endpoint returned an error')).toBe(true);
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
    });

    expect(exitCode).toBe(1);
    expect(attempts).toHaveLength(3);
    expect(sleeps).toEqual([10_000, 20_000]);
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
});
