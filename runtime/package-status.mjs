export function packageActivationState(record = {}) {
  const state = String(record.state || 'unknown');
  if (state === 'removed') return 'removed';
  if (state === 'failed') return 'failed';
  if (state === 'installing') return 'installing';
  if (record.enabled === false || state === 'disabled') return 'disabled';
  if (record.restart_required === true && record.activated !== true) return 'pending-restart';
  if (record.activated === true) return 'active';
  return state;
}

export function withPackageActivationState(record = {}) {
  return {
    ...record,
    activation_state: packageActivationState(record),
  };
}

export function operationActivationState({ dryRun = false, removed = false, enabled = true } = {}) {
  if (dryRun) return 'planned';
  if (removed) return 'removed';
  if (!enabled) return 'disabled';
  return 'pending-restart';
}
