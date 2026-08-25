const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
export const VALID_PLUGIN_CATEGORIES = Object.freeze([
  'web-ui', 'desktop', 'mcp', 'skills', 'theme', 'terminal', 'coding', 'agent',
  'vision', 'memory', 'security', 'integration', 'tool', 'other',
]);
export const OVERRIDABLE_PLUGIN_FIELDS = Object.freeze(['name', 'description', 'category', 'tags', 'homepage']);
const CATEGORY_SET = new Set(VALID_PLUGIN_CATEGORIES);
const OVERRIDE_FIELD_SET = new Set(OVERRIDABLE_PLUGIN_FIELDS);

export function canonicalRepoKey(value) {
  return String(value || '').trim().toLowerCase();
}

export function isValidRepositoryName(value) {
  return REPO_RE.test(String(value || '').trim());
}

export function repoNameFromFullName(value) {
  const repo = String(value || '').trim();
  if (!isValidRepositoryName(repo)) return '';
  return repo.split('/')[1];
}

export function canonicalRepoUrl(value) {
  const repo = String(value || '').trim();
  return isValidRepositoryName(repo) ? `https://github.com/${repo}` : '';
}

export function normalizePluginCategory(value, fallback = 'other') {
  const category = String(value || '').trim();
  return CATEGORY_SET.has(category) ? category : fallback;
}

export function installProfile(category) {
  const normalized = normalizePluginCategory(category);
  if (normalized === 'web-ui') return 'web';
  if (normalized === 'desktop') return 'desktop';
  return 'tools';
}

export function makeInstallCmd(fullName, category) {
  return `dsh plugin --profile ${installProfile(category)} add github:${fullName}`;
}

export function normalizeHttpUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeOverrideFields(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((field) => String(field || '').trim()).filter((field) => OVERRIDE_FIELD_SET.has(field)))].sort();
}

export function discoveryTopics(repo) {
  if (Array.isArray(repo?.topics)) return repo.topics.filter(Boolean).map(String);
  const nodes = repo?.repositoryTopics?.nodes || [];
  return nodes.map((node) => node?.topic?.name).filter(Boolean).map(String);
}

export function discoveryRepoId(repo) {
  const id = repo?.databaseId ?? repo?.id ?? null;
  if (id === null || id === undefined || id === '') return null;
  return String(id);
}

export function normalizeStoredPlugin(plugin) {
  const fullName = String(plugin?.full_name || plugin?.source?.repo || '').trim();
  if (!isValidRepositoryName(fullName)) return { ...plugin };
  const repoName = repoNameFromFullName(fullName);
  const authoritativeManifest = plugin?.manifest_file === 'dsh-plugin.json';
  // Legacy records used metadata_source=override as a record-wide flag. Do not trust that
  // legacy flag by itself: only explicit override_fields may freeze individual fields.
  const overrideFields = normalizeOverrideFields(plugin?.override_fields);
  const overrideSet = new Set(overrideFields);
  const category = normalizePluginCategory(plugin?.category, 'other');
  const metadataSource = overrideFields.length ? 'override' : (authoritativeManifest ? 'dsh-plugin' : 'github');
  const normalized = {
    ...plugin,
    full_name: fullName,
    repo_name: repoName,
    repo_url: canonicalRepoUrl(fullName),
    category,
    install_cmd: makeInstallCmd(fullName, category),
    homepage: normalizeHttpUrl(plugin?.homepage),
    metadata_source: metadataSource,
    manifest_file: authoritativeManifest ? 'dsh-plugin.json' : null,
    verified: authoritativeManifest,
    name: (overrideSet.has('name') || authoritativeManifest) ? (plugin?.name || repoName) : repoName,
  };
  if (overrideFields.length) normalized.override_fields = overrideFields;
  else delete normalized.override_fields;
  return normalized;
}

export function applyPluginOverride(plugin, override = {}) {
  const result = { ...plugin };
  const fields = new Set(normalizeOverrideFields(plugin?.override_fields));

  if (typeof override.name === 'string' && override.name.trim()) {
    result.name = override.name.trim().slice(0, 200);
    fields.add('name');
  }
  if (typeof override.description === 'string') {
    result.description = override.description.trim().slice(0, 4000);
    fields.add('description');
  }
  if (Object.prototype.hasOwnProperty.call(override, 'category')) {
    const category = normalizePluginCategory(override.category, '');
    if (category) {
      result.category = category;
      fields.add('category');
    }
  }
  if (Array.isArray(override.tags)) {
    result.tags = [...new Set(override.tags.filter((tag) => typeof tag === 'string').map((tag) => tag.trim().toLowerCase()).filter(Boolean))].slice(0, 100);
    fields.add('tags');
  }
  if (Object.prototype.hasOwnProperty.call(override, 'homepage')) {
    result.homepage = normalizeHttpUrl(override.homepage);
    fields.add('homepage');
  }

  result.override_fields = [...fields].sort();
  return normalizeStoredPlugin(result);
}

