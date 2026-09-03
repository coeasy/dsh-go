import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
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

function registryCachePath(registry) {
  const root = resolve(process.env.DSH_REGISTRY_CACHE_DIR || join(homedir(), '.dsh', 'cache', 'registries'));
  const safeName = String(registry.name || 'registry').replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'registry';
  const sourceHash = createHash('sha256').update(String(registry.url)).digest('hex').slice(0, 16);
  return join(root, `${safeName}-${sourceHash}.json`);
}

function bindRegistryContext(registry) {
  process.env.DSH_SELECTED_REGISTRY_NAME = registry.name;
  process.env.DSH_SELECTED_REGISTRY_URL = registry.url;
  process.env.DSH_SELECTED_REGISTRY_TRUSTED = registry.trusted ? '1' : '0';
  process.env.DSH_REGISTRY_CACHE = registryCachePath(registry);
  if (registry.organization) process.env.DSH_SELECTED_REGISTRY_ORGANIZATION = registry.organization;
  else delete process.env.DSH_SELECTED_REGISTRY_ORGANIZATION;
  if (registry.auth_env) process.env.DSH_REGISTRY_AUTH_ENV = registry.auth_env;
  else delete process.env.DSH_REGISTRY_AUTH_ENV;
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
  const source = String(record?.source_registry || record?.source?.registry || '').trim();
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
  bindRegistryContext(registry);
  return { args: values, registry };
}

export async function resolveDeepLinkRegistryArgs(args = []) {
  const values = [...args];
  if (values[0] !== 'host' || values[1] !== 'handle' || !values[2]) return values;

  let deepLink;
  try {
    deepLink = new URL(values[2]);
  } catch {
    return values;
  }
  if (deepLink.protocol !== 'dsh:') return values;

  const requested = String(deepLink.searchParams.get('registry') || '').trim();
  if (!requested) return values;

  let registry;
  if (looksLikeSource(requested)) {
    registry = {
      name: requested,
      url: requested,
      priority: 0,
      trusted: false,
      enabled: true,
      organization: null,
      scope: 'direct',
      auth_env: null,
    };
  } else {
    const config = await readRegistries();
    registry = config.registries.find((item) => item.enabled !== false && item.name.toLowerCase() === requested.toLowerCase());
    if (!registry) {
      const error = new Error(`registry not configured: ${requested}`);
      error.code = 'DSH_REGISTRY_NOT_FOUND';
      throw error;
    }
  }

  deepLink.searchParams.set('registry', registry.url);
  values[2] = deepLink.toString();
  bindRegistryContext(registry);
  return values;
}
