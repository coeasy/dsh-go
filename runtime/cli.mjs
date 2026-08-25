#!/usr/bin/env node
import { installPlugin } from './installer.mjs';
import { loadInstalledPlugin } from './loader.mjs';
import { loadRegistryFile, parsePluginSpec, resolvePlugin } from './resolver.mjs';
import { verifyResolvedPlugin } from './verifier.mjs';
import { validateRegistry } from '../scripts/validate-registry-v3.mjs';

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function main() {
  const command = process.argv[2] || 'check-registry';
  const registryPath = option('--registry', 'catalog/registry-v3.json');
  if (command === 'check-registry') {
    const registry = await loadRegistryFile(registryPath);
    const result = validateRegistry(registry);
    if (result.errors.length) throw new Error(result.errors.join('; '));
    if (registry.plugins.length) {
      const first = resolvePlugin(registry, registry.plugins[0].id, registry.plugins[0].version);
      const verification = verifyResolvedPlugin(first);
      if (!verification.ok) throw new Error(verification.errors.join('; '));
    }
    console.log(`Runtime registry check passed: ${registry.plugins.length} plugins`);
    return;
  }
  if (command === 'resolve') {
    const registry = await loadRegistryFile(registryPath);
    const spec = parsePluginSpec(process.argv[3], registry.defaults?.plugin_version);
    console.log(JSON.stringify(resolvePlugin(registry, spec.id, spec.version), null, 2));
    return;
  }
  if (command === 'install') {
    const registry = await loadRegistryFile(registryPath);
    const spec = parsePluginSpec(process.argv[3], registry.defaults?.plugin_version);
    const plugin = resolvePlugin(registry, spec.id, spec.version);
    const result = await installPlugin(plugin, { root: option('--root'), force: process.argv.includes('--force'), dryRun: process.argv.includes('--dry-run') });
    console.log(JSON.stringify(result, null, 2));
    if (!process.argv.includes('--dry-run')) console.log('Install verified. Restart the client to activate the plugin.');
    return;
  }
  if (command === 'load') {
    const spec = parsePluginSpec(process.argv[3]);
    const descriptor = await loadInstalledPlugin(spec.id, { root: option('--root'), version: spec.version });
    console.log(JSON.stringify(descriptor, null, 2));
    return;
  }
  throw new Error(`unknown runtime command: ${command}`);
}
main().catch((error) => { console.error('[runtime]', error.stack || error.message); process.exit(1); });
