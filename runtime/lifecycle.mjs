export const LIFECYCLE_STATES = Object.freeze({
  AVAILABLE: "available",
  INSTALLING: "installing",
  INSTALLED: "installed",
  VERIFYING: "verifying",
  ACTIVE: "active",
  FAILED: "failed",
  ROLLBACK: "rollback",
  REMOVED: "removed",
});

const allowedTransitions = {
  available: ["installing"],
  installing: ["installed", "failed"],
  installed: ["verifying", "removed", "rollback"],
  verifying: ["active", "failed"],
  active: ["verifying", "rollback", "removed"],
  failed: ["rollback", "removed", "installing"],
  rollback: ["verifying", "failed"],
  removed: ["installing"],
};

export function canTransition(from, to) {
  return Boolean(allowedTransitions[from]?.includes(to));
}

export function transitionPlugin(plugin, nextState) {
  const current = plugin.state ?? LIFECYCLE_STATES.AVAILABLE;
  if (!canTransition(current, nextState)) {
    throw new Error(`invalid runtime transition: ${current} -> ${nextState}`);
  }

  return {
    ...plugin,
    state: nextState,
    updatedAt: new Date().toISOString(),
  };
}

export function createRuntimeRecord(id, version = "0.1.0") {
  return {
    id,
    version,
    state: LIFECYCLE_STATES.AVAILABLE,
    activated: false,
    restartRequired: false,
    history: [],
  };
}
