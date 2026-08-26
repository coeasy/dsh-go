import { assertPackageType } from './package-model.mjs';

export const LIFECYCLE_STATES = Object.freeze({
  AVAILABLE: 'available',
  INSTALLING: 'installing',
  INSTALLED: 'installed',
  VERIFYING: 'verifying',
  ACTIVE: 'active',
  DISABLED: 'disabled',
  FAILED: 'failed',
  ROLLBACK: 'rollback',
  REMOVED: 'removed',
});

const allowedTransitions = Object.freeze({
  available: ['installing', 'removed'],
  installing: ['installed', 'failed'],
  installed: ['installing', 'verifying', 'disabled', 'rollback', 'removed', 'failed'],
  verifying: ['active', 'failed', 'disabled'],
  active: ['installing', 'verifying', 'disabled', 'rollback', 'removed', 'failed'],
  disabled: ['installed', 'installing', 'removed'],
  failed: ['installing', 'verifying', 'rollback', 'removed'],
  rollback: ['installed', 'verifying', 'failed'],
  removed: ['installing'],
});

function timestamp() {
  return new Date().toISOString();
}

function historyEntry(event, state, details = {}) {
  return { event, state, at: timestamp(), ...details };
}

export function canTransition(from, to) {
  return from === to || Boolean(allowedTransitions[from]?.includes(to));
}

export function recordRuntimeEvent(pkg, event, details = {}) {
  const state = pkg.state || LIFECYCLE_STATES.AVAILABLE;
  const history = [...(pkg.history || []), historyEntry(event, state, details)].slice(-100);
  return { ...pkg, history, updated_at: timestamp() };
}

export function transitionPackage(pkg, nextState, options = {}) {
  const current = pkg.state || LIFECYCLE_STATES.AVAILABLE;
  if (!canTransition(current, nextState)) {
    throw new Error(`invalid runtime transition: ${current} -> ${nextState}`);
  }
  if (current === nextState && !options.event) return pkg;
  const updated = {
    ...pkg,
    ...options.patch,
    state: nextState,
    updated_at: timestamp(),
  };
  return recordRuntimeEvent(updated, options.event || 'state-change', {
    from: current,
    to: nextState,
    ...(options.details || {}),
  });
}

export function createRuntimePackageRecord(type, id, version = '0.1.0', overrides = {}) {
  const createdAt = timestamp();
  return {
    id,
    type: assertPackageType(type),
    version,
    state: LIFECYCLE_STATES.AVAILABLE,
    channel: 'stable',
    enabled: true,
    activated: false,
    restart_required: false,
    health: null,
    rollback: null,
    dependencies: [],
    binding: null,
    history: [historyEntry('created', LIFECYCLE_STATES.AVAILABLE)],
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides,
  };
}

export function transitionPlugin(plugin, nextState, options = {}) {
  return transitionPackage(plugin, nextState, options);
}

export function createRuntimeRecord(id, version = '0.1.0', overrides = {}) {
  return createRuntimePackageRecord('plugin', id, version, overrides);
}
