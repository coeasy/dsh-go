import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { assertPackageType, safePackageId } from './package-model.mjs';
import { runtimeRoot } from './registry.mjs';

const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

export function configPath(type, id) {
  return join(runtimeRoot(), 'config', assertPackageType(type), `${safePackageId(id)}.json`);
}

export async function readPackageConfig(type, id) {
  const file = configPath(type, id);
  try {
    const value = JSON.parse(await readFile(file, 'utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package config must be a JSON object');
    return value;
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

export async function writePackageConfig(type, id, value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('package config must be a JSON object');
  const file = configPath(type, id);
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, file);
  return { type: assertPackageType(type), id: safePackageId(id), file, config: value };
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

export async function setPackageConfig(type, id, key, rawValue) {
  const config = structuredClone(await readPackageConfig(type, id));
  const parts = pathParts(key);
  let cursor = config;
  for (const part of parts.slice(0, -1)) {
    const current = cursor[part];
    if (!current || typeof current !== 'object' || Array.isArray(current)) cursor[part] = {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = parseValue(rawValue);
  return writePackageConfig(type, id, config);
}

export async function unsetPackageConfig(type, id, key) {
  const config = structuredClone(await readPackageConfig(type, id));
  const parts = pathParts(key);
  let cursor = config;
  for (const part of parts.slice(0, -1)) {
    if (!cursor?.[part] || typeof cursor[part] !== 'object') return writePackageConfig(type, id, config);
    cursor = cursor[part];
  }
  delete cursor[parts.at(-1)];
  return writePackageConfig(type, id, config);
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
