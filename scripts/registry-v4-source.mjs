import { buildRegistryV4 } from '../packages/registry-core/index.mjs';
import { normalizePackageId, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import { validatePackageManifest } from '../packages/protocol-core/manifest.mjs';
import { normalizeStoredPlugin, isAuthoritativeDshManifest } from './repository-identity.mjs';

const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

async function sleep(ms) { return new Promise((accept) => setTimeout(accept, ms)); }

function githubHeaders(token, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'User-Agent': 'dsh-go-registry-v4', 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubFetch(url, token, options = {}) {
  const retries = Math.max(1, Number(options.retries || 4));
  for (let attempt = 0; attempt < retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: githubHeaders(token, options.accept),
        signal: AbortSignal.timeout(Number(options.timeout || 20_000)),
      });
      if ([404, 409, 422].includes(response.status)) return null;
      if (response.ok) return response;
      if (![403, 429, 500, 502, 503, 504].includes(response.status) || attempt === retries - 1) throw new Error(`GitHub API ${response.status}: ${url}`);
      const retryAfter = Number(response.headers.get('retry-after') || 0);
      await sleep(Math.max(retryAfter * 1000, 1200 * (attempt + 1)));
    } catch (error) {
      if (attempt === retries - 1) throw error;
      await sleep(1200 * (attempt + 1));
    }
  }
  return null;
}

async function resolveCommit(repo, ref, token) {
  const response = await githubFetch(`https://api.github.com/repos/${repo}/commits/${encodeURIComponent(ref || 'HEAD')}`, token);
  if (!response) return null;
  const data = await response.json();
  const commit = String(data.sha || '').toLowerCase();
  return COMMIT_RE.test(commit) ? commit : null;
}

async function loadManifestV2(repo, commit, token) {
  const response = await githubFetch(
    `https://api.github.com/repos/${repo}/contents/dsh-package.json?ref=${encodeURIComponent(commit)}`,
    token,
    { accept: 'application/vnd.github.raw+json' },
  );
  if (!response) return null;
  let raw;
  try { raw = await response.json(); }
  catch (error) { throw new Error(`dsh-package.json is not valid JSON: ${error.message}`); }
  const manifest = validatePackageManifest(raw);
  if (manifest.source?.provider === 'github' && manifest.source?.repo
    && String(manifest.source.repo).toLowerCase() !== repo.toLowerCase()) {
    throw new Error(`Manifest V2 source.repo does not match discovered repository: ${manifest.source.repo} != ${repo}`);
  }
  return manifest;
}

function metadataFor(plugin, id, repo, manifest = null) {
  return {
    ...(manifest?.metadata || {}),
    name: manifest?.name || plugin.name || id,
    description: manifest?.description || plugin.description || '',
    category: manifest?.metadata?.category || plugin.category || 'other',
    verified: plugin.verified === true,
    stars: Number(plugin.stars || 0),
    rank: Number(plugin.rank || 0),
    updated_at: plugin.updated_at || '',
    repo_url: plugin.repo_url || `https://github.com/${repo}`,
    manifest_file: manifest ? 'dsh-package.json' : (plugin.manifest_file || null),
    language: plugin.language || null,
    license: plugin.license || null,
  };
}

function candidateFor(plugin, status, reason, extra = {}) {
  const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
  let type = null;
  let id = String(plugin.package_id || plugin.id || plugin.slug || repo).trim().toLowerCase();
  try {
    if (plugin.package_type) type = normalizePackageType(plugin.package_type);
    id = normalizePackageId(id);
  } catch { /* diagnostics remain best-effort and non-authoritative */ }
  return {
    candidate_version: 1,
    key: type ? packageKey(type, id) : null,
    type,
    id,
    repo,
    status,
    reason,
    installable: status === 'accepted',
    metadata: metadataFor(plugin, id, repo),
    publisher: plugin.publisher || null,
    discovered_at: plugin.updated_at || null,
    ...extra,
  };
}

function recordFor(plugin, repo, commit, manifest) {
  const type = normalizePackageType(manifest.type);
  const id = normalizePackageId(manifest.id);
  return {
    type,
    id,
    version: manifest.version,
    channel: manifest.channel,
    source: { provider: 'github', repo, ref: commit, commit },
    artifact: {
      kind: 'git-source',
      url: `https://github.com/${repo}/archive/${commit}.tar.gz`,
      release_tag: manifest.release?.tag || null,
      package_path: manifest.release?.package_path || null,
    },
    runtime: manifest.runtime,
    entrypoints: manifest.entrypoints,
    capabilities: manifest.capabilities,
    dependencies: manifest.dependencies,
    permissions: manifest.permissions,
    compatibility: manifest.compatibility,
    publisher: manifest.publisher,
    security: manifest.security,
    metadata: metadataFor(plugin, id, repo, manifest),
  };
}

