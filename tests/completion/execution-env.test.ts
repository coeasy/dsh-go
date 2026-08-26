import { describe, expect, it } from 'vitest';
import { buildExecutionEnv, inheritedExecutionEnvKeys } from '../../runtime/execution-env.mjs';

describe('runtime child execution environment', () => {
  it('inherits only the minimal host allowlist', () => {
    const host = {
      PATH: '/usr/bin',
      HOME: '/home/tester',
      LANG: 'en_US.UTF-8',
      GITHUB_TOKEN: 'should-not-leak',
      AWS_SECRET_ACCESS_KEY: 'should-not-leak',
      NODE_OPTIONS: '--require /tmp/inject.js',
    };
    const env = buildExecutionEnv({}, host);

    expect(env.PATH).toBe('/usr/bin');
    expect(env.HOME).toBe('/home/tester');
    expect(env.LANG).toBe('en_US.UTF-8');
    expect(env.GITHUB_TOKEN).toBeUndefined();
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
    expect(env.NODE_OPTIONS).toBeUndefined();
  });

  it('allows package-scoped explicit values to be injected', () => {
    const env = buildExecutionEnv({ API_ENDPOINT: 'https://example.test', RETRIES: 3 }, { PATH: '/bin', SECRET: 'hidden' });
    expect(env).toEqual({ PATH: '/bin', API_ENDPOINT: 'https://example.test', RETRIES: '3' });
  });

  it('documents the inherited environment surface', () => {
    const keys = inheritedExecutionEnvKeys();
    expect(keys).toContain('PATH');
    expect(keys).not.toContain('GITHUB_TOKEN');
    expect(keys).not.toContain('NODE_OPTIONS');
  });
});
