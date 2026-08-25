from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected exactly one match, got {count}')
    p.write_text(text.replace(old, new, 1))


# Make manifest absence an explicit observation instead of conflating it with network failure.
sync = Path('scripts/sync.mjs')
text = sync.read_text()
start = text.index('async function fetchManifest(fullName, branch) {')
end = text.index('\nasync function fetchReadme(fullName, branch) {', start)
replacement = '''export async function observeDshManifest(fullName, branch) {
  const file = MANIFEST_FILES[0];
  const url = `https://raw.githubusercontent.com/${fullName}/${branch}/${file}`;
  let lastError = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'dsh-go' }, signal: AbortSignal.timeout(15000) });
      if (res.status === 404) return { observed: true, manifest: null, status: 404 };
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        if ([403, 429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
          await sleep(500 * (attempt + 1));
          continue;
        }
        return { observed: false, manifest: null, status: res.status, error: lastError };
      }
      let data;
      try { data = await res.json(); }
      catch { return { observed: true, manifest: null, status: res.status, error: 'invalid-json' }; }
      const clean = sanitizeManifest(data);
      return { observed: true, manifest: clean ? { file, data: clean } : null, status: res.status, error: clean ? '' : 'invalid-manifest' };
    } catch (error) {
      lastError = error?.message || String(error);
      if (attempt < 2) { await sleep(500 * (attempt + 1)); continue; }
    }
  }
  return { observed: false, manifest: null, status: 0, error: lastError || 'manifest-observation-failed' };
}

async function fetchManifest(fullName, branch) {
  const observation = await observeDshManifest(fullName, branch);
  if (!observation.observed) throw new Error(`DSH manifest observation failed for ${fullName}: ${observation.error || observation.status}`);
  return observation.manifest;
}

export function applyManifestObservation(plugin, observation) {
  const base = normalizeStoredPlugin(plugin);
  if (!observation?.observed) return base;
  const manifest = observation.manifest;
  const result = manifest ? {
    ...base,
    name: manifest.data?.name || base.repo_name,
    description: manifest.data?.description || base.description || '',
    category: normalizeCategory(manifest.data?.category, base.category || 'other'),
    tags: dedupeTags([...(manifest.data?.tags || []), ...(base.topics || [])]),
    metadata_source: 'dsh-plugin',
    manifest_file: 'dsh-plugin.json',
    verified: true,
  } : {
    ...base,
    name: base.repo_name,
    metadata_source: 'github',
    manifest_file: null,
    verified: false,
  };
  result.install_cmd = makeInstallCmd(result.full_name, result.category);
  result._manifest_observed = true;
  return normalizeStoredPlugin(result);
}
'''
sync.write_text(text[:start] + replacement + text[end:])


# A live, explicit manifest observation supersedes stale historical manifest state.
identity = Path('scripts/repository-identity.mjs')
text = identity.read_text()
start = text.index('export function mergeDiscoveredRepository(current, discovered) {')
end = text.index('\nexport function mergeCatalogPluginsWithDiscovery', start)
replacement = '''export function mergeDiscoveredRepository(current, discovered) {
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
'''
identity.write_text(text[:start] + replacement + text[end:])


