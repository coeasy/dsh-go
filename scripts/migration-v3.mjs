#!/usr/bin/env node
/**
 * Pure V2 -> V3 normalization helpers.
 * Immutable commit resolution is intentionally performed by sync-v3/registry-v3-builder;
 * migration never invents a commit SHA.
 */
import { artifactIntegrity } from './checksum.mjs';
import { DEFAULT_PLUGIN_VERSION, inferCapabilities, inferRuntimeType, isCommitSha, normalizeLegacyPlugin } from './registry-v3-builder.mjs';

export function migratePlugin(plugin) {
  const normalized = normalizeLegacyPlugin(plugin);
  if (normalized.error) return { plugin: null, unresolved: normalized.error };

  const snapshot = String(plugin.source?.commit || plugin.commit || plugin.snapshot_commit || '');
  const commit = isCommitSha(snapshot) ? snapshot.toLowerCase() : '';
  const record = {
    id: normalized.id,
    version: DEFAULT_PLUGIN_VERSION,
    source: {
      provider: 'github',
      repo: normalized.repo,
      ref: normalized.ref,
      commit,
      updated_at: plugin.updated_at || '',
      archive_url: commit ? `https://github.com/${normalized.repo}/archive/${commit}.tar.gz` : '',
    },
    artifact: {
      kind: 'git-source',
      algorithm: 'sha256',
      integrity_scope: 'source-identity',
      integrity: '',
    },
    runtime: { type: inferRuntimeType(plugin), activation: 'restart-required' },
    capabilities: inferCapabilities(plugin),
    dependencies: Array.isArray(plugin.dependencies) ? plugin.dependencies : [],
    metadata: {
      name: plugin.name || normalized.id,
      description: plugin.description || '',
      category: plugin.category || 'other',
      verified: Boolean(plugin.verified),
      stars: Number(plugin.stars || 0),
      rank: Number(plugin.rank || 0),
      repo_url: plugin.repo_url || `https://github.com/${normalized.repo}`,
      install_cmd: plugin.install_cmd || '',
      manifest_file: plugin.manifest_file || null,
    },
  };
  if (commit) record.artifact.integrity = artifactIntegrity(record);
  return { plugin: record, unresolved: commit ? null : 'immutable commit required' };
}

export function migrateRegistry(legacyCatalog) {
  const migrated = [];
  const unresolved = [];
  for (const legacy of legacyCatalog?.plugins || []) {
    const result = migratePlugin(legacy);
    if (result.plugin) migrated.push(result.plugin);
    if (result.unresolved) unresolved.push({ repo: legacy.full_name || '', reason: result.unresolved });
  }
  return { migrated, unresolved };
}
