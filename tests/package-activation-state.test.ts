import { describe, expect, it } from 'vitest';
import {
  operationActivationState,
  packageActivationState,
  withPackageActivationState,
} from '../runtime/package-status.mjs';

describe('package activation lifecycle state', () => {
  it('derives pending restart without changing the persisted runtime schema', () => {
    expect(packageActivationState({ state: 'installed', activated: false, restart_required: true, enabled: true }))
      .toBe('pending-restart');
    expect(withPackageActivationState({ id: 'demo', state: 'installed', activated: false, restart_required: true }))
      .toMatchObject({ id: 'demo', activation_state: 'pending-restart' });
  });

  it('prioritizes terminal and disabled states', () => {
    expect(packageActivationState({ state: 'removed', restart_required: true })).toBe('removed');
    expect(packageActivationState({ state: 'failed', restart_required: true })).toBe('failed');
    expect(packageActivationState({ state: 'installed', enabled: false, restart_required: true })).toBe('disabled');
    expect(packageActivationState({ state: 'installed', activated: true, restart_required: false })).toBe('active');
  });

  it('derives operation result states consistently', () => {
    expect(operationActivationState({ dryRun: true })).toBe('planned');
    expect(operationActivationState({ removed: true })).toBe('removed');
    expect(operationActivationState({ enabled: false })).toBe('disabled');
    expect(operationActivationState()).toBe('pending-restart');
  });
});
