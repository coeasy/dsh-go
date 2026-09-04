import {
  formatPackageCoordinate,
  normalizePackageId,
  normalizePackageType,
  parseVersion,
} from '../packages/protocol-core/index.mjs';

/** Manifest V2 has exactly one authoritative file name. */
export const DSH_MANIFEST_FILES = Object.freeze(['dsh-package.json']);
const DSH_MANIFEST_SET = new Set(DSH_MANIFEST_FILES);

export function isAuthoritativeDshManifest(file) {
  return DSH_MANIFEST_SET.has(String(file || '').trim().toLowerCase());
}

export function manifestMetadataSource(file) {
  return isAuthoritativeDshManifest(file) ? 'dsh-package' : 'github';
}

export const VALID_PLUGIN_CATEGORIES = Object.freeze(['ui', 'code', 'skills', 'mcp', 'agent', 'productivity', 'integration', 'other']);
export const OVERRIDABLE_PLUGIN_FIELDS = Object.freeze(['name', 'description', 'category', 'tags', 'homepage']);

export function canonicalRepoKey(value) {
  return String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '').toLowerCase();
}

export function isValidRepositoryName(value) {
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(String(value || '').trim());
}

export function repoNameFromFullName(value) {
  const full = String(value || '').trim().replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  if (!full.includes('/')) return '';
  return full.slice(full.indexOf('/') + 1);
}

export function canonicalRepoUrl(fullName) {
  return `https://github.com/${String(fullName || '').trim().replace(/^\/+|\/+$/g, '')}`;
}

export function normalizePluginCategory(value) {
  const category = String(value || '').trim().toLowerCase();
  return VALID_PLUGIN_CATEGORIES.includes(category) ? category : 'other';
}

/** Discovery-only profile helper. Installation itself never uses provider-specific syntax. */
export function installProfile(category) {
  if (category === 'mcp') return { packageType: 'mcp' };
  if (category === 'skills') return { packageType: 'skill' };
  if (category === 'agent') return { packageType: 'agent' };
  return { packageType: 'plugin' };
}

/** Raw GitHub repositories are discovery candidates and intentionally have no install command. */
export function makeInstallCmd() {
  return '';
}

function canonicalCoordinate(packageId, packageType, packageVersion = '*') {
  try {
    const type = normalizePackageType(packageType || 'plugin');
    const id = normalizePackageId(packageId);
    const version = String(packageVersion || '*').trim() || '*';
    if (version !== '*' && version.toLowerCase() !== 'latest') parseVersion(version);
    return formatPackageCoordinate({ type, id, range: version });
  } catch {
    return null;
  }
}

export function makeDshInstallCmd(packageId, packageType = 'plugin', packageVersion = '*') {
  const coordinate = canonicalCoordinate(packageId, packageType, packageVersion);
  return coordinate ? `dsh package install ${coordinate}` : '';
}

export function makeCatalogInstallCmd(record = {}) {
  if (!record.verified || !isAuthoritativeDshManifest(record.manifest_file)) return '';
  return makeDshInstallCmd(record.package_id, record.package_type, record.package_version || '*');
}

export function makeRegistryInstallCmd(record = {}) {
  const type = record.runtime?.type || record.type || record.package_type || 'plugin';
  const id = record.id || record.package_id;
  const version = record.version || record.package_version || '*';
  const coordinate = canonicalCoordinate(id, type, version);
  return coordinate ? `dsh package install ${coordinate}` : '';
}

export function normalizeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    return ['http:', 'https:'].includes(parsed.protocol) ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function normalizeOverrideFields(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter((item) => OVERRIDABLE_PLUGIN_FIELDS.includes(item)))];
}

export function discoveryTopics(value) {
  const explicit = Array.isArray(value?.discovery?.matched_topics) ? value.discovery.matched_topics : [];
  return explicit.map((topic) => String(topic || '').trim().toLowerCase()).filter(Boolean);
}

