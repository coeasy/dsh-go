import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';
import {
  configuredSecretKeyBackend,
  createSecretMasterKey,
  readExistingSecretMasterKey,
  secretProviderStatus,
} from './secret-provider.mjs';

const NAME_RE = /^[A-Za-z0-9_.-]{1,160}$/;

export function secretStorePaths() {
  const base = join(runtimeRoot(), 'secrets');
  const key = join(base, 'master.key');
  const data = join(base, 'secrets.json.enc');
  return {
    base,
    key,
    data,
    backend: join(base, 'master.backend.json'),
    dpapi: join(base, 'master.dpapi'),
    key_lock: `${key}.lock`,
    data_lock: `${data}.lock`,
  };
}

function assertSecretName(name) {
  const normalized = String(name || '').trim();
  if (!NAME_RE.test(normalized)) throw new Error('secret name must use letters, numbers, dot, underscore, or dash');
  return normalized;
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function atomicWrite(path, content, mode = 0o600) {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
  await writeFile(temp, content, { encoding: 'utf8', mode });
  await rename(temp, path);
  try { await chmod(path, mode); } catch { /* Windows ACLs are managed by the OS */ }
}

async function masterKey() {
  const paths = secretStorePaths();
  const existing = await readExistingSecretMasterKey(paths);
  if (existing) return existing.key;

  return withFileLock(paths.key_lock, async () => {
    const current = await readExistingSecretMasterKey(paths);
    if (current) return current.key;

    if (await exists(paths.data)) {
      const error = new Error('DSH encrypted secret data exists but its master key is missing');
      error.code = 'DSH_SECRET_MASTER_KEY_MISSING';
      throw error;
    }

    await mkdir(paths.base, { recursive: true });
    const created = await createSecretMasterKey(paths, configuredSecretKeyBackend());
    return created.key;
  });
}

export async function secretStoreStatus() {
  const paths = secretStorePaths();
  const status = await secretProviderStatus(paths, configuredSecretKeyBackend());
  return {
    ...status,
    encrypted_data_present: await exists(paths.data),
  };
}

async function readSecrets() {
  const paths = secretStorePaths();
  let payload;
  try {
    payload = JSON.parse(await readFile(paths.data, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  if (!payload || payload.algorithm !== 'aes-256-gcm') throw new Error('unsupported DSH secret payload');
  const key = await masterKey();
  const iv = Buffer.from(payload.iv || '', 'base64');
  const tag = Buffer.from(payload.tag || '', 'base64');
  const ciphertext = Buffer.from(payload.ciphertext || '', 'base64');
  if (iv.byteLength !== 12 || tag.byteLength !== 16) throw new Error('invalid DSH secret payload');
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  const value = JSON.parse(plaintext);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid DSH secret payload');
  return value;
}

async function writeSecrets(value) {
  const paths = secretStorePaths();
  const key = await masterKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const payload = {
    algorithm: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  await atomicWrite(paths.data, `${JSON.stringify(payload)}\n`);
}

export async function listSecrets() {
  return Object.keys(await readSecrets()).sort();
}

export async function getSecret(name) {
  const normalized = assertSecretName(name);
  const values = await readSecrets();
  return Object.prototype.hasOwnProperty.call(values, normalized) ? values[normalized] : null;
}

export async function setSecret(name, value) {
  const normalized = assertSecretName(name);
  const text = String(value ?? '');
  if (!text) throw new Error('secret value cannot be empty');
  const paths = secretStorePaths();
  return withFileLock(paths.data_lock, async () => {
    const values = await readSecrets();
    values[normalized] = text;
    await writeSecrets(values);
    return { name: normalized, stored: true };
  });
}

export async function deleteSecret(name) {
  const normalized = assertSecretName(name);
  const paths = secretStorePaths();
  return withFileLock(paths.data_lock, async () => {
    const values = await readSecrets();
    const existed = Object.prototype.hasOwnProperty.call(values, normalized);
    delete values[normalized];
    if (existed) await writeSecrets(values);
    return { name: normalized, deleted: existed };
  });
}
