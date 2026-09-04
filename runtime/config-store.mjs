import { randomUUID } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { normalizePackageId, normalizePackageType } from '../packages/protocol-core/index.mjs';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function safePackageFileId(id) {
  return normalizePackageId(id).replaceAll('/', '__');
}

export function configPath(type, id) {
  return join(runtimeRoot(), 'config', normalizePackageType(type), `${safePackageFileId(id)}.json`);
}

export function userConfigPath() {
  return resolve(process.env.DSH_USER_CONFIG || join(runtimeRoot(), 'config', 'user.json'));
}

export function workspaceConfigPath(cwd = process.cwd()) {
  return resolve(cwd, '.dsh', 'config.json');
}

export function configLockPath(type, id) {
  return `${configPath(type, id)}.lock`;
}

async function readJsonObject(file, fallback = {}) {
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`config must be a JSON object: ${file}`);
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return structuredClone(fallback);
    throw error;
  }
}

export async function readPackageConfig(type, id) {
  return readJsonObject(configPath(type, id));
}

export async function readUserConfig(file = userConfigPath()) {
  return readJsonObject(file);
}

export async function readWorkspaceConfig(file = workspaceConfigPath()) {
  return readJsonObject(file);
}

async function writePackageConfigUnlocked(type, id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package config must be a JSON object');
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  const file = configPath(normalizedType, normalizedId);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  try { await chmod(file, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
  return { type: normalizedType, id: normalizedId, file, config: value };
}

export async function writePackageConfig(type, id, value) {
  return withFileLock(configLockPath(type, id), () => writePackageConfigUnlocked(type, id, value));
}

function pathParts(path) {
  const parts = String(path || '').split('.').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) throw new Error('config key is required');
  if (parts.some((part) => UNSAFE_KEYS.has(part))) throw new Error('unsafe config key');
  return parts;
}

function parseValue(raw) {
  if (typeof raw !== 'string') return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function mergeConfig(base, overlay) {
  if (!overlay || typeof overlay !== 'object' || Array.isArray(overlay)) return structuredClone(base || {});
  const output = base && typeof base === 'object' && !Array.isArray(base) ? structuredClone(base) : {};
  for (const [key, value] of Object.entries(overlay)) {
    if (UNSAFE_KEYS.has(key)) continue;
    if (value && typeof value === 'object' && !Array.isArray(value)
      && output[key] && typeof output[key] === 'object' && !Array.isArray(output[key])) {
      output[key] = mergeConfig(output[key], value);
    } else output[key] = structuredClone(value);
  }
  return output;
}

export async function resolveEffectiveConfig(type, id, options = {}) {
  const normalizedType = normalizePackageType(type);
  const normalizedId = normalizePackageId(id);
  const defaults = options.defaults && typeof options.defaults === 'object' ? options.defaults : {};
  const user = options.userConfig || await readUserConfig(options.userConfigFile || userConfigPath());
  const workspace = options.workspaceConfig || await readWorkspaceConfig(options.workspaceConfigFile || workspaceConfigPath(options.cwd));
  const instance = options.packageConfig || await readPackageConfig(normalizedType, normalizedId);
  const userPackage = user?.packages?.[normalizedType]?.[normalizedId] || user?.packages?.[`${normalizedType}:${normalizedId}`] || {};
  const workspacePackage = workspace?.packages?.[normalizedType]?.[normalizedId] || workspace?.packages?.[`${normalizedType}:${normalizedId}`] || {};
  const effective = mergeConfig(mergeConfig(mergeConfig(defaults, userPackage), workspacePackage), instance);
  if (options.resolveSecrets === true) {
    if (typeof options.getSecret !== 'function') throw new Error('resolveEffectiveConfig requires getSecret when resolveSecrets=true');
    return resolveConfigSecrets(effective, options.getSecret);
  }
  return effective;
}

export async function setPackageConfig(type, id, key, rawValue) {
  return withFileLock(configLockPath(type, id), async () => {
    const config = structuredClone(await readPackageConfig(type, id));
    const parts = pathParts(key);
    let cursor = config;
    for (const part of parts.slice(0, -1)) {
      const current = cursor[part];
      if (!current || typeof current !== 'object' || Array.isArray(current)) cursor[part] = {};
      cursor = cursor[part];
    }
    cursor[parts.at(-1)] = parseValue(rawValue);
    return writePackageConfigUnlocked(type, id, config);
  });
}

export async function unsetPackageConfig(type, id, key) {
  return withFileLock(configLockPath(type, id), async () => {
    const config = structuredClone(await readPackageConfig(type, id));
    const parts = pathParts(key);
    let cursor = config;
    for (const part of parts.slice(0, -1)) {
      if (!cursor?.[part] || typeof cursor[part] !== 'object') return writePackageConfigUnlocked(type, id, config);
      cursor = cursor[part];
    }
    delete cursor[parts.at(-1)];
    return writePackageConfigUnlocked(type, id, config);
  });
}

export function redactConfig(value) {
  if (Array.isArray(value)) return value.map(redactConfig);
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && typeof value.$secret === 'string') return { $secret: value.$secret, value: '<secret>' };
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactConfig(item)]));
}

export async function resolveConfigSecrets(value, getSecret) {
  if (Array.isArray(value)) return Promise.all(value.map((item) => resolveConfigSecrets(item, getSecret)));
  if (!value || typeof value !== 'object') return value;
  if (Object.keys(value).length === 1 && typeof value.$secret === 'string') {
    const secret = await getSecret(value.$secret);
    if (secret === null || secret === undefined) throw new Error(`secret not found: ${value.$secret}`);
    return secret;
  }
  const entries = await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await resolveConfigSecrets(item, getSecret)]));
  return Object.fromEntries(entries);
}
