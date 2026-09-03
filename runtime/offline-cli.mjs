import { access, readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { registryCacheFile, registryCacheMetadataFile } from './catalog.mjs';
import { parsePackageRequest, packageKey } from './package-model.mjs';
import { getRuntimePackage, packagePath, readRuntimeRegistry } from './registry.mjs';
import { readInstallLock } from './verifier.mjs';
import { packageActivationState } from './package-status.mjs';
import { printCliValue } from './cli-output.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function inspectRegistryCache(options = {}) {
  const file = resolve(options.cacheFile || registryCacheFile());
  const metadataFile = resolve(options.metadataFile || registryCacheMetadataFile(file));
  if (!await exists(file)) {
    const error = new Error(`registry cache is not available: ${file}`);
    error.code = 'DSH_REGISTRY_CACHE_MISSING';
    throw error;
  }
  const registry = await readJson(file);
  if (registry?.registry_version !== 3 || !Array.isArray(registry?.plugins)) {
    const error = new Error(`cached registry is not Registry V3: ${file}`);
    error.code = 'DSH_REGISTRY_CACHE_INVALID';
    throw error;
  }
  const metadata = await exists(metadataFile) ? await readJson(metadataFile) : null;
  const info = await stat(file);
  return {
    available: true,
    offline_safe: true,
    path: file,
    metadata_path: metadataFile,
    registry_version: registry.registry_version,
    schema_version: registry.schema_version || null,
    package_count: registry.plugins.length,
    content_hash: registry.generated?.content_hash || metadata?.content_hash || null,
    generated_at: registry.generated?.at || registry.generated?.generated_at || null,
    cached_at: info.mtime.toISOString(),
    source: metadata?.source || null,
    mode: metadata?.mode || null,
    stale: Boolean(metadata?.stale),
    checked_at: metadata?.checked_at || null,
  };
}

export async function inspectInstalledLock(rawSpec, options = {}) {
  const request = parsePackageRequest(rawSpec, {
    defaultType: options.type || 'plugin',
    defaultVersion: '*',
    channel: options.channel || 'stable',
  });
  const runtime = await readRuntimeRegistry(options.registryFile);
  const record = getRuntimePackage(runtime, request.type, request.id, { includeRemoved: true });
  if (!record || record.state === 'removed') {
    const error = new Error(`runtime package is not installed: ${packageKey(request.type, request.id)}`);
    error.code = 'DSH_PACKAGE_NOT_INSTALLED';
    throw error;
  }
  const target = record.path || packagePath(request.type, request.id, options.root);
  let lock;
  try {
    lock = await readInstallLock(target);
  } catch (error) {
    error.code ||= 'DSH_INSTALL_LOCK_UNAVAILABLE';
    throw error;
  }
  return {
    id: request.id,
    type: request.type,
    key: packageKey(request.type, request.id),
    activation_state: packageActivationState(record),
    runtime_state: record.state,
    enabled: record.enabled !== false,
    restart_required: record.restart_required === true,
    path: target,
    lock,
    offline_safe: true,
  };
}

export function isOfflineCommand(args = process.argv.slice(2)) {
  return args[0] === 'cache' || (args[0] === 'package' && args[1] === 'lock');
}

export async function runOfflineCli(args = process.argv.slice(2)) {
  if (args[0] === 'cache') {
    const action = args[1] || 'status';
    if (action !== 'status') throw new Error(`unsupported cache action: ${action}`);
    const result = await inspectRegistryCache({
      cacheFile: option(args, '--registry-cache'),
      metadataFile: option(args, '--metadata'),
    });
    printCliValue(result, { argv: args });
    return result;
  }

  if (args[0] === 'package' && args[1] === 'lock') {
    const raw = args[2];
    if (!raw || raw.startsWith('--')) {
      const error = new Error('package lock requires <type:id>');
      error.code = 'DSH_PACKAGE_SPEC_REQUIRED';
      throw error;
    }
    const result = await inspectInstalledLock(raw, {
      type: option(args, '--type'),
      registryFile: option(args, '--runtime-registry'),
      root: option(args, '--root'),
    });
    printCliValue(result, { argv: args });
    return result;
  }

  throw new Error(`unsupported offline command: ${args.join(' ')}`);
}