export async function buildRegistryV4FromDiscovery(discovery, options = {}) {
  const token = options.token || '';
  const manifestLoader = options.loadManifest || loadManifestV2;
  const commitResolver = options.resolveCommit || resolveCommit;
  const input = Array.isArray(discovery?.plugins) ? discovery.plugins : [];
  const records = [];
  const candidates = [];
  const seen = new Set();
  const concurrency = Math.max(1, Math.min(64, Number(options.concurrency || process.env.REGISTRY_COMMIT_CONCURRENCY || 24)));
  let cursor = 0;

  async function worker() {
    while (cursor < input.length) {
      const index = cursor++;
      const plugin = normalizeStoredPlugin(input[index]);
      const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
      if (!REPO_RE.test(repo)) { candidates.push(candidateFor(plugin, 'rejected', 'invalid-repository')); continue; }
      if (plugin.disabled || plugin.deprecated) { candidates.push(candidateFor(plugin, 'rejected', 'disabled-or-deprecated')); continue; }
      if (!plugin.verified || !isAuthoritativeDshManifest(plugin.manifest_file)) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-required'));
        continue;
      }

      const declared = String(plugin.snapshot_commit || plugin.source?.commit || '').trim().toLowerCase();
      const commit = COMMIT_RE.test(declared)
        ? declared
        : await commitResolver(repo, String(plugin.snapshot_ref || plugin.source?.ref || 'HEAD'), token).catch((error) => {
          candidates.push(candidateFor(plugin, 'quarantined', `commit-resolution-failed:${error.message}`));
          return null;
        });
      if (!commit) {
        if (!candidates.some((item) => item.repo === repo && item.reason?.startsWith('commit-resolution-failed:'))) candidates.push(candidateFor(plugin, 'quarantined', 'no-immutable-commit'));
        continue;
      }

      let manifest;
      try {
        const loaded = await manifestLoader(repo, commit, token);
        manifest = loaded ? validatePackageManifest(loaded) : null;
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `manifest-v2-invalid:${error.message}`, { commit }));
        continue;
      }
      if (!manifest) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-not-found-at-immutable-commit', { commit }));
        continue;
      }
      if (manifest.source?.provider === 'github' && manifest.source?.repo
        && String(manifest.source.repo).toLowerCase() !== repo.toLowerCase()) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-source-repository-mismatch', { commit }));
        continue;
      }

      const type = manifest.type;
      const id = manifest.id;
      const key = packageKey(type, id);
      if (seen.has(key)) { candidates.push(candidateFor(plugin, 'rejected', `duplicate-package-key:${key}`, { key, type, id, version: manifest.version, commit })); continue; }
      seen.add(key);
      try {
        records.push(recordFor(plugin, repo, commit, manifest));
        candidates.push(candidateFor(plugin, 'accepted', null, {
          key,
          type,
          id,
          version: manifest.version,
          channel: manifest.channel,
          publisher: manifest.publisher,
          manifest_version: manifest.manifest_version,
          commit,
          metadata: metadataFor(plugin, id, repo, manifest),
        }));
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `manifest-v2-record-invalid:${error.message}`, { key, type, id, version: manifest.version, commit }));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, input.length)) }, () => worker()));
  candidates.sort((a, b) => String(a.key || a.repo).localeCompare(String(b.key || b.repo)));
  const registry = buildRegistryV4(records, { generated_at: options.generated_at || new Date().toISOString(), source: 'dsh-go-sync-v4' });
  const counts = Object.fromEntries(['accepted', 'quarantined', 'rejected'].map((status) => [status, candidates.filter((item) => item.status === status).length]));
  registry.metadata.discovery_count = input.length;
  registry.metadata.candidate_count = candidates.length;
  registry.metadata.quarantined_count = counts.quarantined;
  registry.metadata.rejected_count = counts.rejected;
  const candidateReport = {
    version: 1,
    authority: false,
    generated_at: registry.generated_at,
    registry_revision: registry.revision,
    counts,
    candidates,
  };
  const excluded = candidates.filter((item) => item.status !== 'accepted').map((item) => ({ repo: item.repo, reason: item.reason, status: item.status }));
  return { registry, candidates: candidateReport, stats: { input: input.length, output: records.length, accepted: counts.accepted, quarantined: counts.quarantined, rejected: counts.rejected, excluded } };
}
