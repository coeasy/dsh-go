import { checkRuntimeHealth } from './health.mjs';
import { transitionPlugin } from './lifecycle.mjs';

export function inspectPlugin(plugin) {
  return {
    plugin,
    health: checkRuntimeHealth(plugin),
  };
}

export function activatePlugin(plugin) {
  const updated = transitionPlugin(plugin, 'active');
  return {
    ...updated,
    activated: true,
    restartRequired: true,
  };
}

export function deactivatePlugin(plugin) {
  return {
    ...plugin,
    activated: false,
    restartRequired: true,
    updatedAt: new Date().toISOString(),
  };
}