export function discoveryRepoId(value) {
  const raw = value?.repo_id ?? value?.discovery?.repo_id ?? value?.source?.repo_id ?? value?.github?.id;
  return raw === undefined || raw === null || raw === '' ? '' : String(raw);
}

export function findStoredPluginForRepository(plugins, fullName, repoId = '') {
  const id = repoId ? String(repoId) : '';
  if (id) {
    const byId = (plugins || []).find((plugin) => discoveryRepoId(plugin) === id);
    if (byId) return byId;
  }
  const key = canonicalRepoKey(fullName);
  return (plugins || []).find((plugin) => canonicalRepoKey(plugin.full_name || plugin.repo_url) === key) || null;
}

function slugify(value) {
  const slug = String(value || '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'plugin';
}

function fallbackSlug(plugin) {
  const fullName = plugin.full_name || plugin.repo_url || plugin.id || plugin.slug;
  return slugify(`${repoNameFromFullName(fullName)}-${canonicalRepoKey(fullName).replace('/', '-')}`);
}

export function ensureUniquePluginSlugs(plugins, previousPlugins = []) {
  const previousByRepo = new Map((previousPlugins || []).map((plugin) => [canonicalRepoKey(plugin.full_name || plugin.repo_url), plugin.slug || plugin.id]).filter(([key, slug]) => key && slug));
  const counts = new Map();
  for (const plugin of plugins || []) {
    const base = slugify(repoNameFromFullName(plugin.full_name) || plugin.slug || plugin.id);
    counts.set(base, (counts.get(base) || 0) + 1);
  }
  const used = new Map();
  return (plugins || []).map((plugin) => {
    const repoKey = canonicalRepoKey(plugin.full_name || plugin.repo_url);
    const base = slugify(repoNameFromFullName(plugin.full_name) || plugin.slug || plugin.id);
    let slug = previousByRepo.get(repoKey) || (counts.get(base) === 1 ? base : fallbackSlug(plugin));
    if (used.has(slug) && used.get(slug) !== repoKey) slug = `${fallbackSlug(plugin)}-${String(plugin.repo_id || '').slice(-6) || 'repo'}`;
    used.set(slug, repoKey);
    return { ...plugin, slug, id: slug };
  });
}

function authoritativeManifestFields(plugin) {
  const authoritative = isAuthoritativeDshManifest(plugin.manifest_file);
  return {
    authoritative,
    manifest_file: authoritative ? 'dsh-package.json' : null,
    package_id: authoritative ? (plugin.package_id || null) : null,
    package_type: authoritative ? (plugin.package_type || null) : null,
    package_version: authoritative ? (plugin.package_version || null) : null,
    capabilities: authoritative ? (Array.isArray(plugin.capabilities) ? plugin.capabilities : []) : [],
    dependencies: authoritative ? (Array.isArray(plugin.dependencies) ? plugin.dependencies : []) : [],
    permissions: authoritative ? (Array.isArray(plugin.permissions) ? plugin.permissions : []) : [],
    compatibility: authoritative ? (plugin.compatibility || null) : null,
    publisher: authoritative ? (plugin.publisher || null) : null,
    security: authoritative ? (plugin.security || null) : null,
    conflicts: authoritative ? (Array.isArray(plugin.conflicts) ? plugin.conflicts : []) : [],
    replaces: authoritative ? (Array.isArray(plugin.replaces) ? plugin.replaces : []) : [],
    provides: authoritative ? (Array.isArray(plugin.provides) ? plugin.provides : []) : [],
    type_config: authoritative ? (plugin.type_config || null) : null,
    release_tag: authoritative ? (plugin.release_tag || null) : null,
  };
}

export function normalizeStoredPlugin(raw) {
  const plugin = { ...(raw || {}) };
  const fullName = String(plugin.full_name || '').trim();
  if (fullName) {
    plugin.full_name = fullName;
    plugin.repo_name = repoNameFromFullName(fullName) || plugin.repo_name || '';
    plugin.repo_url = canonicalRepoUrl(fullName);
  }
  plugin.repo_id = discoveryRepoId(plugin) || null;
  plugin.category = normalizePluginCategory(plugin.category);
  plugin.tags = Array.isArray(plugin.tags) ? plugin.tags : [];
  plugin.topics = Array.isArray(plugin.topics) ? plugin.topics : [];
  const manifest = authoritativeManifestFields(plugin);
  Object.assign(plugin, manifest);
  delete plugin.authoritative;
  plugin.verified = manifest.authoritative;
  plugin.metadata_source = Array.isArray(plugin.override_fields) && plugin.override_fields.length
    ? 'override'
    : manifest.authoritative ? 'dsh-package' : 'github';
  plugin.install_cmd = makeCatalogInstallCmd(plugin);
  return plugin;
}

export function applyPluginOverride(plugin, override) {
  if (!override) return normalizeStoredPlugin(plugin);
  const allowed = new Set(OVERRIDABLE_PLUGIN_FIELDS);
  const applied = [];
  const result = { ...(plugin || {}) };
  for (const [key, value] of Object.entries(override)) {
    if (!allowed.has(key)) continue;
    if (key === 'homepage') result[key] = normalizeHttpUrl(value);
    else if (key === 'category') result[key] = normalizePluginCategory(value);
    else if (key === 'tags') result[key] = Array.isArray(value) ? value : [];
    else result[key] = String(value ?? '');
    applied.push(key);
  }
  if (applied.length) result.override_fields = normalizeOverrideFields(applied);
  return normalizeStoredPlugin(result);
}

function pluginIdentityKey(plugin) {
  const id = discoveryRepoId(plugin);
  return id ? `id:${id}` : `repo:${canonicalRepoKey(plugin.full_name || plugin.repo_url)}`;
}

function mergeDiscoveredRepository(current, live) {
  const base = current || {};
  const overrideFields = normalizeOverrideFields(base.override_fields);
  const overrideSet = new Set(overrideFields);
  const hasOverrides = overrideFields.length > 0;
  const manifestAuthoritative = isAuthoritativeDshManifest(live.manifest_file);
  const manifestSource = manifestAuthoritative ? live : {};
  const category = normalizePluginCategory(overrideSet.has('category') ? base.category : live.category);
  const name = overrideSet.has('name') ? base.name : (manifestSource.name || live.name || live.repo_name);
  const description = overrideSet.has('description') ? base.description : (manifestSource.description || live.description || '');
  const tags = overrideSet.has('tags')
    ? (Array.isArray(base.tags) ? base.tags : [])
    : manifestAuthoritative ? (Array.isArray(manifestSource.tags) ? manifestSource.tags : live.tags) : (Array.isArray(live.tags) ? live.tags : []);
  const homepage = normalizeHttpUrl(overrideSet.has('homepage') ? base.homepage : live.homepage);

  const merged = {
    ...base,
    repo_id: live.repo_id || base.repo_id || null,
    full_name: live.full_name,
    repo_name: live.repo_name,
    repo_url: canonicalRepoUrl(live.full_name),
    topics: live.topics || [],
    stars: Number(live.stars || 0),
    forks: Number(live.forks || 0),
    watchers: Number(live.watchers || 0),
    open_issues: Number(live.open_issues || 0),
    created_at: live.created_at || base.created_at || '',
    updated_at: live.updated_at || base.updated_at || '',
    language: live.language || '',
    license: live.license || '',
    homepage,
    snapshot_commit: live.snapshot_commit || base.snapshot_commit,
    snapshot_ref: live.snapshot_ref || base.snapshot_ref,
    deprecated: Boolean(live.deprecated),
    disabled: Boolean(live.disabled),
    metadata_source: hasOverrides ? 'override' : (manifestAuthoritative ? 'dsh-package' : 'github'),
    manifest_file: manifestAuthoritative ? 'dsh-package.json' : null,
    package_id: manifestAuthoritative ? (manifestSource.package_id || null) : null,
    package_type: manifestAuthoritative ? (manifestSource.package_type || null) : null,
    package_version: manifestAuthoritative ? (manifestSource.package_version || null) : null,
    capabilities: manifestAuthoritative ? (manifestSource.capabilities || []) : [],
    dependencies: manifestAuthoritative ? (manifestSource.dependencies || []) : [],
    permissions: manifestAuthoritative ? (manifestSource.permissions || []) : [],
    compatibility: manifestAuthoritative ? (manifestSource.compatibility || null) : null,
    publisher: manifestAuthoritative ? (manifestSource.publisher || null) : null,
    security: manifestAuthoritative ? (manifestSource.security || null) : null,
    conflicts: manifestAuthoritative ? (manifestSource.conflicts || []) : [],
    replaces: manifestAuthoritative ? (manifestSource.replaces || []) : [],
    provides: manifestAuthoritative ? (manifestSource.provides || []) : [],
    type_config: manifestAuthoritative ? (manifestSource.type_config || null) : null,
    release_tag: manifestAuthoritative ? (manifestSource.release_tag || null) : null,
    verified: manifestAuthoritative,
    category,
    tags,
    name,
    description,
  };
  merged.install_cmd = makeCatalogInstallCmd(merged);
  if (hasOverrides) merged.override_fields = overrideFields;
  else delete merged.override_fields;
  delete merged._manifest_observed;
  return merged;
}

export function mergeCatalogPluginsWithDiscovery(existingPlugins, discoveredPlugins, options = {}) {
  const byKey = new Map();
  const existingById = new Map();
  const observationRequired = Boolean(options.requireObservation);
  const observedKeys = new Set((options.observedRepos || []).map(canonicalRepoKey).filter(Boolean));
  const observedIds = new Set((options.observedRepoIds || []).map((id) => String(id)).filter(Boolean));

  for (const raw of existingPlugins || []) {
    const plugin = normalizeStoredPlugin(raw);
    const key = canonicalRepoKey(plugin.full_name);
    if (!key) continue;
    byKey.set(key, plugin);
    if (plugin.repo_id) existingById.set(String(plugin.repo_id), plugin);
  }

  const discoveredKeys = new Set();
  let renamed = 0;
  for (const raw of discoveredPlugins || []) {
    const live = normalizeStoredPlugin(raw);
    const liveKey = canonicalRepoKey(live.full_name);
    if (!liveKey) continue;
    discoveredKeys.add(liveKey);
    const id = live.repo_id ? String(live.repo_id) : '';
    const idCurrent = id ? existingById.get(id) : null;
    const pathCurrent = byKey.get(liveKey) || null;
    const pathIdentityCompatible = !id || !pathCurrent?.repo_id || String(pathCurrent.repo_id) === id;
    const current = idCurrent || (pathIdentityCompatible ? pathCurrent : null);
    const matchedKey = current ? canonicalRepoKey(current.full_name) : '';
    if (matchedKey && matchedKey !== liveKey) {
      const occupant = byKey.get(matchedKey);
      if (occupant && pluginIdentityKey(occupant) === pluginIdentityKey(current)) byKey.delete(matchedKey);
      renamed++;
    }
    const merged = mergeDiscoveredRepository(current, live);
    byKey.set(liveKey, merged);
  }

  const plugins = [];
  let pruned = 0;
  for (const [key, plugin] of byKey) {
    const discovered = discoveredKeys.has(key);
    const manifestAuthoritative = isAuthoritativeDshManifest(plugin.manifest_file);
    const repoId = plugin.repo_id ? String(plugin.repo_id) : '';
    const observedThisRun = !observationRequired || observedKeys.has(key) || (repoId && observedIds.has(repoId));
    if (!discovered && (!manifestAuthoritative || !observedThisRun)) {
      pruned++;
      continue;
    }
    plugins.push(plugin);
  }
  return { plugins: ensureUniquePluginSlugs(plugins, existingPlugins), renamed, pruned };
}