export function mergeDiscoveredRepository(current, discovered) {
  const liveManifestObserved = discovered?._manifest_observed === true;
  const live = normalizeStoredPlugin(discovered);
  delete live._manifest_observed;
  if (!current) return live;

  const base = normalizeStoredPlugin(current);
  const manifestSource = liveManifestObserved ? live : base;
  const manifestAuthoritative = manifestSource.manifest_file === 'dsh-plugin.json';
  const overrideFields = normalizeOverrideFields(base.override_fields);
  const overrideSet = new Set(overrideFields);
  const hasOverrides = overrideFields.length > 0;

  const name = overrideSet.has('name')
    ? (base.name || live.repo_name)
    : manifestAuthoritative ? (manifestSource.name || live.repo_name) : live.repo_name;
  const description = overrideSet.has('description')
    ? (base.description || '')
    : manifestAuthoritative ? (manifestSource.description || live.description || '') : (live.description || '');
  const category = normalizePluginCategory(
    overrideSet.has('category') ? base.category : (manifestAuthoritative ? manifestSource.category : live.category),
    'other',
  );
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
    install_cmd: makeInstallCmd(live.full_name, category),
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
    metadata_source: hasOverrides ? 'override' : (manifestAuthoritative ? 'dsh-plugin' : 'github'),
    manifest_file: manifestAuthoritative ? 'dsh-plugin.json' : null,
    verified: manifestAuthoritative,
    category,
    tags,
    name,
    description,
  };
  if (hasOverrides) merged.override_fields = overrideFields;
  else delete merged.override_fields;
  delete merged._manifest_observed;
  return merged;
}

export function mergeCatalogPluginsWithDiscovery(existingPlugins, discoveredPlugins, options = {}) {
  const byKey = new Map();
  const idToKey = new Map();
  const observationRequired = Boolean(options.requireObservation);
  const observedKeys = new Set((options.observedRepos || []).map(canonicalRepoKey).filter(Boolean));
  const observedIds = new Set((options.observedRepoIds || []).map((id) => String(id)).filter(Boolean));

  for (const raw of existingPlugins || []) {
    const plugin = normalizeStoredPlugin(raw);
    const key = canonicalRepoKey(plugin.full_name);
    if (!key) continue;
    byKey.set(key, plugin);
    if (plugin.repo_id) idToKey.set(String(plugin.repo_id), key);
  }

  const discoveredKeys = new Set();
  let renamed = 0;
  for (const raw of discoveredPlugins || []) {
    const live = normalizeStoredPlugin(raw);
    const liveKey = canonicalRepoKey(live.full_name);
    if (!liveKey) continue;
    discoveredKeys.add(liveKey);
    const id = live.repo_id ? String(live.repo_id) : '';
    const matchedKey = (id && idToKey.get(id)) || (byKey.has(liveKey) ? liveKey : '');
    const current = matchedKey ? byKey.get(matchedKey) : null;
    if (matchedKey && matchedKey !== liveKey) {
      byKey.delete(matchedKey);
      renamed++;
    }
    const merged = mergeDiscoveredRepository(current, live);
    byKey.set(liveKey, merged);
    if (id) idToKey.set(id, liveKey);
  }

  const plugins = [];
  let pruned = 0;
  for (const [key, plugin] of byKey) {
    const discovered = discoveredKeys.has(key);
    const manifestAuthoritative = plugin.manifest_file === 'dsh-plugin.json';
    const manualOverride = normalizeOverrideFields(plugin.override_fields).length > 0;
    const repoId = plugin.repo_id ? String(plugin.repo_id) : '';
    const observedThisRun = !observationRequired || observedKeys.has(key) || (repoId && observedIds.has(repoId));

    // Complete topic discovery is authoritative for ordinary GitHub-sourced records.
    // Supplementary-source records must have an explicit DSH manifest and must have
    // been observed during the current full legacy discovery. The observation set is
    // ephemeral, so liveness checks do not create deploy-worthy catalog churn.
    if (!discovered && !manualOverride && (!manifestAuthoritative || !observedThisRun)) {
      pruned++;
      continue;
    }
    plugins.push(plugin);
  }
  return { plugins, renamed, pruned };
}
