#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactIntegrity, registryContentHash } from './checksum.mjs';
import { DEFAULT_PLUGIN_VERSION, REGISTRY_VERSION, SCHEMA_VERSION, isCommitSha, isSupportedPackageVersion } from './registry-v3-builder.mjs';
import { canonicalRepoKey, canonicalRepoUrl, makeRegistryInstallCmd, normalizeOverrideFields, repoNameFromFullName } from './repository-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = resolve(ROOT, 'catalog/registry-v3.json');
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUNTIMES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const MANIFESTS = new Set(['dsh-package.json', 'dsh-plugin.json', 'dsh-mcp.json', 'dsh-skill.json', 'dsh-agent.json']);
const PERMISSIONS = new Set(['filesystem.read', 'filesystem.write', 'network', 'network.unrestricted', 'shell', 'secrets.read', 'mcp.tools', 'process.spawn']);
const ARTIFACT_KINDS = new Set(['git-source', 'release-archive']);
const RELEASE_FORMATS = new Set(['tgz', 'tar.gz']);
const SHA256_RE = /^sha256-[0-9a-f]{64}$/i;
const RELEASE_TAG_RE = /^[A-Za-z0-9_.-]{1,128}$/;

function legacyInstallProfile(category) {
  if (category === 'web-ui') return 'web';
  if (category === 'desktop') return 'desktop';
  return 'tools';
}

function legacyInstallCmd(repo, category) {
  return `dsh plugin --profile ${legacyInstallProfile(category)} add github:${repo}`;
}

function validateArtifact(id, artifact, errors) {
  const kind = artifact?.kind;
  if (!ARTIFACT_KINDS.has(kind)) errors.push(`${id}: unsupported artifact.kind ${kind || '<missing>'}`);
  if (artifact?.algorithm !== 'sha256') errors.push(`${id}: artifact.algorithm must be sha256`);
  if (artifact?.integrity_scope !== 'source-identity') errors.push(`${id}: artifact.integrity_scope must be source-identity`);
  if (kind !== 'release-archive') return;
  let url = null;
  try { url = new URL(String(artifact?.url || '')); } catch { errors.push(`${id}: release artifact.url must be a valid URL`); }
  if (url && url.protocol !== 'https:') errors.push(`${id}: release artifact.url must use https`);
  if (!SHA256_RE.test(String(artifact?.digest || ''))) errors.push(`${id}: release artifact.digest must be sha256-<64 hex>`);
  if (!RELEASE_FORMATS.has(String(artifact?.format || ''))) errors.push(`${id}: release artifact.format must be tgz or tar.gz`);
  if (artifact?.strip_components !== undefined) {
    const strip = Number(artifact.strip_components);
    if (!Number.isInteger(strip) || strip < 0 || strip > 8) errors.push(`${id}: artifact.strip_components must be an integer between 0 and 8`);
  }
  if (artifact?.release_tag !== undefined && !RELEASE_TAG_RE.test(String(artifact.release_tag))) errors.push(`${id}: artifact.release_tag is unsafe`);
}

