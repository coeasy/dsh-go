import { describe, expect, it } from 'vitest';
import { buildDeploymentVersion, validateDeploymentSha } from '../scripts/write-deployment-version.mjs';

const SHA = '0123456789abcdef0123456789abcdef01234567';

describe('deployment version metadata', () => {
  it('normalizes and validates exact commit SHAs', () => {
    expect(validateDeploymentSha(SHA.toUpperCase())).toBe(SHA);
    expect(() => validateDeploymentSha('main')).toThrow('40-character commit SHA');
    expect(() => validateDeploymentSha('1'.repeat(39))).toThrow('40-character commit SHA');
  });

  it('stamps immutable GitHub deployment identity', () => {
    const metadata = buildDeploymentVersion({
      DEPLOYMENT_SHA: SHA,
      GITHUB_REPOSITORY: 'coeasy/dsh-go',
      GITHUB_REF: 'refs/heads/main',
      GITHUB_WORKFLOW: 'Deploy Tencent EdgeOne',
      GITHUB_RUN_ID: '12345',
      GITHUB_RUN_ATTEMPT: '2',
    }, new Date('2026-08-26T07:30:00.000Z'));

    expect(metadata).toEqual({
      schema_version: 1,
      git_sha: SHA,
      repository: 'coeasy/dsh-go',
      ref: 'refs/heads/main',
      workflow: 'Deploy Tencent EdgeOne',
      run_id: '12345',
      run_attempt: 2,
      built_at: '2026-08-26T07:30:00.000Z',
    });
  });

  it('falls back to GITHUB_SHA for directly dispatched runs', () => {
    const metadata = buildDeploymentVersion({ GITHUB_SHA: SHA }, new Date('2026-08-26T07:30:00.000Z'));
    expect(metadata.git_sha).toBe(SHA);
    expect(metadata.run_attempt).toBeNull();
  });
});
