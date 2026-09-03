import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { ensureRegistryCache } from './catalog.mjs';
import { inferPackageType, packageKey } from './package-model.mjs';

export const REGISTRY_CONFIG_SCHEMA_VERSION = 1;
const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export function registriesFile() {
  return resolve(process.env.DSH_REGISTRIES_FILE || join(homedir(), '.dsh', 'registries.json'));
}

export function registryCacheRoot() {
  return resolve(process.env.DSH_REGISTRIES_CACHE_HOME || join(homedir(), '.dsh', 'cache', 'registries'));
}

function defaultConfig() {
  return { schema_version: REGISTRY_CONFIG_SCHEMA_VERSION, registries: [] };
}

function normalizeRegistry(entry) {
  const name = String(entry?.name || '').trim();
  if (!NAME_RE.test(name)) throw new Error(`invalid registry name: ${name || '<empty>'}`);
  const source = String(entry?.source || entry?.url || '').trim();
  if (!source) throw new Error(`registry source is required: ${name}`);
  const mirrors = Array.isArray(entry?.mirrors) ? [...new Set(entry.mirrors.map((value) => String(value || '').trim()).filter(Boolean))] : [];
  return {
    name,
    source,
    priority: Number.isFinite(Number(entry?.priority)) ? Number(entry.priority) : 100,
    enabled: entry?.enabled !== false,
    trust: String(entry?.trust || 'community'),
    mirrors,
  };
}

async function writeAtomic(file, value) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
}

export async function readRegistryConfig(file = registriesFile()) {
  try {
    const data = JSON.parse(await readFile(resolve(file), 'utf8'));
    if (data?.schema_version !== REGISTRY_CONFIG_SCHEMA_VERSION || !Array.isArray(data?.registries)) {
      throw new Error(`unsupported registry config schema: ${data?.schema_version}`);
    }
    const seen = new Set();
    const registries = data.registries.map(normalizeRegistry).map((entry) => {
      const key = entry.name.toLowerCase();
      if (seen.has(key)) throw new Error(`duplicate registry name: ${entry.name}`);
      seen.add(key);
      return entry;
    });
    return { schema_version: REGISTRY_CONFIG_SCHEMA_VERSION, registries };
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultConfig();
    throw error;
  }
}

export async function addRegistry(name, source, options = {}) {
  const file = resolve(options.file || registriesFile());
  const config = await readRegistryConfig(file);
  const entry = normalizeRegistry({ name, source, priority: options.priority, enabled: options.enabled, trust: options.trust, mirrors: options.mirrors });
  const key = entry.name.toLowerCase();
  if (config.registries.some((item) => item.name.toLowerCase() === key)) {
    const error = new Error(`registry already exists: ${entry.name}`);
    error.code = 'DSH_REGISTRY_EXISTS';
    throw error;
  }
  const next = { ...config, registries: [...config.registries, entry].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name)) };
  await writeAtomic(file, next);
  return { file, registry: entry };
}

export async function removeRegistry(name, options = {}) {
  const file = resolve(options.file || registriesFile());
  const config = await readRegistryConfig(file);
  const key = String(name || '').toLowerCase();
  const existing = config.registries.find((item) => item.name.toLowerCase() === key);
  if (!existing) {
    const error = new Error(`registry not found: ${name}`);
    error.code = 'DSH_REGISTRY_NOT_FOUND';
    throw error;
  }
  const next = { ...config, registries: config.registries.filter((item) => item.name.toLowerCase() !== key) };
  await writeAtomic(file, next);
  return { file, removed: existing };
}

function registryCacheFileFor(name, suffix = '') {
  return join(registryCacheRoot(), `${name}${suffix}.json`);
}

async function loadRegistrySource(source, options = {}) {
  const cacheFile = options.cacheFile;
  const file = await ensureRegistryCache(source, { cacheFile, allowStale: options.allowStale !== false });
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data?.registry_version !== 3 || !Array.isArray(data?.plugins)) {
    const error = new Error(`registry source is not Registry V3: ${source}`);
    error.code = 'DSH_REGISTRY_INVALID';
    throw error;
  }
  return data;
}

function packageLogicalKey(item) {
  const type = inferPackageType(item);
  const channel = item.channel || item.release_channel || 'stable';
  return `${packageKey(type, item.id)}@${item.version}#${channel}`;
}

function publisherIdentity(item) {
  const publisher = item.publisher || {};
  return publisher.id || publisher.identity || publisher.owner || publisher.name || null;
}

function securityIdentity(item) {
  const signature = item.security?.signature || item.signature || null;
  const provenance = item.security?.provenance || item.provenance || null;
  return {
    source: {
      provider: item.source?.provider || null,
      repo: item.source?.repo || null,
      commit: item.source?.commit || null,
    },
    artifact: {
      kind: item.artifact?.kind || null,
      integrity: item.artifact?.integrity || null,
      algorithm: item.artifact?.algorithm || null,
    },
    publisher: publisherIdentity(item),
    signature: signature ? {
      identity: signature.identity || signature.subject || null,
      issuer: signature.issuer || null,
      digest: signature.digest || null,
    } : null,
    provenance: provenance ? {
      builder: provenance.builder || provenance.builder_id || null,
      digest: provenance.digest || null,
    } : null,
  };
}

function identityFingerprint(item) {
  return createHash('sha256').update(JSON.stringify(securityIdentity(item))).digest('hex');
}

