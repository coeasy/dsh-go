import { describe, expect, it } from 'vitest';

const { LIFECYCLE_STATES, createRuntimeRecord, transitionPlugin } = await import('../../runtime/lifecycle.mjs');
const { activatePlugin, disablePlugin, enablePlugin } = await import('../../runtime/platform.mjs');

describe('Runtime Platform V2 lifecycle', () => {
  it('records controlled state transitions and bounded history', () => {
    let record = createRuntimeRecord('demo', '0.1.0');
    record = transitionPlugin(record, LIFECYCLE_STATES.INSTALLING);
    record = transitionPlugin(record, LIFECYCLE_STATES.INSTALLED);
    expect(record.state).toBe('installed');
    expect(record.history.at(-1)?.state).toBe('installed');
    expect(record.history.at(-1)?.event).toBe('state-change');
    expect(() => transitionPlugin(record, 'available')).toThrow(/invalid runtime transition/);
  });

  it('separates desired enablement from activation after restart', () => {
    let record = createRuntimeRecord('demo', '0.1.0', { state: 'installed', restart_required: true });
    record = disablePlugin(record);
    expect(record.enabled).toBe(false);
    expect(record.restart_required).toBe(true);
    record = enablePlugin(record);
    expect(record.enabled).toBe(true);
    expect(record.activated).toBe(false);
    record = activatePlugin(record);
    expect(record.state).toBe('active');
    expect(record.activated).toBe(true);
    expect(record.restart_required).toBe(false);
  });
});
