import { artifactIntegrity, registryContentHash } from './checksum.mjs';

export const REGISTRY_VERSION = 3;
export const SCHEMA_VERSION = '3.0.0';
export const DEFAULT_PLUGIN_VERSION = '0.1.0';
const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function isCommitSha(value) {
  return COMMIT_RE.test(String(value || ''));
}

export function inferRuntimeType(plugin) {
  switch (plugin.category) {
    case 'mcp': return 'mcp';
    case 'skills': return 'skill';
    case 'agent': return 'agent';
    default: return 'plugin';
  }
}

export function inferCapabilities(plugin) {
  const caps = new Set(['plugin']);
  const runtime = inferRuntimeType(plugin);
  if (runtime !== 'plugin') caps.add(runtime);
  for (const cap of plugin.capabilities || []) {
    if (typeof cap === 'string' && cap.trim()) caps.add(cap.trim().toLowerCase());
  }
  return [...caps].sort();
}

export function normalizeLegacyPlugin(plugin) {
  const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
  if (!REPO_RE.test(repo)) return { error: 'invalid repository name' };

  const id = String(plugin.id || plugin.slug || repo.replace('/', '-')).trim();
  if (!id) return { error: 'missing plugin id' };

  const snapshot = String(plugin.snapshot_commit || '').trim();
  const ref = String(
    plugin.snapshot_ref ||
    plugin.source?.ref ||
    (!isCommitSha(snapshot) ? snapshot : '') ||
    'HEAD'
  ).trim();

  return { id, repo, ref };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function githubJson(url, token, retries = 4) {
  for (let attempt = 0; attempt < retries; attempt++) {
    const headers = {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'dsh-go-registry-v3',
      'X-GitHub-Api-Version': '2022-11-28',
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    let response;
    try {
      response = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (response.status === 404) return null;
    if (response.ok) return response.json();
    if ([403, 429, 500, 502, 503, 504].includes(response.status) && attempt < retries - 1) {
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      const reset = Number(response.headers.get('x-ratelimit-reset') || 0) * 1000;
      const rateDelay = reset > Date.now() ? Math.min(reset - Date.now() + 1000, 60000) : 0;
      await sleep(Math.max(retryAfter * 1000, rateDelay, 1500 * (attempt + 1)));
      continue;
    }
    throw new Error(`GitHub API ${response.status} for ${url}`);
  }
  throw new Error(`GitHub API retries exhausted for ${url}`);
}

async function resolveRepositoryCommitRest(repo, ref, token) {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref || 'HEAD')}`;
  const data = await githubJson(url, token);
  if (!data) return null;
  const commit = String(data.sha || '');
  if (!isCommitSha(commit)) throw new Error(`invalid commit returned for ${repo}@${ref}`);
  return { commit: commit.toLowerCase(), ref };
}

async function graphqlBatch(entries, token) {
  const variables = {};
  const declarations = [];
  const fields = [];
  entries.forEach((entry, index) => {
    const [owner, name] = entry.repo.split('/');
    variables[`o${index}`] = owner;
    variables[`n${index}`] = name;
    variables[`q${index}`] = `refs/heads/${entry.ref === 'HEAD' ? '' : entry.ref}`;
    declarations.push(`$o${index}:String!`, `$n${index}:String!`, `$q${index}:String!`);
    fields.push(`r${index}:repository(owner:$o${index},name:$n${index}){ref(qualifiedName:$q${index}){target{... on Commit{oid}}} defaultBranchRef{name target{... on Commit{oid}}}}`);
  });
  const query = `query(${declarations.join(',')}){${fields.join(' ')} rateLimit{remaining resetAt cost}}`;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'User-Agent': 'dsh-go-registry-v3',
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`GitHub GraphQL ${response.status}`);
  const payload = await response.json();
  if (!payload.data) throw new Error(`GitHub GraphQL failed: ${JSON.stringify(payload.errors || [])}`);
  return entries.map((entry, index) => {
    const node = payload.data[`r${index}`];
    const refNode = entry.ref !== 'HEAD' ? node?.ref : null;
    const commit = refNode?.target?.oid || node?.defaultBranchRef?.target?.oid || '';
    const ref = refNode?.target?.oid ? entry.ref : (node?.defaultBranchRef?.name || entry.ref);
    return isCommitSha(commit) ? { commit: commit.toLowerCase(), ref } : null;
  });
}

async function resolveCommits(entries, token) {
  const resolved = new Map();
  if (token) {
    const chunkSize = 40;
    for (let offset = 0; offset < entries.length; offset += chunkSize) {
      const chunk = entries.slice(offset, offset + chunkSize);
      try {
        const values = await graphqlBatch(chunk, token);
        values.forEach((value, index) => resolved.set(chunk[index].repo, value));
        continue;
      } catch (error) {
        console.warn(`[registry-v3] GraphQL batch failed, falling back to REST for ${chunk.length} repos: ${error.message}`);
      }
      for (const entry of chunk) {
        resolved.set(entry.repo, await resolveRepositoryCommitRest(entry.repo, entry.ref, token));
      }
    }
    return resolved;
  }

  for (const entry of entries) {
    resolved.set(entry.repo, await resolveRepositoryCommitRest(entry.repo, entry.ref, token));
  }
  return resolved;
}

export function buildRegistryPlugin(legacy, normalized, commit) {
  const version = DEFAULT_PLUGIN_VERSION;
  const runtimeType = inferRuntimeType(legacy);
  const record = {
    id: normalized.id,
    version,
    source: {
      provider: 'github',
      repo: normalized.repo,
      ref: normalized.ref,
      commit: commit.toLowerCase(),
      updated_at: legacy.updated_at || '',
      archive_url: `https://github.com/${normalized.repo}/archive/${commit.toLowerCase()}.tar.gz`,
    },
    artifact: {
      kind: 'git-source',
      algorithm: 'sha256',
      integrity_scope: 'source-identity',
      integrity: '',
    },
    runtime: {
      type: runtimeType,
      activation: 'restart-required',
    },
    capabilities: inferCapabilities(legacy),
    dependencies: Array.isArray(legacy.dependencies) ? legacy.dependencies : [],
    metadata: {
      name: legacy.name || normalized.id,
      description: legacy.description || '',
      category: legacy.category || 'other',
      verified: Boolean(legacy.verified),
      stars: Number(legacy.stars || 0),
      rank: Number(legacy.rank || 0),
      repo_url: legacy.repo_url || `https://github.com/${normalized.repo}`,
      install_cmd: legacy.install_cmd || '',
      manifest_file: legacy.manifest_file || null,
    },
  };
  record.artifact.integrity = artifactIntegrity(record);
  return record;
}

