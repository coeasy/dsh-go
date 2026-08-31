import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildDeployArgs,
  checkCliContract,
  classifyFailure,
  deployEdgeOne,
  parseLastJson,
  resolveProject,
  resolveDeploymentUrl,
  sanitizeLog,
  validateCliVersion,
  validateDeployResult,
} from '../scripts/edgeone-deploy-ci.mjs';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EdgeOne CI deployment helpers', () => {
  it('requires a pinned supported CLI version', () => {
    expect(validateCliVersion('1.6.0')).toBe('1.6.0');
    expect(validateCliVersion('1.6.28')).toBe('1.6.28');
    expect(validateCliVersion('2.0.0')).toBe('2.0.0');
    expect(() => validateCliVersion('1.5.9')).toThrow('>= 1.6.0');
    expect(() => validateCliVersion('latest')).toThrow('pinned semver');
  });

  it('pins deployment to the canonical EdgeOne project', () => {
    expect(resolveProject({
      EDGEONE_PROJECT: 'dsh-go',
      EDGEONE_EXPECTED_PROJECT: 'dsh-go',
    })).toBe('dsh-go');
    expect(resolveProject({})).toBe('dsh-go');
    expect(() => resolveProject({
      EDGEONE_PROJECT: 'dsh',
      EDGEONE_EXPECTED_PROJECT: 'dsh-go',
    })).toThrow('EdgeOne project mismatch: expected=dsh-go actual=dsh');
  });

  it('builds the direct named-project deployment contract', () => {
    const args = buildDeployArgs({ project: 'dsh-go', token: 'secret', cliVersion: '1.6.28' });

    expect(args).toEqual([
      '--yes', 'edgeone@1.6.28', 'makers', 'deploy', '.', '-n', 'dsh-go', '-t', 'secret', '-e', 'production', '--json',
    ]);
    expect(args).not.toContain('link');
    expect(args).not.toContain('--name');
  });

  it('executes exactly one direct deploy and uses the configured URL when available', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const calls: Array<{
      command: string;
      args: string[];
      options: { timeoutMs?: number; cwd?: string; env?: Record<string, string> };
    }> = [];
    const execute = async (
      command: string,
      args: string[],
      options: { timeoutMs?: number; cwd?: string; env?: Record<string, string> } = {},
    ) => {
      calls.push({ command, args, options });
      return {
        code: 0,
        stdout: JSON.stringify({
          status: 'success',
          url: 'https://deployment.edgeone.example',
          projectId: 'project-1',
          deploymentId: 'deployment-1',
        }),
        stderr: '',
        timedOut: false,
      };
    };

    const result = await deployEdgeOne({
      env: {
        EDGEONE_API_TOKEN: 'test-token',
        EDGEONE_PROJECT: 'dsh-go',
        EDGEONE_EXPECTED_PROJECT: 'dsh-go',
        EDGEONE_CLI_VERSION: '1.6.28',
        EDGEONE_DEPLOY_RETRIES: '1',
        EDGEONE_ATTEMPT_TIMEOUT_SECONDS: '30',
        EDGEONE_SITE_URL: 'https://stable.edgeone.example',
      },
      execute,
      wait: async () => undefined,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      command: 'npx',
      args: buildDeployArgs({ project: 'dsh-go', token: 'test-token', cliVersion: '1.6.28' }),
      options: {
        timeoutMs: 30_000,
        cwd: './site/dist',
      },
    });
    expect(calls[0].args).not.toContain('link');
    expect(calls[0].args).not.toContain('--name');
    expect(calls[0].options.env?.PAGES_SOURCE).toBe('skills');
    expect(result.healthUrl).toBe('https://stable.edgeone.example');
  });

  it('retries an accepted deployment when its returned URL is not readable', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let deployment = 0;
    const execute = vi.fn(async () => {
      deployment += 1;
      return {
        code: 0,
        stdout: JSON.stringify({
          status: 'success',
          url: `https://deployment-${deployment}.edgeone.example?eo_token=secret`,
          projectId: 'project-1',
          deploymentId: `deployment-${deployment}`,
        }),
        stderr: '',
        timedOut: false,
      };
    });
    const verifyDeployment = vi.fn()
      .mockRejectedValueOnce(new Error('HTTP 404'))
      .mockResolvedValueOnce({ expectedSha: 'a'.repeat(40), actualSha: 'a'.repeat(40) });
    const wait = vi.fn(async () => undefined);

    const result = await deployEdgeOne({
      env: {
        EDGEONE_API_TOKEN: 'test-token',
        EDGEONE_PROJECT: 'dsh-go',
        EDGEONE_EXPECTED_PROJECT: 'dsh-go',
        EDGEONE_DEPLOY_RETRIES: '2',
        EDGEONE_ATTEMPT_TIMEOUT_SECONDS: '30',
        EDGEONE_DEPLOY_VERIFY_ATTEMPTS: '1',
        EDGEONE_DEPLOY_VERIFY_DELAY_MS: '0',
        EDGEONE_SITE_URL: 'https://stable.edgeone.example',
        DEPLOYMENT_SHA: 'a'.repeat(40),
      },
      execute,
      verifyDeployment,
      wait,
    });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(verifyDeployment).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledWith(10_000);
    expect(result.deployment.deploymentId).toBe('deployment-2');
  });

  it('uses the CLI production URL when no custom production URL is configured', async () => {
    const execute = vi.fn(async () => ({
      code: 0,
      stdout: JSON.stringify({
        status: 'success',
        url: 'https://dsh-go.edgeone.cool',
        type: 'preset',
        projectId: 'project-1',
        deploymentId: 'deployment-1',
      }),
      stderr: '',
      timedOut: false,
    }));
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      Code: 0,
      Data: { Response: { Token: 'signed', Timestamp: 123 } },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }));
    const verifyDeployment = vi.fn().mockResolvedValue({ expectedSha: 'a'.repeat(40), actualSha: 'a'.repeat(40) });

    const result = await deployEdgeOne({
      env: {
        EDGEONE_API_TOKEN: 'test-token',
        EDGEONE_PROJECT: 'dsh-go',
        EDGEONE_EXPECTED_PROJECT: 'dsh-go',
        EDGEONE_DEPLOY_RETRIES: '1',
        EDGEONE_ATTEMPT_TIMEOUT_SECONDS: '30',
        EDGEONE_DEPLOY_VERIFY_ATTEMPTS: '1',
        EDGEONE_DEPLOY_VERIFY_DELAY_MS: '0',
        DEPLOYMENT_SHA: 'a'.repeat(40),
      },
      execute,
      wait: async () => undefined,
      fetchImpl,
      verifyDeployment,
    });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith('https://pages-api.edgeone.ai/v1', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ Action: 'DescribePagesEncipherToken', Text: 'dsh-go.edgeone.cool' }),
    }));
    expect(verifyDeployment).toHaveBeenCalledWith(expect.objectContaining({
      baseUrl: 'https://dsh-go.edgeone.cool/?eo_token=signed&eo_time=123',
    }));
    expect(result.healthUrl).toBe('https://dsh-go.edgeone.cool/?eo_token=signed&eo_time=123');
  });

  it('does not alter an already signed preset URL', async () => {
    const fetchImpl = vi.fn();
    const url = await resolveDeploymentUrl({
      deployment: { type: 'preset', url: 'https://preview.edgeone.cool?eo_token=signed&eo_time=123' },
      token: 'test-token',
      fetchImpl,
    });

    expect(url).toBe('https://preview.edgeone.cool?eo_token=signed&eo_time=123');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('preserves the CLI public URL for TLD preset deployments', async () => {
    const fetchImpl = vi.fn();
    const url = await resolveDeploymentUrl({
      deployment: { type: 'preset', isTld: 1, url: 'https://dsh-go.edgeone.cool' },
      token: 'test-token',
      fetchImpl,
    });

    expect(url).toBe('https://dsh-go.edgeone.cool');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('fails before invoking the CLI when the project drifts from canonical production', async () => {
    const execute = vi.fn(async () => ({ code: 0, stdout: '', stderr: '', timedOut: false }));

    await expect(deployEdgeOne({
      env: {
        EDGEONE_API_TOKEN: 'test-token',
        EDGEONE_PROJECT: 'dsh',
        EDGEONE_EXPECTED_PROJECT: 'dsh-go',
      },
      execute,
      wait: async () => undefined,
    })).rejects.toThrow('EdgeOne project mismatch: expected=dsh-go actual=dsh');

    expect(execute).not.toHaveBeenCalled();
  });

  it('checks only the supported makers deploy CLI surface', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const calls: Array<{ command: string; args: string[] }> = [];
    const execute = async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { code: 0, stdout: '', stderr: '', timedOut: false };
    };

    await checkCliContract({
      env: { EDGEONE_CLI_VERSION: '1.6.28' },
      execute,
    });

    expect(calls).toEqual([{
      command: 'npx',
      args: ['--yes', 'edgeone@1.6.28', 'makers', 'deploy', '--help'],
    }]);
    expect(calls.flatMap((call) => call.args)).not.toContain('link');
  });

  it('sanitizes direct tokens, signed URLs, JSON token fields, and bearer credentials', () => {
    const token = 'edgeone-super-secret';
    const input = [
      `token=${token}`,
      'https://preview.edgeone.app/?eo_token=query-secret',
      '{"apiToken":"json-secret"}',
      'Authorization: Bearer bearer-secret',
    ].join('\n');
    const safe = sanitizeLog(input, token);

    expect(safe).not.toContain(token);
    expect(safe).not.toContain('query-secret');
    expect(safe).not.toContain('json-secret');
    expect(safe).not.toContain('bearer-secret');
    expect(safe).toContain('eo_token=***');
  });

  it('classifies actionable EdgeOne failure domains', () => {
    expect(classifyFailure('fetch failed: ECONNRESET', 1)).toBe('transport');
    expect(classifyFailure('HTTP 401 unauthorized invalid token', 1)).toBe('authentication');
    expect(classifyFailure('HTTP 429 quota exceeded', 1)).toBe('quota');
    expect(classifyFailure('HTTP 409 project already exists', 1)).toBe('project_conflict');
    expect(classifyFailure('The project dsh has finished versions. Uploads are only allowed for the latest version.', 1)).toBe('version_state');
    expect(classifyFailure('no valid JSON result', 0)).toBe('protocol');
    expect(classifyFailure('unexpected provider error', 1)).toBe('api');
    expect(classifyFailure('', 124, true)).toBe('transport');
  });

  it('extracts the last complete JSON object from mixed CLI output', () => {
    const result = parseLastJson(['{"status":"progress"}', '{"status":"success","url":"https://preview.edgeone.app","projectId":"project-1","deploymentId":"deployment-1","meta":{"nested":true}}'].join('\n'));
    expect(result).toEqual({ status: 'success', url: 'https://preview.edgeone.app', projectId: 'project-1', deploymentId: 'deployment-1', meta: { nested: true } });
  });

  it('validates structured deployment success payloads', () => {
    expect(validateDeployResult({ status: 'success', url: 'https://example.com', projectId: 123, deploymentId: 'dp-1' }).projectId).toBe(123);
    expect(() => validateDeployResult({ status: 'success', url: '', projectId: 123, deploymentId: 'dp-1' })).toThrow('invalid success payload');
    expect(() => validateDeployResult({ status: 'success', url: 'https://example.com', projectId: 123 })).toThrow('invalid success payload');
    expect(() => validateDeployResult({ status: 'error', url: 'https://example.com', projectId: 123, deploymentId: 'dp-1' })).toThrow('invalid success payload');
  });
});
