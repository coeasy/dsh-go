import { checkRuntimePackageHealth } from './health.mjs';
import { recordRuntimeEvent, transitionPackage } from './lifecycle.mjs';
import { packageKey } from './package-model.mjs';

function label(pkg) {
  return packageKey(pkg.type || 'plugin', pkg.id);
}

export async function inspectPackage(pkg, options = {}) {
  return { package: pkg, health: await checkRuntimePackageHealth(pkg, options) };
}

export function enablePackage(pkg) {
  if (pkg.state === 'removed') throw new Error(`cannot enable removed runtime package: ${label(pkg)}`);
  const next = pkg.state === 'disabled' ? transitionPackage(pkg, 'installed', { event: 'enabled' }) : recordRuntimeEvent(pkg, 'enabled');
  return { ...next, enabled: true, activated: false, restart_required: true };
}

export function disablePackage(pkg) {
  if (pkg.state === 'removed') throw new Error(`cannot disable removed runtime package: ${label(pkg)}`);
  const next = pkg.state === 'disabled' ? recordRuntimeEvent(pkg, 'disabled') : transitionPackage(pkg, 'disabled', { event: 'disabled' });
  return { ...next, enabled: false, activated: false, restart_required: true, binding: null };
}

export function activatePackage(pkg, binding = pkg.binding || null) {
  if (!pkg.enabled) throw new Error(`cannot activate disabled runtime package: ${label(pkg)}`);
  let next = pkg;
  if (next.state === 'installed' || next.state === 'failed') {
    next = transitionPackage(next, 'verifying', { event: 'activation-verify' });
  }
  next = transitionPackage(next, 'active', { event: 'activated' });
  return { ...next, activated: true, restart_required: false, health: null, binding };
}

export function deactivatePackage(pkg) {
  return { ...disablePackage(pkg), activated: false, binding: null };
}

export async function inspectPlugin(plugin, options = {}) {
  const result = await inspectPackage({ ...plugin, type: 'plugin' }, options);
  return { plugin: result.package, health: result.health };
}

export function enablePlugin(plugin) {
  return enablePackage({ ...plugin, type: 'plugin' });
}

export function disablePlugin(plugin) {
  return disablePackage({ ...plugin, type: 'plugin' });
}

export function activatePlugin(plugin) {
  return activatePackage({ ...plugin, type: 'plugin' });
}

export function deactivatePlugin(plugin) {
  return deactivatePackage({ ...plugin, type: 'plugin' });
}
