#!/usr/bin/env node

/**
 * Runtime resolver foundation for plugin/mcp/skill loading.
 */

export function resolvePlugin(registry, id, version = '0.1.0') {
  const plugin = (registry.plugins || []).find((item) => {
    const itemId = item.id || item.slug;
    return itemId === id && item.version === version;
  });

  if (!plugin) {
    throw new Error(`Plugin not found: ${id}@${version}`);
  }

  return {
    id: plugin.id || plugin.slug,
    version: plugin.version,
    commit: plugin.source?.commit || plugin.commit || null,
    runtime: plugin.runtime || { type: 'plugin' },
    capabilities: plugin.capabilities || []
  };
}
