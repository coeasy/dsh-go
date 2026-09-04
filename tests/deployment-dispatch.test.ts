import { describe, expect, it, vi } from 'vitest';
import {
  dispatchDeployments,
  extractWorkflowRunUrl,
  isWorkflowRegistrationError,
  parseWorkflowList,
  parseWorkflowRunId,
  validateRevision,
} from '../scripts/dispatch-deployments.mjs';

describe('deployment dispatch fan-out', () => {
  it('requires an exact authoritative commit SHA', () => {
    const sha = 'a'.repeat(40);
    expect(validateRevision(sha)).toBe(sha);
    expect(() => validateRevision('abc123')).toThrow('40-character commit SHA');
  });

  it('normalizes and validates workflow lists', () => {
    expect(parseWorkflowList('deploy.yml deploy-pages.yml,deploy.yml')).toEqual(['deploy.yml', 'deploy-pages.yml']);
    expect(() => parseWorkflowList('../bad workflow')).toThrow();
  });

  it('recognizes the GitHub workflow_dispatch registration 422 specifically', () => {
    expect(isWorkflowRegistrationError("could not create workflow dispatch event: HTTP 422: Workflow does not have 'workflow_dispatch' trigger")).toBe(true);
    expect(isWorkflowRegistrationError('HTTP 403: Resource not accessible by integration')).toBe(false);
  });

  it('extracts and validates workflow run references for ordered smoke dispatch', () => {
    const url = 'https://github.com/example/repo/actions/runs/12345';
    expect(extractWorkflowRunUrl(`queued\n${url}\n`)).toBe(url);
    expect(parseWorkflowRunId(url)).toBe('12345');
    expect(parseWorkflowRunId('67890')).toBe('67890');
  });

  it('continues fan-out after one provider fails and retries registration lag only', async () => {
    const calls: string[] = [];
    let pagesAttempt = 0;
    const execute = vi.fn(async (args: string[], _options?: { timeoutMs?: number }) => {
      const workflow = args[2];
      calls.push(workflow);
      if (workflow === 'deploy.yml') {
        return { code: 1, stdout: '', stderr: 'HTTP 403: provider denied', timedOut: false };
      }
      if (workflow === 'deploy-pages.yml' && pagesAttempt++ === 0) {
        return {
          code: 1,
          stdout: '',
          stderr: "HTTP 422: Workflow does not have 'workflow_dispatch' trigger",
          timedOut: false,
        };
      }
      return { code: 0, stdout: `https://github.com/example/actions/runs/${calls.length}\n`, stderr: '', timedOut: false };
    });
    const wait = vi.fn(async () => undefined);

    await expect(dispatchDeployments({
      env: {
        DEPLOY_REVISION: 'b'.repeat(40),
        DEPLOY_WORKFLOWS: 'deploy.yml deploy-pages.yml deploy-edgeone.yml',
        DEPLOY_LABEL: 'test providers',
        DEPLOY_DISPATCH_RETRIES: '3',
        DEPLOY_DISPATCH_RETRY_DELAY_MS: '1',
        DEPLOY_DISPATCH_TIMEOUT_MS: '5000',
      },
      execute,
      wait,
    })).rejects.toThrow('1 failed dispatch');

    expect(calls).toEqual(['deploy.yml', 'deploy-pages.yml', 'deploy-pages.yml', 'deploy-edgeone.yml']);
    expect(wait).toHaveBeenCalledTimes(1);
  });

  it('waits for all provider runs and the final monitor before succeeding', async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (args: string[], _options?: { timeoutMs?: number }) => {
      if (args[0] === 'workflow') {
        const workflow = args[2];
        calls.push(`dispatch:${workflow}`);
        const runId = workflow === 'deploy.yml' ? '101' : workflow === 'deploy-pages.yml' ? '102' : '103';
        return { code: 0, stdout: `https://github.com/example/repo/actions/runs/${runId}\n`, stderr: '', timedOut: false };
      }
      calls.push(`watch:${args[2]}`);
      return { code: 0, stdout: 'completed', stderr: '', timedOut: false };
    });

    const result = await dispatchDeployments({
      env: {
        DEPLOY_REVISION: 'c'.repeat(40),
        DEPLOY_WORKFLOWS: 'deploy.yml deploy-pages.yml monitor.yml',
        DEPLOY_WAIT_TIMEOUT_MS: '60000',
      },
      execute,
    });

    expect(calls).toEqual([
      'dispatch:deploy.yml',
      'dispatch:deploy-pages.yml',
      'watch:101',
      'watch:102',
      'dispatch:monitor.yml',
      'watch:103',
    ]);
    expect(result.map((item) => [item.workflow, item.status])).toEqual([
      ['deploy.yml', 'completed'],
      ['deploy-pages.yml', 'completed'],
      ['monitor.yml', 'completed'],
    ]);
    expect(execute.mock.calls[2][1]).toMatchObject({ timeoutMs: 60000 });
    expect(execute.mock.calls[5][1]).toMatchObject({ timeoutMs: 60000 });
  });

  it('fails when the final production monitor fails', async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (args: string[]) => {
      if (args[0] === 'workflow') {
        const workflow = args[2];
        calls.push(`dispatch:${workflow}`);
        const runId = workflow === 'monitor.yml' ? '302' : '301';
        return { code: 0, stdout: `https://github.com/example/repo/actions/runs/${runId}\n`, stderr: '', timedOut: false };
      }
      calls.push(`watch:${args[2]}`);
      if (args[2] === '302') return { code: 1, stdout: '', stderr: 'final convergence mismatch', timedOut: false };
      return { code: 0, stdout: 'completed', stderr: '', timedOut: false };
    });

    await expect(dispatchDeployments({
      env: {
        DEPLOY_REVISION: 'e'.repeat(40),
        DEPLOY_WORKFLOWS: 'deploy.yml monitor.yml',
        DEPLOY_WAIT_TIMEOUT_MS: '60000',
      },
      execute,
    })).rejects.toThrow('monitor.yml');

    expect(calls).toEqual([
      'dispatch:deploy.yml',
      'watch:301',
      'dispatch:monitor.yml',
      'watch:302',
    ]);
  });

  it('blocks monitor when a provider dispatch fails', async () => {
    const calls: string[] = [];
    const execute = vi.fn(async (args: string[]) => {
      if (args[0] !== 'workflow') throw new Error('monitor must not be watched');
      const workflow = args[2];
      calls.push(`dispatch:${workflow}`);
      if (workflow === 'deploy.yml') return { code: 1, stdout: '', stderr: 'provider denied', timedOut: false };
      return { code: 0, stdout: 'https://github.com/example/repo/actions/runs/202', stderr: '', timedOut: false };
    });

    await expect(dispatchDeployments({
      env: {
        DEPLOY_REVISION: 'd'.repeat(40),
        DEPLOY_WORKFLOWS: 'deploy.yml deploy-pages.yml monitor.yml',
      },
      execute,
    })).rejects.toThrow('2 failed dispatch');

    expect(calls).toEqual(['dispatch:deploy.yml', 'dispatch:deploy-pages.yml']);
  });
});
