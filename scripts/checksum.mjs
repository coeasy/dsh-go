import { createHash } from 'node:crypto';

export function sha256(content) {
  return createHash('sha256').update(String(content)).digest('hex');
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sourceIdentityPayload(plugin) {
  return {
    provider: plugin.source?.provider || 'github',
    repo: plugin.source?.repo || plugin.full_name || '',
    version: plugin.version || '0.1.0',
    commit: plugin.source?.commit || plugin.commit || '',
  };
}

export function artifactIdentity(plugin) {
  return sha256(stableStringify(sourceIdentityPayload(plugin)));
}

export function artifactIntegrity(plugin) {
  return `sha256-${artifactIdentity(plugin)}`;
}

export function registryContentHash(registry) {
  return sha256(stableStringify({
    registry_version: registry.registry_version,
    schema_version: registry.schema_version,
    defaults: registry.defaults,
    plugins: registry.plugins,
  }));
}
