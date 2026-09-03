import { parsePackageRequest } from './package-model.mjs';
import { getRuntimePackage, readRuntimeRegistry } from './registry.mjs';
import { readRegistries } from './registry-manager.mjs';

function optionIndex(args, name) {
  return args.indexOf(name);
}

function option(args, name, fallback = undefined) {
  const index = optionIndex(args, name);
  return index >= 0 ? args[index + 1] : fallback;
}

function shouldPreserveRegistryName(args) {
  if (args[0] === 'registry') return true;
  return args[0] === 'package' && args[1] === 'resolve-registry';
}

function looksLikeSource(value) {
  const input = String(value || '').trim();
  return /^https?:\/\//i.test(input)
    || input.startsWith('.')
    || input.startsWith('/')
    || input.includes('\\')
    || input.includes('/')
    || input.toLowerCase().endsWith('.json');
}

function updateTarget(args) {
  const command = args[0];
  if (['plugin', 'mcp', 'skill', 'agent'].includes(command) && ['update', 'repair'].includes(args[1]) && args[2]) {
    const request = parsePackageRequest(args[2], { defaultType: command, defaultVersion: '*' });
    return { type: request.type, id: request.id };
  }
  if (command === 'package' && ['update', 'repair'].includes(args[1]) && args[2]) {
    const request = parsePackageRequest(args[2], { defaultType: option(args, '--type', 'plugin'), defaultVersion: '*' });
    return { type: request.type, id: request.id };
  }
  return null;
}

export async function inheritInstalledRegistryArgs(args = []) {
  const values = [...args];
  if (optionIndex(values, '--registry') >= 0) return values;
  const target = updateTarget(values);
  if (!target) return values;
  const runtime = await readRuntimeRegistry(option(values, '--runtime-registry'));
  const record = getRuntimePackage(runtime, target.type, target.id);
  const source = String(record?.source_registry || '').trim();
  if (!source || source === 'official') return values;
  values.push('--registry', source);
  return values;
}

export async function resolveNamedRegistryArgs(args = []) {
  const values = [...args];
  if (shouldPreserveRegistryName(values)) return { args: values, registry: null };
  const index = optionIndex(values, '--registry');
  if (index < 0 || !values[index + 1] || looksLikeSource(values[index + 1])) return { args: values, registry: null };
  const requested = values[index + 1];
  const config = await readRegistries();
  const registry = config.registries.find((item) => item.name.toLowerCase() === String(requested).toLowerCase());
  if (!registry) return { args: values, registry: null };
  values[index + 1] = registry.url;
  process.env.DSH_SELECTED_REGISTRY_NAME = registry.name;
  process.env.DSH_SELECTED_REGISTRY_URL = registry.url;
  process.env.DSH_SELECTED_REGISTRY_TRUSTED = registry.trusted ? '1' : '0';
  if (registry.organization) process.env.DSH_SELECTED_REGISTRY_ORGANIZATION = registry.organization;
  else delete process.env.DSH_SELECTED_REGISTRY_ORGANIZATION;
  if (registry.auth_env) process.env.DSH_REGISTRY_AUTH_ENV = registry.auth_env;
  else delete process.env.DSH_REGISTRY_AUTH_ENV;
  return { args: values, registry };
}
