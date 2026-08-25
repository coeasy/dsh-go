import { createHash } from 'node:crypto';

export function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

export function artifactIdentity(plugin) {
  return sha256(JSON.stringify({
    id: plugin.id || plugin.slug,
    version: plugin.version || '0.1.0',
    commit: plugin.source?.commit || plugin.commit || ''
  }));
}