replace_once(
    'scripts/sync-v3.mjs',
    "import { buildFeed } from './sync.mjs';\nimport { mergeCatalogPluginsWithDiscovery } from './repository-identity.mjs';",
    "import { applyManifestObservation, buildFeed, observeDshManifest } from './sync.mjs';\nimport { canonicalRepoKey, mergeCatalogPluginsWithDiscovery } from './repository-identity.mjs';",
)
old = """      const discoveredPlugins = discovery.repositories.map(discoveryRepoToLegacy).filter((plugin) => plugin.full_name && !plugin.disabled);
      const requireObservation = !registryOnly && mode === 'full';
      if (requireObservation && observations.mode !== 'full') {
        throw new Error('full sync observation sidecar missing or invalid; refusing stale-repository pruning');
      }
      const merged = mergeCatalogPluginsWithDiscovery(legacy.plugins || [], discoveredPlugins, {
"""
new = """      const discoveredPlugins = discovery.repositories.map(discoveryRepoToLegacy).filter((plugin) => plugin.full_name && !plugin.disabled);
      const requireObservation = !registryOnly && mode === 'full';
      if (requireObservation && observations.mode !== 'full') {
        throw new Error('full sync observation sidecar missing or invalid; refusing stale-repository pruning');
      }

      // Legacy REST star buckets cannot enumerate every low-star repository. For records that
      // were not actually processed by the legacy full pass, observe dsh-plugin.json directly
      // so complete discovery does not create false-negative verification/name/category data.
      const observedKeys = new Set((observations.repos || []).map(canonicalRepoKey).filter(Boolean));
      const observedIds = new Set((observations.repo_ids || []).map((id) => String(id)).filter(Boolean));
      const legacyKeys = new Set((legacy.plugins || []).map((plugin) => canonicalRepoKey(plugin.full_name)).filter(Boolean));
      const legacyIds = new Set((legacy.plugins || []).map((plugin) => String(plugin.repo_id || '')).filter(Boolean));
      const targetIndexes = [];
      for (let index = 0; index < discoveredPlugins.length; index++) {
        const plugin = discoveredPlugins[index];
        const key = canonicalRepoKey(plugin.full_name);
        const id = String(plugin.repo_id || '');
        const alreadyObserved = requireObservation
          ? (observedKeys.has(key) || (id && observedIds.has(id)))
          : (legacyKeys.has(key) || (id && legacyIds.has(id)));
        if (!alreadyObserved) targetIndexes.push(index);
      }
      if (targetIndexes.length) {
        const manifestConcurrency = Math.max(1, Math.min(64, Number(process.env.REGISTRY_MANIFEST_CONCURRENCY || 32)));
        let manifestCursor = 0;
        let manifestObserved = 0;
        let manifestUncertain = 0;
        async function manifestWorker() {
          while (manifestCursor < targetIndexes.length) {
            const targetIndex = targetIndexes[manifestCursor++];
            const plugin = discoveredPlugins[targetIndex];
            const observation = await observeDshManifest(plugin.full_name, plugin.snapshot_ref || 'HEAD');
            if (observation.observed) {
              discoveredPlugins[targetIndex] = applyManifestObservation(plugin, observation);
              manifestObserved++;
            } else {
              manifestUncertain++;
              console.warn(`[sync-v3] manifest observation uncertain for ${plugin.full_name}: ${observation.error || observation.status}`);
            }
          }
        }
        await Promise.all(Array.from({ length: Math.min(manifestConcurrency, targetIndexes.length) }, manifestWorker));
        console.log(`[sync-v3] complete-discovery manifest backfill targets=${targetIndexes.length} observed=${manifestObserved} uncertain=${manifestUncertain}`);
      }

      const merged = mergeCatalogPluginsWithDiscovery(legacy.plugins || [], discoveredPlugins, {
"""
replace_once('scripts/sync-v3.mjs', old, new)


replace_once(
    'tests/repository-identity.test.ts',
    "const { discoveryRepoToLegacy } = await import('../scripts/github-discovery.mjs');",
    "const { discoveryRepoToLegacy } = await import('../scripts/github-discovery.mjs');\nconst { applyManifestObservation } = await import('../scripts/sync.mjs');",
)
replace_once(
    'tests/repository-identity.test.ts',
    "  it('audits wrong repo URLs and install sources', () => {",
    """  it('upgrades and downgrades manifest authority only after an explicit observation', () => {
    const github: any = { full_name: 'owner/demo', repo_id: '7', name: 'demo', repo_name: 'demo', category: 'tool', topics: ['dsh-plugin'] };
    const observedManifest: any = applyManifestObservation(github, {
      observed: true,
      manifest: { file: 'dsh-plugin.json', data: { name: 'Branded Demo', category: 'mcp', tags: ['custom'] } },
    });
    const upgraded = mergeCatalogPluginsWithDiscovery([github], [observedManifest]).plugins[0] as any;
    expect(upgraded.name).toBe('Branded Demo');
    expect(upgraded.category).toBe('mcp');
    expect(upgraded.verified).toBe(true);
    expect(upgraded.manifest_file).toBe('dsh-plugin.json');

    const observedAbsent: any = applyManifestObservation(observedManifest, { observed: true, manifest: null });
    const downgraded = mergeCatalogPluginsWithDiscovery([upgraded], [observedAbsent]).plugins[0] as any;
    expect(downgraded.name).toBe('demo');
    expect(downgraded.verified).toBe(false);
    expect(downgraded.manifest_file).toBeNull();
  });

  it('preserves historical manifest authority when live manifest observation is uncertain', () => {
    const current: any = {
      full_name: 'owner/demo', repo_id: '7', name: 'Branded Demo', category: 'mcp', metadata_source: 'dsh-plugin',
      manifest_file: 'dsh-plugin.json', verified: true, tags: ['custom'],
    };
    const live: any = { full_name: 'owner/demo', repo_id: '7', name: 'demo', repo_name: 'demo', category: 'tool', topics: ['dsh-plugin'] };
    const uncertain: any = applyManifestObservation(live, { observed: false, manifest: null });
    const merged = mergeCatalogPluginsWithDiscovery([current], [uncertain]).plugins[0] as any;
    expect(merged.name).toBe('Branded Demo');
    expect(merged.verified).toBe(true);
    expect(merged.manifest_file).toBe('dsh-plugin.json');
  });

  it('audits wrong repo URLs and install sources', () => {""",
)
