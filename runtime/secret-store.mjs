import { spawn } from 'node:child_process';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

const NAME_RE = /^[A-Za-z0-9_.-]{1,160}$/;
const BACKENDS = new Set(['auto', 'file', 'dpapi', 'secret-service']);
const COMMAND_TIMEOUT_MS = 5_000;

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

function configuredBackend() {
  const backend = String(process.env.DSH_SECRET_KEY_BACKEND || 'auto').trim().toLowerCase();
  if (!BACKENDS.has(backend)) throw new Error(`unsupported DSH secret key backend: ${backend}`);
  return backend;
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

function runCommand(command, args, input = '') {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: process.env,
    });
    const stdout = [];
    const stderr = [];
    const timer = setTimeout(() => {
      child.kill();
      const error = new Error(`${command} timed out`);
      error.code = 'DSH_SECRET_BACKEND_TIMEOUT';
      reject(error);
    }, COMMAND_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      const error = new Error(`${command} exited with code ${code}${detail ? `: ${detail}` : ''}`);
      error.code = 'DSH_SECRET_BACKEND_UNAVAILABLE';
      reject(error);
    });
    child.stdin.end(input);
  });
}

function decodeKey(raw) {
  const key = Buffer.from(String(raw || '').trim(), 'base64');
  if (key.byteLength !== 32) throw new Error('invalid DSH secret master key');
  return key;
}

async function readFileMasterKey(paths) {
  return decodeKey(await readFile(paths.key, 'utf8'));
}

async function writeFileMasterKey(paths, key) {
  await atomicWrite(paths.key, `${key.toString('base64')}\n`);
  return key;
}

async function readBackendMarker(paths) {
  try {
    const marker = JSON.parse(await readFile(paths.backend, 'utf8'));
    if (!marker || marker.version !== 1 || !['dpapi', 'secret-service'].includes(marker.backend)) {
      throw new Error('invalid DSH secret backend metadata');
    }
    return marker;
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

async function writeBackendMarker(paths, marker) {
  await atomicWrite(paths.backend, `${JSON.stringify({ version: 1, ...marker }, null, 2)}\n`);
}

const DPAPI_PROTECT_SCRIPT = [
  '$value = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($value)',
  '$protected = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($protected))',
].join('; ');

const DPAPI_UNPROTECT_SCRIPT = [
  '$value = [Console]::In.ReadToEnd().Trim()',
  '$bytes = [Convert]::FromBase64String($value)',
  '$plain = [Security.Cryptography.ProtectedData]::Unprotect($bytes, $null, [Security.Cryptography.DataProtectionScope]::CurrentUser)',
  '[Console]::Out.Write([Convert]::ToBase64String($plain))',
].join('; ');

async function storeDpapiKey(paths, key) {
  if (process.platform !== 'win32') throw new Error('DPAPI secret backend is only available on Windows');
  const wrapped = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROTECT_SCRIPT], `${key.toString('base64')}\n`);
  await atomicWrite(paths.dpapi, `${wrapped.trim()}\n`);
  await writeBackendMarker(paths, { backend: 'dpapi' });
  return key;
}

async function readDpapiKey(paths) {
  if (process.platform !== 'win32') throw new Error('DPAPI secret backend is only available on Windows');
  const wrapped = await readFile(paths.dpapi, 'utf8');
  const plain = await runCommand('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_UNPROTECT_SCRIPT], wrapped);
  return decodeKey(plain);
}

function secretServiceKeyId(paths) {
  return createHash('sha256').update(paths.base).digest('hex').slice(0, 32);
}

async function storeSecretServiceKey(paths, key) {
  if (process.platform !== 'linux') throw new Error('Secret Service backend is only available on Linux');
  const keyId = secretServiceKeyId(paths);
  await runCommand(
    'secret-tool',
    ['store', '--label=DSH secret master key', 'application', 'dsh-go', 'store', keyId],
    `${key.toString('base64')}\n`,
  );
  await writeBackendMarker(paths, { backend: 'secret-service', key_id: keyId });
  return key;
}

async function readSecretServiceKey(paths, marker) {
  if (process.platform !== 'linux') throw new Error('Secret Service backend is only available on Linux');
  const keyId = marker.key_id || secretServiceKeyId(paths);
  const raw = await runCommand('secret-tool', ['lookup', 'application', 'dsh-go', 'store', keyId]);
  return decodeKey(raw);
}

async function readBackendKey(paths, marker) {
  if (marker.backend === 'dpapi') return readDpapiKey(paths);
  if (marker.backend === 'secret-service') return readSecretServiceKey(paths, marker);
  throw new Error(`unsupported DSH secret backend metadata: ${marker.backend}`);
}

async function existingMasterKey(paths) {
  const marker = await readBackendMarker(paths);
  if (marker) return { key: await readBackendKey(paths, marker), backend: marker.backend };
  try {
    return { key: await readFileMasterKey(paths), backend: 'file' };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

async function createMasterKey(paths, backend) {
  const key = randomBytes(32);
  if (backend === 'file') return { key: await writeFileMasterKey(paths, key), backend: 'file' };
  if (backend === 'dpapi') return { key: await storeDpapiKey(paths, key), backend: 'dpapi' };
  if (backend === 'secret-service') return { key: await storeSecretServiceKey(paths, key), backend: 'secret-service' };

  if (backend === 'auto') {
    if (process.platform === 'win32') {
      try { return { key: await storeDpapiKey(paths, key), backend: 'dpapi' }; } catch { /* fall back below */ }
    }
    if (process.platform === 'linux') {
      try { return { key: await storeSecretServiceKey(paths, key), backend: 'secret-service' }; } catch { /* fall back below */ }
    }
    return { key: await writeFileMasterKey(paths, key), backend: 'file' };
  }
  throw new Error(`unsupported DSH secret key backend: ${backend}`);
}

async function masterKey() {
  const paths = secretStorePaths();
  const existing = await existingMasterKey(paths);
  if (existing) return existing.key;

  return withFileLock(paths.key_lock, async () => {
    const current = await existingMasterKey(paths);
    if (current) return current.key;

    if (await exists(paths.data)) {
      const error = new Error('DSH encrypted secret data exists but its master key is missing');
      error.code = 'DSH_SECRET_MASTER_KEY_MISSING';
      throw error;
    }

    await mkdir(paths.base, { recursive: true });
    return (await createMasterKey(paths, configuredBackend())).key;
  });
}

export async function secretStoreStatus() {
  const paths = secretStorePaths();
  const configured = configuredBackend();
  const marker = await readBackendMarker(paths);
  let active = marker?.backend || null;
  if (!active && await exists(paths.key)) active = 'file';
  return {
    configured_backend: configured,
    active_backend: active || 'uninitialized',
    native_backend: active === 'dpapi' || active === 'secret-service',
    encrypted_data_present: await exists(paths.data),
    legacy_file_key: active === 'file',
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
