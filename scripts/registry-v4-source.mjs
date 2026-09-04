import { buildRegistryV4 } from '../packages/registry-core/index.mjs';
import { normalizePackageId, normalizePackageType, packageKey } from '../packages/protocol-core/index.mjs';
import {
  packageReleaseTag,
  validatePackageManifest,
  validatePackageReleaseDescriptor,
} from '../packages/protocol-core/manifest.mjs';
import { normalizeStoredPlugin, isAuthoritativeDshManifest } from './repository-identity.mjs';

const COMMIT_RE = /^[0-9a-f]{40}$/i;
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const RELEASE_DESCRIPTOR_NAME = 'dsh-package-release.json';

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
        redirect: 'follow',
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

function normalizePackagePath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw === '.') return null;
  if (raw.startsWith('/') || raw.split('/').some((part) => !part || part === '.' || part === '..')) throw new Error('package path must be a safe repository-relative directory');
  return raw;
}

async function loadManifestV2(repo, commit, token, packagePath = null) {
  const path = packagePath ? `${packagePath}/dsh-package.json` : 'dsh-package.json';
  const response = await githubFetch(
    `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(commit)}`,
    token,
    { accept: 'application/vnd.github.raw+json' },
  );
  if (!response) return null;
  let raw;
  try { raw = await response.json(); }
  catch (error) { throw new Error(`${path} is not valid JSON: ${error.message}`); }
  const manifest = validatePackageManifest(raw);
  if (manifest.source?.provider === 'github' && manifest.source?.repo
    && String(manifest.source.repo).toLowerCase() !== repo.toLowerCase()) {
    throw new Error(`Manifest V2 source.repo does not match discovered repository: ${manifest.source.repo} != ${repo}`);
  }
  return manifest;
}

