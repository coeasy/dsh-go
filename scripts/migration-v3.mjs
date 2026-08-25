#!/usr/bin/env node

/**
 * Registry V3 migration helper.
 * Normalizes old catalog records without destroying history.
 */
export function migratePlugin(plugin) {
  return {
    ...plugin,
    id: plugin.id || plugin.slug,
    version: plugin.version || '0.1.0',
    source: {
      ...(plugin.source || {}),
      repo: plugin.source?.repo || plugin.full_name || '',
      commit: plugin.source?.commit || plugin.commit || ''
    },
    capabilities: plugin.capabilities || [],
    runtime: plugin.runtime || { type: 'plugin' }
  };
}

export function migrateRegistry(registry) {
  return {
    registry_version: 3,
    generated: registry.generated || {},
    plugins: (registry.plugins || []).map(migratePlugin)
  };
}
