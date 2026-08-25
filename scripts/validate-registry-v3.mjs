#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { artifactIntegrity, registryContentHash } from './checksum.mjs';
import { DEFAULT_PLUGIN_VERSION, REGISTRY_VERSION, SCHEMA_VERSION, isCommitSha } from './registry-v3-builder.mjs';
import { canonicalRepoKey, canonicalRepoUrl, makeInstallCmd, repoNameFromFullName } from './repository-identity.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_FILE = resolve(ROOT, 'catalog/registry-v3.json');
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const RUNTIMES = new Set(['plugin', 'mcp', 'skill', 'agent']);

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
    if (!id) errors.push('plugin missing id');
    if (ids.has(id)) errors.push(`duplicate id: ${id}`);
    ids.add(id);

    if (plugin?.version !== DEFAULT_PLUGIN_VERSION) errors.push(`${id}: version must be ${DEFAULT_PLUGIN_VERSION}`);
    const repo = String(plugin?.source?.repo || '');
    if (!REPO_RE.test(repo)) errors.push(`${id}: invalid source.repo`);
    const repoKey = canonicalRepoKey(repo);
    if (repos.has(repoKey)) errors.push(`${id}: duplicate source.repo ${repo}`);
    repos.add(repoKey);
    if (!plugin?.source?.ref) errors.push(`${id}: missing source.ref`);
    if (!isCommitSha(plugin?.source?.commit)) errors.push(`${id}: invalid source.commit`);

    if (plugin?.artifact?.integrity_scope !== 'source-identity') errors.push(`${id}: artifact.integrity_scope must be source-identity`);
    if (plugin?.artifact?.integrity !== artifactIntegrity(plugin)) errors.push(`${id}: artifact integrity mismatch`);

    const runtime = plugin?.runtime?.type;
    if (!RUNTIMES.has(runtime)) errors.push(`${id}: unsupported runtime.type ${runtime || '<missing>'}`);
    if (plugin?.runtime?.activation !== 'restart-required') warns.push(`${id}: runtime activation is not restart-required`);
    if (!Array.isArray(plugin?.capabilities) || !plugin.capabilities.includes('plugin')) errors.push(`${id}: capabilities must include plugin`);
    if (!Array.isArray(plugin?.dependencies)) errors.push(`${id}: dependencies must be array`);
    const metadata = plugin?.metadata || {};
    if (metadata.repo_name && metadata.repo_name !== repoNameFromFullName(repo)) errors.push(`${id}: metadata.repo_name mismatch`);
    if (metadata.repo_url && metadata.repo_url !== canonicalRepoUrl(repo)) errors.push(`${id}: metadata.repo_url is not canonical`);
    if (metadata.install_cmd && metadata.install_cmd !== makeInstallCmd(repo, metadata.category || 'other')) errors.push(`${id}: metadata.install_cmd source mismatch`);
    if (metadata.verified && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: verified metadata requires dsh-plugin.json`);
    if (metadata.manifest_file && metadata.manifest_file !== 'dsh-plugin.json') errors.push(`${id}: unsupported manifest_file ${metadata.manifest_file}`);
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
