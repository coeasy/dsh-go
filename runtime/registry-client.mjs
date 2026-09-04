import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateRegistryV4 } from '../packages/registry-core/index.mjs';

const DEFAULT_REGISTRY_URL = 'https://dsh-go.pages.dev/catalog/registry-v4.json';

export function registrySource(options = {}) {
  return options.registry || process.env.DSH_REGISTRY_V4 || DEFAULT_REGISTRY_URL;
}

export async function loadRuntimeRegistryV4(options = {}) {
  const source = registrySource(options);
  if (/^https:\/\//i.test(source)) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Number(options.timeoutMs || 30_000));
    try {
      const response = await fetch(source, {
        headers: { accept: 'application/json' },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`Registry V4 request failed: HTTP ${response.status}`);
      return validateRegistryV4(await response.json());
    } finally {
      clearTimeout(timeout);
    }
  }
  if (/^http:\/\//i.test(source)) throw new Error('Registry V4 transport must use HTTPS');
  return validateRegistryV4(JSON.parse(await readFile(resolve(source), 'utf8')));
}
