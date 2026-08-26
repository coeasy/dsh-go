import { describe, expect, it, vi } from 'vitest';
import {
  dispatchDeployments,
  isWorkflowRegistrationError,
  parseWorkflowList,
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

  it('continues fan-out after one provider fails and retries registration lag only', async () => {
    const calls: string[] = [];
    let pagesAttempt = 0;
    const execute = vi.fn(async (args: string[]) => {
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
});