async function loadReleaseDescriptorV2(repo, manifest, packagePath, token) {
  const tag = packageReleaseTag({ id: manifest.id, version: manifest.version, package_path: packagePath });
  const url = `https://github.com/${repo}/releases/download/${encodeURIComponent(tag)}/${RELEASE_DESCRIPTOR_NAME}`;
  const response = await githubFetch(url, token, { accept: 'application/json' });
  if (!response) return null;
  let raw;
  try { raw = await response.json(); }
  catch (error) {
    const invalid = new Error(`Release Descriptor V2 is not valid JSON: ${error.message}`);
    invalid.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw invalid;
  }
  return validatePackageReleaseDescriptor(raw, {
    type: manifest.type,
    id: manifest.id,
    version: manifest.version,
    channel: manifest.channel,
    repository: repo,
    tag,
    package_path: packagePath,
  });
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

function diagnosticTypeFor(plugin) {
  if (PACKAGE_TYPES.has(String(plugin.package_type || '').toLowerCase())) return normalizePackageType(plugin.package_type);
  if (plugin.category === 'mcp') return 'mcp';
  if (plugin.category === 'skills') return 'skill';
  if (plugin.category === 'agent') return 'agent';
  return 'plugin';
}

function candidateFor(plugin, status, reason, extra = {}) {
  const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
  let type = null;
  let id = String(plugin.package_id || plugin.id || plugin.slug || repo).trim().toLowerCase();
  try {
    type = diagnosticTypeFor(plugin);
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

function recordFor(plugin, repo, descriptor) {
  const manifest = descriptor.manifest;
  const type = normalizePackageType(manifest.type);
  const id = normalizePackageId(manifest.id);
  return {
    type,
    id,
    version: manifest.version,
    channel: manifest.channel,
    published_at: descriptor.published_at,
    source: { provider: 'github', repo, ref: descriptor.tag, commit: descriptor.commit },
    artifact: {
      ...descriptor.artifact,
      integrity: descriptor.artifact.digest,
      release_tag: descriptor.tag,
      package_path: descriptor.package_path,
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

function explicitWorkItems(sources = []) {
  return (Array.isArray(sources) ? sources : []).filter((source) => source?.enabled !== false).map((source) => {
    const repo = String(source?.repository || '').trim();
    const packagePath = normalizePackagePath(source?.package_path);
    return {
      explicit: true,
      packagePath,
      ref: String(source?.ref || 'HEAD').trim() || 'HEAD',
      plugin: normalizeStoredPlugin({
        full_name: repo,
        repo_url: `https://github.com/${repo}`,
        manifest_file: 'dsh-package.json',
        verified: true,
        metadata_source: 'dsh-package',
        category: 'other',
        name: repo.split('/').at(-1) || repo,
        description: '',
        tags: [],
        topics: [],
      }),
    };
  });
}

export async function buildRegistryV4FromDiscovery(discovery, options = {}) {
  const token = options.token || '';
  const manifestLoader = options.loadManifest || loadManifestV2;
  const descriptorLoader = options.loadReleaseDescriptor || loadReleaseDescriptorV2;
  const commitResolver = options.resolveCommit || resolveCommit;
  const discoveryInput = Array.isArray(discovery?.plugins) ? discovery.plugins : [];
  const work = discoveryInput.map((raw) => ({ explicit: false, packagePath: null, ref: null, plugin: normalizeStoredPlugin(raw) }))
    .concat(explicitWorkItems(options.explicitSources));
  const records = [];
  const candidates = [];
  const seen = new Set();
  const concurrency = Math.max(1, Math.min(64, Number(options.concurrency || process.env.REGISTRY_COMMIT_CONCURRENCY || 24)));
  let cursor = 0;

  async function worker() {
    while (cursor < work.length) {
      const index = cursor++;
      const item = work[index];
      const plugin = item.plugin;
      const repo = String(plugin.full_name || plugin.source?.repo || '').trim();
      if (!REPO_RE.test(repo)) { candidates.push(candidateFor(plugin, 'rejected', 'invalid-repository', { package_path: item.packagePath })); continue; }
      if (plugin.disabled || plugin.deprecated) { candidates.push(candidateFor(plugin, 'rejected', 'disabled-or-deprecated', { package_path: item.packagePath })); continue; }
      if (!item.explicit && (!plugin.verified || !isAuthoritativeDshManifest(plugin.manifest_file))) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-required'));
        continue;
      }

      const declared = item.explicit ? '' : String(plugin.snapshot_commit || plugin.source?.commit || '').trim().toLowerCase();
      const observationCommit = COMMIT_RE.test(declared)
        ? declared
        : await commitResolver(repo, item.ref || String(plugin.snapshot_ref || plugin.source?.ref || 'HEAD'), token).catch((error) => {
          candidates.push(candidateFor(plugin, 'quarantined', `commit-resolution-failed:${error.message}`, { package_path: item.packagePath }));
          return null;
        });
      if (!observationCommit) {
        if (!candidates.some((candidate) => candidate.repo === repo && candidate.package_path === item.packagePath && candidate.reason?.startsWith('commit-resolution-failed:'))) {
          candidates.push(candidateFor(plugin, 'quarantined', 'no-immutable-observation-commit', { package_path: item.packagePath }));
        }
        continue;
      }

      let manifest;
      try {
        const loaded = await manifestLoader(repo, observationCommit, token, item.packagePath);
        manifest = loaded ? validatePackageManifest(loaded) : null;
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `manifest-v2-invalid:${error.message}`, { observation_commit: observationCommit, package_path: item.packagePath }));
        continue;
      }
      if (!manifest) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-not-found-at-observation-commit', { observation_commit: observationCommit, package_path: item.packagePath }));
        continue;
      }
      if (manifest.source?.provider === 'github' && manifest.source?.repo
        && String(manifest.source.repo).toLowerCase() !== repo.toLowerCase()) {
        candidates.push(candidateFor(plugin, 'quarantined', 'manifest-v2-source-repository-mismatch', { observation_commit: observationCommit, package_path: item.packagePath }));
        continue;
      }

      let packagePath;
      try {
        const declaredPackagePath = normalizePackagePath(manifest.release?.package_path);
        if (item.packagePath && declaredPackagePath && item.packagePath !== declaredPackagePath) {
          throw new Error(`explicit package path ${item.packagePath} does not match Manifest V2 release.package_path ${declaredPackagePath}`);
        }
        packagePath = item.packagePath || declaredPackagePath;
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `manifest-v2-release-scope-invalid:${error.message}`, { observation_commit: observationCommit, package_path: item.packagePath }));
        continue;
      }

      let descriptor;
      try {
        descriptor = await descriptorLoader(repo, manifest, packagePath, token);
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `release-descriptor-v2-invalid:${error.message}`, {
          key: packageKey(manifest.type, manifest.id),
          type: manifest.type,
          id: manifest.id,
          version: manifest.version,
          channel: manifest.channel,
          observation_commit: observationCommit,
          package_path: packagePath,
        }));
        continue;
      }
      if (!descriptor) {
        candidates.push(candidateFor(plugin, 'quarantined', 'release-descriptor-v2-required', {
          key: packageKey(manifest.type, manifest.id),
          type: manifest.type,
          id: manifest.id,
          version: manifest.version,
          channel: manifest.channel,
          observation_commit: observationCommit,
          package_path: packagePath,
        }));
        continue;
      }

      const releaseManifest = descriptor.manifest;
      const type = releaseManifest.type;
      const id = releaseManifest.id;
      const key = packageKey(type, id);
      if (seen.has(key)) {
        candidates.push(candidateFor(plugin, 'rejected', `duplicate-package-key:${key}`, {
          key,
          type,
          id,
          version: releaseManifest.version,
          observation_commit: observationCommit,
          commit: descriptor.commit,
          package_path: descriptor.package_path,
        }));
        continue;
      }
      seen.add(key);
      try {
        records.push(recordFor(plugin, repo, descriptor));
        candidates.push(candidateFor(plugin, 'accepted', null, {
          key,
          type,
          id,
          version: releaseManifest.version,
          channel: releaseManifest.channel,
          publisher: releaseManifest.publisher,
          manifest_version: releaseManifest.manifest_version,
          release_version: descriptor.release_version,
          observation_commit: observationCommit,
          commit: descriptor.commit,
          release_tag: descriptor.tag,
          package_path: descriptor.package_path,
          artifact_digest: descriptor.artifact.digest,
          metadata: metadataFor(plugin, id, repo, releaseManifest),
        }));
      } catch (error) {
        candidates.push(candidateFor(plugin, 'quarantined', `release-descriptor-v2-record-invalid:${error.message}`, {
          key,
          type,
          id,
          version: releaseManifest.version,
          observation_commit: observationCommit,
          commit: descriptor.commit,
          package_path: descriptor.package_path,
        }));
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, work.length)) }, () => worker()));
  candidates.sort((a, b) => `${String(a.key || a.repo)}:${String(a.package_path || '')}`.localeCompare(`${String(b.key || b.repo)}:${String(b.package_path || '')}`));
  const registry = buildRegistryV4(records, { generated_at: options.generated_at || new Date().toISOString(), source: 'dsh-go-sync-v4' });
  const counts = Object.fromEntries(['accepted', 'quarantined', 'rejected'].map((status) => [status, candidates.filter((item) => item.status === status).length]));
  registry.metadata.discovery_count = discoveryInput.length;
  registry.metadata.explicit_source_count = work.length - discoveryInput.length;
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
  const excluded = candidates.filter((item) => item.status !== 'accepted').map((item) => ({ repo: item.repo, package_path: item.package_path || null, reason: item.reason, status: item.status }));
  return {
    registry,
    candidates: candidateReport,
    stats: {
      input: work.length,
      discovery_input: discoveryInput.length,
      explicit_sources: work.length - discoveryInput.length,
      output: records.length,
      accepted: counts.accepted,
      quarantined: counts.quarantined,
      rejected: counts.rejected,
      excluded,
    },
  };
}
