import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { DEFAULT_DISTRIBUTION_URL, loadRegistrySource } from './catalog.mjs';
import { assertPackageType, packageKey } from './package-model.mjs';
import { resolvePackage } from './resolver.mjs';

export function registriesPath() {
  return resolve(process.env.DSH_REGISTRIES_FILE || join(homedir(), '.dsh', 'registries.json'));
}

function defaultConfig() {
  return {
    schema_version: 1,
    registries: [{ name: 'official', url: DEFAULT_DISTRIBUTION_URL, priority: 100, trusted: true, enabled: true }],
  };
}

function normalizeRegistry(item) {
  if (!item?.name || !item?.url) throw new Error('registry requires name and url');
  return {
    name: String(item.name),
    url: String(item.url),
    priority: Number.isFinite(Number(item.priority)) ? Number(item.priority) : 0,
    trusted: item.trusted === true,
    enabled: item.enabled !== false,
  };
}

export async function readRegistries(file = registriesPath()) {
  try {
    const parsed = JSON.parse(await readFile(file, 'utf8'));
    if (parsed?.schema_version !== 1 || !Array.isArray(parsed.registries)) throw new Error('invalid registry configuration');
    return { ...parsed, registries: parsed.registries.map(normalizeRegistry) };
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultConfig();
    throw error;
  }
}

async function writeAtomic(file, value) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return target;
}

export async function writeRegistries(config, file = registriesPath()) {
  const names = new Set();
  const registries = (config.registries || []).map(normalizeRegistry).map((item) => {
    const key = item.name.toLowerCase();
    if (names.has(key)) throw new Error(`duplicate registry name: ${item.name}`);
    names.add(key);
    return item;
  });
  await writeAtomic(file, { schema_version: 1, registries });
  return { file: resolve(file), registries };
}

export async function addRegistry(name, url, options = {}) {
  const file = options.file || registriesPath();
  const config = await readRegistries(file);
  if (config.registries.some((item) => item.name.toLowerCase() === String(name).toLowerCase())) {
    const error = new Error(`registry already exists: ${name}`);
    error.code = 'DSH_REGISTRY_EXISTS';
    throw error;
  }
  config.registries.push(normalizeRegistry({ name, url, priority: options.priority, trusted: options.trusted, enabled: true }));
  return writeRegistries(config, file);
}

export async function removeRegistry(name, options = {}) {
  const file = options.file || registriesPath();
  const config = await readRegistries(file);
  const next = config.registries.filter((item) => item.name.toLowerCase() !== String(name).toLowerCase());
  if (next.length === config.registries.length) {
    const error = new Error(`registry not found: ${name}`);
    error.code = 'DSH_REGISTRY_NOT_FOUND';
    throw error;
  }
  return writeRegistries({ ...config, registries: next }, file);
}

function publisherIdentity(pkg) {
  const publisher = pkg?.publisher || pkg?.metadata?.publisher || null;
  return String(publisher?.id || publisher?.login || publisher?.name || publisher?.organization || pkg?.source?.repo?.split('/')[0] || '').toLowerCase();
}

export async function inspectRegistries(options = {}) {
  const config = await readRegistries(options.file || registriesPath());
  const results = [];
  for (const registry of config.registries) {
    if (!registry.enabled) {
      results.push({ ...registry, ok: true, skipped: true });
      continue;
    }
    try {
      const data = await loadRegistrySource(registry.url, { allowStale: options.allowStale !== false });
      results.push({ ...registry, ok: true, registry_version: data.registry_version, content_hash: data.generated?.content_hash || null, packages: data.plugins.length });
    } catch (error) {
      results.push({ ...registry, ok: false, error: error.message, code: error.code || 'DSH_REGISTRY_UNAVAILABLE' });
    }
  }
  return { file: resolve(options.file || registriesPath()), registries: results, healthy: results.filter((item) => item.enabled !== false).every((item) => item.ok) };
}

export async function resolveAcrossRegistries(raw, options = {}) {
  const type = assertPackageType(options.type || 'plugin');
  const id = String(raw || '');
  const range = options.version || '*';
  const channel = options.channel || 'stable';
  const config = await readRegistries(options.file || registriesPath());
  let registries = config.registries.filter((item) => item.enabled !== false);
  if (options.registry) registries = registries.filter((item) => item.name === options.registry || item.url === options.registry);
  if (!registries.length) {
    const error = new Error(`registry not configured: ${options.registry || '<none>'}`);
    error.code = 'DSH_REGISTRY_NOT_FOUND';
    throw error;
  }

  const candidates = [];
  for (const registry of registries) {
    try {
      const data = await loadRegistrySource(registry.url, { allowStale: options.allowStale !== false });
      let resolved;
      try {
        resolved = resolvePackage(data, type, id, range, { channel });
      } catch (first) {
        const repoMatch = (data.plugins || []).find((item) => item.source?.repo === id && (item.runtime?.type || item.type || 'plugin') === type);
        if (!repoMatch) throw first;
        resolved = resolvePackage(data, type, repoMatch.id, range, { channel });
      }
      candidates.push({ registry, data, package: resolved, publisher_identity: publisherIdentity(resolved) });
    } catch (error) {
      if (['DSH_PACKAGE_YANKED', 'DSH_PACKAGE_REVOKED', 'DSH_SECURITY_ADVISORY_BLOCKED'].includes(error.code)) throw error;
    }
  }
  if (!candidates.length) {
    const error = new Error(`runtime package not found across registries: ${packageKey(type, id)}@${range}`);
    error.code = 'DSH_PACKAGE_NOT_FOUND';
    throw error;
  }

  const identities = [...new Set(candidates.map((item) => item.publisher_identity).filter(Boolean))];
  if (identities.length > 1) {
    const error = new Error(`registry identity conflict for ${packageKey(type, id)}: ${identities.join(', ')}`);
    error.code = 'DSH_REGISTRY_IDENTITY_CONFLICT';
    error.candidates = candidates.map((item) => ({ registry: item.registry.name, publisher_identity: item.publisher_identity, version: item.package.version }));
    throw error;
  }

  candidates.sort((left, right) => {
    if (left.registry.trusted !== right.registry.trusted) return left.registry.trusted ? -1 : 1;
    if (left.registry.priority !== right.registry.priority) return right.registry.priority - left.registry.priority;
    return left.registry.name.localeCompare(right.registry.name);
  });
  const selected = candidates[0];
  return {
    registry: selected.registry,
    package: { ...selected.package, source_registry: selected.registry.name },
    candidates: candidates.map((item) => ({ registry: item.registry.name, trusted: item.registry.trusted, priority: item.registry.priority, version: item.package.version, publisher_identity: item.publisher_identity })),
  };
}