export function registryDocumentHash(registry) {
  const rows = [...(registry.plugins || [])]
    .map((item) => ({ key: packageLogicalKey(item), identity: identityFingerprint(item) }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return createHash('sha256').update(JSON.stringify(rows)).digest('hex');
}

function sourceHash(registry) {
  return registry.generated?.content_hash || registryDocumentHash(registry);
}

export async function loadConfiguredRegistry(name, options = {}) {
  const config = await readRegistryConfig(options.file || registriesFile());
  const entry = config.registries.find((item) => item.name.toLowerCase() === String(name || '').toLowerCase());
  if (!entry) return null;
  const registry = await loadRegistrySource(entry.source, {
    cacheFile: registryCacheFileFor(entry.name),
    allowStale: options.allowStale,
  });
  return { entry, registry, content_hash: sourceHash(registry) };
}

export async function refreshConfiguredRegistry(name, options = {}) {
  const loaded = await loadConfiguredRegistry(name, { ...options, allowStale: false });
  if (!loaded) {
    const error = new Error(`registry not found: ${name}`);
    error.code = 'DSH_REGISTRY_NOT_FOUND';
    throw error;
  }
  const mirrors = [];
  for (let index = 0; index < loaded.entry.mirrors.length; index += 1) {
    const source = loaded.entry.mirrors[index];
    const registry = await loadRegistrySource(source, {
      cacheFile: registryCacheFileFor(loaded.entry.name, `.mirror-${index}`),
      allowStale: false,
    });
    const hash = sourceHash(registry);
    mirrors.push({ source, content_hash: hash, converged: hash === loaded.content_hash });
  }
  const diverged = mirrors.filter((item) => !item.converged);
  if (diverged.length) {
    const error = new Error(`registry mirror convergence failed: ${loaded.entry.name}`);
    error.code = 'DSH_REGISTRY_IDENTITY_CONFLICT';
    error.details = { primary_hash: loaded.content_hash, mirrors };
    throw error;
  }
  return { ...loaded, mirrors, healthy: true };
}

export function mergeRegistryDocuments(sources) {
  const ordered = [...sources].sort((a, b) => a.entry.priority - b.entry.priority || a.entry.name.localeCompare(b.entry.name));
  const selected = new Map();
  const origins = new Map();
  for (const source of ordered) {
    for (const item of source.registry.plugins || []) {
      const key = packageLogicalKey(item);
      const fingerprint = identityFingerprint(item);
      const previous = selected.get(key);
      if (previous) {
        const previousFingerprint = identityFingerprint(previous);
        if (previousFingerprint !== fingerprint) {
          const error = new Error(`registry identity conflict for ${key}: ${origins.get(key).name} vs ${source.entry.name}`);
          error.code = 'DSH_REGISTRY_IDENTITY_CONFLICT';
          error.package = key;
          error.registries = [origins.get(key).name, source.entry.name];
          error.identities = [securityIdentity(previous), securityIdentity(item)];
          throw error;
        }
        origins.get(key).sources.push(source.entry.name);
        continue;
      }
      selected.set(key, { ...item, registry_sources: [source.entry.name] });
      origins.set(key, { name: source.entry.name, sources: [source.entry.name] });
    }
  }
  const plugins = [...selected.values()].sort((a, b) => packageLogicalKey(a).localeCompare(packageLogicalKey(b)));
  for (const item of plugins) {
    const origin = origins.get(packageLogicalKey(item));
    item.registry_sources = origin?.sources || item.registry_sources || [];
  }
  const merged = {
    registry_version: 3,
    schema_version: ordered[0]?.registry?.schema_version || '3.0.0',
    defaults: ordered[0]?.registry?.defaults || {},
    generated: {
      at: new Date().toISOString(),
      count: plugins.length,
      content_hash: '',
      source_registries: ordered.map((source) => ({ name: source.entry.name, priority: source.entry.priority, content_hash: source.content_hash })),
    },
    plugins,
  };
  merged.generated.content_hash = registryDocumentHash(merged);
  return merged;
}

export async function loadMergedConfiguredRegistry(options = {}) {
  const config = await readRegistryConfig(options.file || registriesFile());
  const enabled = config.registries.filter((entry) => entry.enabled);
  if (!enabled.length) {
    const error = new Error('no enabled registries are configured');
    error.code = 'DSH_REGISTRY_UNAVAILABLE';
    throw error;
  }
  const sources = [];
  for (const entry of enabled) {
    const registry = await loadRegistrySource(entry.source, {
      cacheFile: registryCacheFileFor(entry.name),
      allowStale: options.allowStale,
    });
    sources.push({ entry, registry, content_hash: sourceHash(registry) });
  }
  return { registry: mergeRegistryDocuments(sources), sources };
}

export async function resolveConfiguredRegistryReference(value, options = {}) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (raw === '@all' || raw === 'all') return (await loadMergedConfiguredRegistry(options)).registry;
  if (/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(raw)) {
    const loaded = await loadConfiguredRegistry(raw, options);
    if (loaded) return loaded.registry;
  }
  return null;
}

export async function registryDoctor(options = {}) {
  const config = await readRegistryConfig(options.file || registriesFile());
  const results = [];
  for (const entry of config.registries) {
    if (!entry.enabled) {
      results.push({ name: entry.name, enabled: false, healthy: true, skipped: true });
      continue;
    }
    try {
      const refreshed = await refreshConfiguredRegistry(entry.name, options);
      results.push({
        name: entry.name,
        enabled: true,
        healthy: true,
        source: entry.source,
        priority: entry.priority,
        content_hash: refreshed.content_hash,
        package_count: refreshed.registry.plugins.length,
        mirrors: refreshed.mirrors,
      });
    } catch (error) {
      results.push({ name: entry.name, enabled: true, healthy: false, source: entry.source, error: error.message, code: error.code || 'DSH_REGISTRY_UNAVAILABLE' });
    }
  }
  return { file: resolve(options.file || registriesFile()), healthy: results.every((item) => item.healthy), registries: results };
}
