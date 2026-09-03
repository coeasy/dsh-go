import { printCliValue } from './cli-output.mjs';
import {
  addRegistry,
  loadMergedConfiguredRegistry,
  readRegistryConfig,
  refreshConfiguredRegistry,
  registriesFile,
  registryDoctor,
  removeRegistry,
} from './registry-manager.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positional(args, index) {
  const value = args[index];
  return value && !value.startsWith('--') ? value : undefined;
}

export function isRegistryCommand(args = process.argv.slice(2)) {
  return args[0] === 'registry';
}

export async function runRegistryCli(args = process.argv.slice(2)) {
  const action = args[1] || 'list';
  const file = option(args, '--file', registriesFile());
  let result;

  if (action === 'list') {
    const config = await readRegistryConfig(file);
    result = { file, ...config };
  } else if (action === 'add') {
    const name = positional(args, 2);
    const source = positional(args, 3);
    if (!name || !source) throw new Error('registry add requires <name> <url-or-path>');
    result = await addRegistry(name, source, {
      file,
      priority: option(args, '--priority', 100),
      trust: option(args, '--trust', 'community'),
      mirrors: String(option(args, '--mirrors', '')).split(',').map((value) => value.trim()).filter(Boolean),
      enabled: !args.includes('--disabled'),
    });
  } else if (action === 'remove') {
    const name = positional(args, 2);
    if (!name) throw new Error('registry remove requires <name>');
    result = await removeRegistry(name, { file });
  } else if (action === 'refresh') {
    const name = positional(args, 2);
    if (name) result = await refreshConfiguredRegistry(name, { file });
    else {
      const doctor = await registryDoctor({ file });
      result = { ...doctor, action: 'refresh' };
      if (!result.healthy) process.exitCode = 1;
    }
  } else if (action === 'doctor') {
    result = await registryDoctor({ file });
    if (!result.healthy) process.exitCode = 1;
  } else if (action === 'merge') {
    const merged = await loadMergedConfiguredRegistry({ file });
    result = {
      registry_version: merged.registry.registry_version,
      schema_version: merged.registry.schema_version,
      package_count: merged.registry.plugins.length,
      content_hash: merged.registry.generated?.content_hash || null,
      sources: merged.sources.map((source) => ({ name: source.entry.name, priority: source.entry.priority, content_hash: source.content_hash })),
    };
  } else {
    throw new Error(`unsupported registry action: ${action}`);
  }

  printCliValue(result, { argv: args });
  return result;
}
