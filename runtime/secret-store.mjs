import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

const NAME_RE = /^[A-Za-z0-9_.-]{1,160}$/;

export function secretStorePaths() {
  const base = join(runtimeRoot(), 'secrets');
  const key = join(base, 'master.key');
  const data = join(base, 'secrets.json.enc');
  return {
    base,
    key,
    data,
    key_lock: `${key}.lock`,
    data_lock: `${data}.lock`,
  };
}

function assertSecretName(name) {
  const normalized = String(name || '').trim();
  if (!NAME_RE.test(normalized)) throw new Error('secret name must use letters, numbers, dot, underscore, or dash');
  return normalized;
}

async function readMasterKey(paths) {
  const raw = await readFile(paths.key, 'utf8');
  const key = Buffer.from(raw.trim(), 'base64');
  if (key.byteLength !== 32) throw new Error('invalid DSH secret master key');
  return key;
}

async function masterKey() {
  const paths = secretStorePaths();
  try {
    return await readMasterKey(paths);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  return withFileLock(paths.key_lock, async () => {
    try {
      return await readMasterKey(paths);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }

    await mkdir(paths.base, { recursive: true });
    const key = randomBytes(32);
    const temp = `${paths.key}.tmp-${process.pid}-${Date.now()}`;
    await writeFile(temp, `${key.toString('base64')}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, paths.key);
    try { await chmod(paths.key, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
    return key;
  });
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
  const key = await masterKey();
  const iv = Buffer.from(payload.iv, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
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
  await mkdir(dirname(paths.data), { recursive: true });
  const temp = `${paths.data}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(payload)}\n`, { encoding: 'utf8', mode: 0o600 });
  await rename(temp, paths.data);
  try { await chmod(paths.data, 0o600); } catch { /* Windows ACLs are managed by the OS */ }
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
