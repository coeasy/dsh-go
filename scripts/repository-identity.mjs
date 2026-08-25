const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

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

export function installProfile(category) {
  if (category === 'web-ui') return 'web';
  if (category === 'desktop') return 'desktop';
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
  const category = plugin?.category || 'other';
  return {
    ...plugin,
    full_name: fullName,
    repo_name: repoName,
    repo_url: canonicalRepoUrl(fullName),
    install_cmd: makeInstallCmd(fullName, category),
    homepage: normalizeHttpUrl(plugin?.homepage),
    metadata_source: authoritativeManifest ? 'dsh-plugin' : 'github',
    manifest_file: authoritativeManifest ? 'dsh-plugin.json' : null,
    verified: authoritativeManifest,
    name: authoritativeManifest ? (plugin?.name || repoName) : repoName,
  };
}

export function mergeDiscoveredRepository(current, discovered) {
  if (!current) return normalizeStoredPlugin(discovered);
  const base = normalizeStoredPlugin(current);
  const live = normalizeStoredPlugin(discovered);
  const manifestAuthoritative = base.manifest_file === 'dsh-plugin.json';
  const category = manifestAuthoritative ? base.category : live.category;
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
    homepage: normalizeHttpUrl(live.homepage || base.homepage),
    snapshot_commit: live.snapshot_commit || base.snapshot_commit,
    snapshot_ref: live.snapshot_ref || base.snapshot_ref,
  };

  if (manifestAuthoritative) {
    merged.metadata_source = 'dsh-plugin';
    merged.manifest_file = 'dsh-plugin.json';
    merged.verified = true;
    merged.category = base.category;
    merged.tags = Array.isArray(base.tags) ? base.tags : live.tags;
    merged.name = base.name || live.repo_name;
    merged.description = base.description || live.description || '';
  } else {
    merged.metadata_source = 'github';
    merged.manifest_file = null;
    merged.verified = false;
    merged.category = live.category;
    merged.tags = Array.isArray(live.tags) ? live.tags : [];
    merged.name = live.repo_name;
    merged.description = live.description || '';
  }
  return merged;
}
