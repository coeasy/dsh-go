import { checkRuntimeHealth } from './health.mjs';
import { recordRuntimeEvent, transitionPlugin } from './lifecycle.mjs';

export async function inspectPlugin(plugin, options = {}) {
  return { plugin, health: await checkRuntimeHealth(plugin, options) };
}

export function enablePlugin(plugin) {
  if (plugin.state === 'removed') throw new Error(`cannot enable removed plugin: ${plugin.id}`);
  const next = plugin.state === 'disabled' ? transitionPlugin(plugin, 'installed', { event: 'enabled' }) : recordRuntimeEvent(plugin, 'enabled');
  return { ...next, enabled: true, activated: false, restart_required: true };
}

export function disablePlugin(plugin) {
  if (plugin.state === 'removed') throw new Error(`cannot disable removed plugin: ${plugin.id}`);
  const next = plugin.state === 'disabled' ? recordRuntimeEvent(plugin, 'disabled') : transitionPlugin(plugin, 'disabled', { event: 'disabled' });
  return { ...next, enabled: false, activated: false, restart_required: true };
}

export function activatePlugin(plugin) {
  if (!plugin.enabled) throw new Error(`cannot activate disabled plugin: ${plugin.id}`);
  let next = plugin;
  if (next.state === 'installed') next = transitionPlugin(next, 'verifying', { event: 'activation-verify' });
  next = transitionPlugin(next, 'active', { event: 'activated' });
  return { ...next, activated: true, restart_required: false };
}

export function deactivatePlugin(plugin) {
  return { ...disablePlugin(plugin), activated: false };
}