export async function buildRegistryV3(legacyCatalog, existingRegistry = null, options = {}) {
  const token = options.token || '';
  const preserveExisting = Boolean(options.preserveExisting);
  const existingByRepo = new Map(
    (existingRegistry?.plugins || [])
      .filter((p) => p?.source?.repo)
      .map((p) => [p.source.repo, p])
  );

  const inputs = [];
  const excluded = [];
  const seenIds = new Set();
  const seenRepos = new Set();

  for (const legacy of legacyCatalog?.plugins || []) {
    const normalized = normalizeLegacyPlugin(legacy);
    if (normalized.error) {
      excluded.push({ repo: legacy?.full_name || '', reason: normalized.error });
      continue;
    }
    if (seenIds.has(normalized.id)) {
      excluded.push({ repo: normalized.repo, reason: `duplicate id: ${normalized.id}` });
      continue;
    }
    if (seenRepos.has(normalized.repo)) {
      excluded.push({ repo: normalized.repo, reason: 'duplicate repository' });
      continue;
    }
    seenIds.add(normalized.id);
    seenRepos.add(normalized.repo);
    inputs.push({ legacy, normalized });
  }

  const plugins = [];
  const toResolve = [];
  let reused = 0;
  let reusedExistingOnly = 0;

  for (const input of inputs) {
    const { legacy, normalized } = input;
    const previous = existingByRepo.get(normalized.repo);
    if (
      previous &&
      previous.version === DEFAULT_PLUGIN_VERSION &&
      isCommitSha(previous.source?.commit) &&
      previous.artifact?.integrity === artifactIntegrity(previous) &&
      previous.source?.ref === normalized.ref &&
      previous.source?.updated_at === (legacy.updated_at || '')
    ) {
      plugins.push(previous);
      reused++;
    } else {
      toResolve.push(input);
    }
  }

  const commitMap = await resolveCommits(toResolve.map(({ normalized }) => normalized), token);
  for (const { legacy, normalized } of toResolve) {
    const resolved = commitMap.get(normalized.repo);
    if (!resolved) {
      excluded.push({ repo: normalized.repo, reason: 'repository/ref not found' });
      continue;
    }
    normalized.ref = resolved.ref || normalized.ref;
    plugins.push(buildRegistryPlugin(legacy, normalized, resolved.commit));
  }

  if (preserveExisting && existingRegistry) {
    for (const previous of existingRegistry.plugins || []) {
      const repo = previous?.source?.repo;
      if (!repo || seenRepos.has(repo)) continue;
      if (!isCommitSha(previous.source?.commit) || previous.artifact?.integrity !== artifactIntegrity(previous)) continue;
      plugins.push(previous);
      seenRepos.add(repo);
      seenIds.add(previous.id);
      reusedExistingOnly++;
    }
  }

  plugins.sort((a, b) => a.id.localeCompare(b.id));
  const registry = {
    registry_version: REGISTRY_VERSION,
    schema_version: SCHEMA_VERSION,
    defaults: { plugin_version: DEFAULT_PLUGIN_VERSION },
    generated: {
      at: new Date().toISOString(),
      source_catalog_etag: legacyCatalog?.meta?.etag || '',
      source_catalog_count: Number(legacyCatalog?.meta?.count ?? legacyCatalog?.plugins?.length ?? 0),
      count: plugins.length,
      excluded_count: excluded.length,
      discovery_mode: options.discoveryMode || 'catalog',
      discovered_count: Number(options.discoveredCount || 0),
      content_hash: '',
    },
    plugins,
  };
  registry.generated.content_hash = registryContentHash(registry);

  return {
    registry,
    stats: {
      input: inputs.length,
      output: plugins.length,
      reused,
      resolved: toResolve.length - excluded.filter((x) => x.reason === 'repository/ref not found').length,
      reused_existing_only: reusedExistingOnly,
      excluded,
    },
  };
}
