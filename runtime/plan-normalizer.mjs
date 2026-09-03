import { readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parsePackageRequest } from './package-model.mjs';

function normalizedEntry(entry) {
  if (typeof entry === 'string') {
    const request = parsePackageRequest(entry, { defaultVersion: '*', defaultType: 'plugin', channel: 'stable' });
    return `${request.type}:${request.id}@${request.versionRange}`;
  }
  if (!entry || typeof entry !== 'object' || !entry.id) throw new Error('package plan entry requires id');
  const type = entry.type || 'plugin';
  const version = entry.version || entry.range || '*';
  const request = parsePackageRequest(`${type}:${entry.id}@${version}`, {
    defaultVersion: '*',
    defaultType: type,
    channel: entry.channel || 'stable',
    registry: entry.registry || null,
  });
  return {
    ...entry,
    id: request.id,
    type: request.type,
    version: request.versionRange,
    channel: request.channel,
    ...(request.registry ? { registry: request.registry } : {}),
  };
}

export function normalizePackagePlanDocument(document) {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('package plan must be a JSON object');
  const key = Array.isArray(document.packages)
    ? 'packages'
    : Array.isArray(document.items)
      ? 'items'
      : Array.isArray(document.plugins)
        ? 'plugins'
        : null;
  if (!key || document[key].length === 0) throw new Error('package plan has no packages');
  return {
    ...document,
    [key]: document[key].map(normalizedEntry),
  };
}

export async function withNormalizedPackagePlan(file, callback) {
  const original = resolve(file);
  const document = normalizePackagePlanDocument(JSON.parse(await readFile(original, 'utf8')));
  const temp = join(tmpdir(), `dsh-package-plan-${randomUUID()}.json`);
  await writeFile(temp, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
  try {
    const result = await callback(temp, document);
    if (result && typeof result === 'object' && !Array.isArray(result)) return { ...result, file: original };
    return result;
  } finally {
    await rm(temp, { force: true }).catch(() => {});
  }
}
