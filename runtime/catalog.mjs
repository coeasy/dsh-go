import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export const DEFAULT_REGISTRY_URL = 'https://coeasy.github.io/dsh-go/catalog/registry-v3.json';

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export function registryCacheFile() {
  return process.env.DSH_REGISTRY_CACHE || join(homedir(), '.dsh', 'cache', 'registry-v3.json');
}

export async function loadRegistrySource(source, options = {}) {
  const input = String(source || '').trim();
  if (/^https?:\/\//i.test(input)) {
    const response = await fetch(input, {
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-runtime-v3' },
      signal: AbortSignal.timeout(options.timeout || 30000),
    });
    if (!response.ok) throw new Error(`registry fetch failed: HTTP ${response.status}`);
    const data = await response.json();
    if (data?.registry_version !== 3 || !Array.isArray(data?.plugins)) throw new Error('remote registry is not Registry V3');
    return data;
  }
  const file = resolve(input || 'catalog/registry-v3.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  if (data?.registry_version !== 3 || !Array.isArray(data?.plugins)) throw new Error('registry file is not Registry V3');
  return data;
}

export async function resolveRegistrySource(explicit) {
  if (explicit) return explicit;
  if (process.env.DSH_REGISTRY) return process.env.DSH_REGISTRY;
  const cwdRegistry = resolve(process.cwd(), 'catalog/registry-v3.json');
  if (await exists(cwdRegistry)) return cwdRegistry;
  return process.env.DSH_REGISTRY_URL || DEFAULT_REGISTRY_URL;
}

export async function ensureRegistryCache(source, options = {}) {
  const resolvedSource = await resolveRegistrySource(source);
  if (!/^https?:\/\//i.test(resolvedSource)) return resolve(resolvedSource);
  const file = resolve(options.cacheFile || registryCacheFile());
  await mkdir(dirname(file), { recursive: true });
  const response = await fetch(resolvedSource, {
    headers: { Accept: 'application/json', 'User-Agent': 'dsh-runtime-v3' },
    signal: AbortSignal.timeout(options.timeout || 30000),
  });
  if (!response.ok) throw new Error(`registry fetch failed: HTTP ${response.status}`);
  const text = await response.text();
  const parsed = JSON.parse(text);
  if (parsed?.registry_version !== 3 || !Array.isArray(parsed?.plugins)) throw new Error('remote registry is not Registry V3');
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, text.endsWith('\n') ? text : `${text}\n`, 'utf8');
  await rename(temp, file);
  return file;
}
