import { buildRegistryV4 } from '../packages/registry-core/index.mjs';
import { normalizeStoredPlugin, isAuthoritativeDshManifest } from './repository-identity.mjs';

const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PACKAGE_VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function typeFor(plugin) {
  if (['plugin', 'mcp', 'skill', 'agent'].includes(plugin.package_type)) return plugin.package_type;
  if (plugin.category === 'mcp') return 'mcp';
  if (plugin.category === 'skills') return 'skill';
  if (plugin.category === 'agent') return 'agent';
  return 'plugin';
}

function versionFor(plugin) {
  const version = String(plugin.package_version || '').trim();
  return plugin.verified && isAuthoritativeDshManifest(plugin.manifest_file) && PACKAGE_VERSION_RE.test(version) ? version : '0.1.0';
}

function capabilitiesFor(plugin, type) {
  return [...new Set([type, ...(Array.isArray(plugin.capabilities) ? plugin.capabilities : [])].map((value) => String(value).toLowerCase()).filter(Boolean))].sort();
}

async function sleep(ms) { return new Promise((accept) => setTimeout(accept, ms)); }

async function resolveCommit(repo, ref, token, retries = 4) {
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref || 'HEAD')}`;
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'dsh-go-registry-v4', 'X-GitHub-Api-Version': '2022-11-28' };
    if (token) headers.Authorization = `Bearer ${token}`;
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
      if ([404, 409, 422].includes(response.status)) return null;
      if (response.ok) {
        const data = await response.json();
        const commit = String(data.sha || '').toLowerCase();
        return COMMIT_RE.test(commit) ? commit : null;
      }
      if (![403, 429, 500, 502, 503, 504].includes(response.status) || attempt === retries - 1) throw new Error(`GitHub API ${response.status} for ${repo}`);
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(Math.max(retryAfter * 1000, 1200 * (attempt + 1)));
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

function recordFor(plugin, commit) {
  const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
  if (!REPO_RE.test(repo)) throw new Error(`invalid repository: ${repo || '<empty>'}`);
  const type = typeFor(plugin);
  const id = String(plugin.package_id || plugin.id || plugin.slug || repo).trim();
  const version = versionFor(plugin);
  return {
    type,
    id,
    version,
    channel: String(plugin.channel || plugin.release_channel || 'stable'),
    source: {
      provider: 'github',
      repo,
      ref: String(plugin.snapshot_ref || plugin.source?.ref || 'HEAD'),
      commit,
    },
    artifact: {
      kind: 'git-source',
      url: `https://github.com/${repo}/archive/${commit}.tar.gz`,
      release_tag: plugin.release_tag || null,
    },
    runtime: {
      type,
      activation: 'restart-required',
      ...(plugin.runtime || {}),
    },
    entrypoints: plugin.entrypoints || plugin.runtime?.entrypoints || {},
    capabilities: capabilitiesFor(plugin, type),
    dependencies: Array.isArray(plugin.dependencies) ? plugin.dependencies : [],
    permissions: Array.isArray(plugin.permissions) ? plugin.permissions : [],
    compatibility: plugin.compatibility || {},
    publisher: plugin.publisher || { id: repo.split('/')[0], repository_ownership: plugin.verified ? 'declared' : 'unverified' },
    security: plugin.security || {},
    metadata: {
      name: plugin.name || id,
      description: plugin.description || '',
      category: plugin.category || 'other',
      verified: plugin.verified === true,
      stars: Number(plugin.stars || 0),
      rank: Number(plugin.rank || 0),
      updated_at: plugin.updated_at || '',
      repo_url: plugin.repo_url || `https://github.com/${repo}`,
      manifest_file: plugin.manifest_file || null,
      language: plugin.language || null,
      license: plugin.license || null,
    },
  };
}

export async function buildRegistryV4FromDiscovery(discovery, options = {}) {
  const token = options.token || '';
  const input = Array.isArray(discovery?.plugins) ? discovery.plugins : [];
  const records = [];
  const excluded = [];
  const seen = new Set();
  const concurrency = Math.max(1, Math.min(64, Number(options.concurrency || process.env.REGISTRY_COMMIT_CONCURRENCY || 24)));
  let cursor = 0;

  async function worker() {
    while (cursor < input.length) {
      const index = cursor++;
      const plugin = normalizeStoredPlugin(input[index]);
      const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
      if (!REPO_RE.test(repo) || plugin.disabled || plugin.deprecated) {
        excluded.push({ repo, reason: !REPO_RE.test(repo) ? 'invalid repository' : 'disabled-or-deprecated' });
        continue;
      }
      const type = typeFor(plugin);
      const id = String(plugin.package_id || plugin.id || plugin.slug || repo).trim().toLowerCase();
      const key = `${type}:${id}`;
      if (seen.has(key)) { excluded.push({ repo, reason: `duplicate package key: ${key}` }); continue; }
      seen.add(key);
      const declared = String(plugin.snapshot_commit || plugin.source?.commit || '').trim().toLowerCase();
      const commit = COMMIT_RE.test(declared)
        ? declared
        : await resolveCommit(repo, String(plugin.snapshot_ref || plugin.source?.ref || 'HEAD'), token).catch((error) => {
          excluded.push({ repo, reason: `commit-resolution-failed:${error.message}` });
          return null;
        });
      if (!commit) { if (!excluded.some((item) => item.repo === repo)) excluded.push({ repo, reason: 'no-immutable-commit' }); continue; }
      records.push(recordFor(plugin, commit));
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, input.length)) }, () => worker()));
  const registry = buildRegistryV4(records, {
    generated_at: options.generated_at || new Date().toISOString(),
    source: 'dsh-go-sync-v4',
  });
  registry.metadata.discovery_count = input.length;
  registry.metadata.excluded_count = excluded.length;
  return { registry, stats: { input: input.length, output: records.length, excluded } };
}
