#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export function parsePluginSpec(spec, defaultVersion = '0.1.0') {
  const raw = String(spec || '').trim();
  if (!raw) throw new Error('plugin spec is required');
  const at = raw.lastIndexOf('@');
  if (at > 0) {
    const id = raw.slice(0, at);
    const version = raw.slice(at + 1) || defaultVersion;
    return { id, version };
  }
  return { id: raw, version: defaultVersion };
}

export function resolvePlugin(registry, id, version = registry?.defaults?.plugin_version || '0.1.0') {
  if (registry?.registry_version !== 3) throw new Error('Registry V3 is required');
  const plugin = (registry.plugins || []).find((item) => item.id === id && item.version === version);
  if (!plugin) throw new Error(`Plugin not found: ${id}@${version}`);

  return {
    id: plugin.id,
    version: plugin.version,
    repo: plugin.source.repo,
    ref: plugin.source.ref,
    commit: plugin.source.commit,
    archive_url: plugin.source.archive_url,
    integrity: plugin.artifact.integrity,
    runtime: plugin.runtime,
    capabilities: plugin.capabilities || [],
    dependencies: plugin.dependencies || [],
    metadata: plugin.metadata || {},
    source: plugin.source,
    artifact: plugin.artifact,
  };
}

export async function loadRegistryFile(file = 'catalog/registry-v3.json') {
  const path = resolve(process.cwd(), file);
  return JSON.parse(await readFile(path, 'utf8'));
}
