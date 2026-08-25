#!/usr/bin/env node
import { createHash } from 'node:crypto';

export function normalizePlugin(plugin) {
  return {
    id: plugin.id || plugin.slug,
    version: plugin.version || '0.1.0',
    source: {
      repo: plugin.full_name || plugin.repo,
      commit: plugin.commit || plugin.source?.commit || ''
    },
    runtime: plugin.runtime || { type: 'plugin' },
    capabilities: plugin.capabilities || []
  };
}

export function buildRegistry(plugins = [], commit = '') {
  const normalized = plugins.map(normalizePlugin);
  const payload = {
    registry_version: 3,
    generated: {
      commit,
      timestamp: new Date().toISOString()
    },
    plugins: normalized
  };
  payload.generated.hash = createHash('sha256').update(JSON.stringify(payload.plugins)).digest('hex');
  return payload;
}