export function validateRegistry(data) {
  const errors = [];
  const warns = [];

  if (!data || typeof data !== 'object') return { errors: ['registry empty'], warns };
  if (data.registry_version !== REGISTRY_VERSION) errors.push(`registry_version must be ${REGISTRY_VERSION}`);
  if (data.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  if (data.defaults?.plugin_version !== DEFAULT_PLUGIN_VERSION) errors.push(`defaults.plugin_version must be ${DEFAULT_PLUGIN_VERSION}`);
  if (!Array.isArray(data.plugins)) return { errors: [...errors, 'plugins must be array'], warns };
  if (data.plugins.length === 0) errors.push('registry must contain at least one plugin');

  const ids = new Set();
  const repos = new Set();
  for (const plugin of data.plugins) {
    const id = String(plugin?.id || '');
    const idKey = id.toLowerCase();
    if (!id) errors.push('plugin missing id');
    else if (!/^[A-Za-z0-9_.-]+$/.test(id)) errors.push(`invalid id: ${id}`);
    if (ids.has(idKey)) errors.push(`duplicate id after case normalization: ${id}`);
    ids.add(idKey);

    const manifestBacked = plugin?.metadata?.verified === true && MANIFESTS.has(plugin?.metadata?.manifest_file);
    if (!isSupportedPackageVersion(plugin?.version) || (!manifestBacked && plugin?.version !== DEFAULT_PLUGIN_VERSION)) {
      errors.push(`${id}: version must be ${DEFAULT_PLUGIN_VERSION} unless backed by a verified DSH manifest`);
    }
    const repo = String(plugin?.source?.repo || '');
    if (!REPO_RE.test(repo)) errors.push(`${id}: invalid source.repo`);
    const repoKey = canonicalRepoKey(repo);
    if (repos.has(repoKey)) errors.push(`${id}: duplicate source.repo ${repo}`);
    repos.add(repoKey);
    if (!plugin?.source?.ref) errors.push(`${id}: missing source.ref`);
    if (!isCommitSha(plugin?.source?.commit)) errors.push(`${id}: invalid source.commit`);

    validateArtifact(id, plugin?.artifact, errors);
    if (plugin?.artifact?.integrity !== artifactIntegrity(plugin)) errors.push(`${id}: artifact integrity mismatch`);

    const runtime = plugin?.runtime?.type;
    if (!RUNTIMES.has(runtime)) errors.push(`${id}: unsupported runtime.type ${runtime || '<missing>'}`);
    if (plugin?.runtime?.activation !== 'restart-required') warns.push(`${id}: runtime activation is not restart-required`);
    if (!Array.isArray(plugin?.capabilities) || !plugin.capabilities.includes('plugin')) errors.push(`${id}: capabilities must include plugin`);
    if (!Array.isArray(plugin?.dependencies)) errors.push(`${id}: dependencies must be array`);
    if (plugin.permissions !== undefined && (!Array.isArray(plugin.permissions) || plugin.permissions.some((permission) => !PERMISSIONS.has(permission)))) errors.push(`${id}: invalid permissions declaration`);
    if (plugin.compatibility !== undefined && (!plugin.compatibility || typeof plugin.compatibility !== 'object' || Array.isArray(plugin.compatibility))) errors.push(`${id}: compatibility must be object`);
    for (const field of ['conflicts', 'replaces', 'provides']) if (plugin[field] !== undefined && !Array.isArray(plugin[field])) errors.push(`${id}: ${field} must be array`);
    const metadata = plugin?.metadata || {};
    const repoName = repoNameFromFullName(repo);
    if (metadata.repo_name !== repoName) errors.push(`${id}: metadata.repo_name mismatch`);
    if (metadata.repo_url !== canonicalRepoUrl(repo)) errors.push(`${id}: metadata.repo_url is not canonical`);
    const expectedInstallCmd = makeRegistryInstallCmd(plugin);
    const historicalInstallCmd = legacyInstallCmd(repo, metadata.category || 'other');
    if (metadata.install_cmd !== expectedInstallCmd && metadata.install_cmd !== historicalInstallCmd) errors.push(`${id}: metadata.install_cmd source mismatch`);
    if (!['github', 'dsh-package', 'dsh-plugin', 'dsh-mcp', 'dsh-skill', 'dsh-agent', 'override'].includes(metadata.metadata_source)) errors.push(`${id}: unsupported metadata_source ${metadata.metadata_source || '<missing>'}`);
    if (metadata.metadata_source === 'github' && metadata.name !== repoName) errors.push(`${id}: GitHub metadata.name must match repository name`);
    if (metadata.metadata_source === 'github' && (metadata.verified || metadata.manifest_file)) errors.push(`${id}: GitHub metadata cannot be verified or manifest-backed`);
    if (metadata.metadata_source.startsWith('dsh-') && (!metadata.verified || !MANIFESTS.has(metadata.manifest_file))) errors.push(`${id}: DSH manifest metadata requires a verified supported manifest`);
    if (metadata.verified && !MANIFESTS.has(metadata.manifest_file)) errors.push(`${id}: verified metadata requires a supported DSH manifest`);
    if (metadata.manifest_file && !MANIFESTS.has(metadata.manifest_file)) errors.push(`${id}: unsupported manifest_file ${metadata.manifest_file}`);
    const overrideFields = normalizeOverrideFields(metadata.override_fields);
    if (metadata.metadata_source === 'override' && overrideFields.length === 0) errors.push(`${id}: override metadata missing override_fields`);
    if (Array.isArray(metadata.override_fields) && overrideFields.length !== metadata.override_fields.length) errors.push(`${id}: unsupported override_fields`);
  }

  if (data.generated?.count !== data.plugins.length) errors.push(`generated.count (${data.generated?.count}) does not match plugins length (${data.plugins.length})`);
  if (!data.generated?.source_catalog_etag) errors.push('generated.source_catalog_etag is required');
  if (data.generated?.discovery_mode !== 'complete') errors.push('generated.discovery_mode must be complete');
  if (!Number.isInteger(data.generated?.discovered_count) || data.generated.discovered_count <= 0) errors.push('generated.discovered_count must be a positive integer');
  if (data.generated?.content_hash !== registryContentHash(data)) errors.push('generated.content_hash mismatch');

  return { errors, warns };
}

function isMainModule() {
  try { return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]); } catch { return false; }
}

async function main() {
  const file = process.argv[2] ? resolve(process.cwd(), process.argv[2]) : DEFAULT_FILE;
  const data = JSON.parse(await readFile(file, 'utf8'));
  const { errors, warns } = validateRegistry(data);
  warns.forEach((warning) => console.warn('[WARN]', warning));
  if (errors.length) {
    errors.forEach((error) => console.error('[ERROR]', error));
    process.exit(1);
  }
  console.log(`Registry V3 validation passed: ${data.plugins.length} plugins, hash=${data.generated.content_hash}`);
}

if (isMainModule()) main().catch((error) => { console.error('[ERROR]', error.message); process.exit(1); });
