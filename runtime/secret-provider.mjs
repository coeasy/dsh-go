import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { access, chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export const SECRET_KEY_BACKENDS = Object.freeze(['auto', 'file', 'dpapi', 'secret-service']);
const BACKENDS = new Set(SECRET_KEY_BACKENDS);
const COMMAND_TIMEOUT_MS = 5_000;
const nativeMasterKeyCache = new Map();

function commandEnv(platform = process.platform) {
  const keys = platform === 'win32'
    ? ['PATH', 'Path', 'PATHEXT', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'TEMP', 'TMP']
    : ['PATH', 'HOME', 'USER', 'LOGNAME', 'LANG', 'LC_ALL', 'TMPDIR', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
  return Object.fromEntries(keys.filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]));
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

export function runSecretBackendCommand(command, args, input = '', options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: options.env || commandEnv(options.platform || process.platform),
    });
    const stdout = [];
    const stderr = [];
    let settled = false;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(() => {
        const error = new Error(`${command} timed out`);
        error.code = 'DSH_SECRET_BACKEND_TIMEOUT';
        reject(error);
      });
    }, Math.max(1, Number(options.timeoutMs) || COMMAND_TIMEOUT_MS));

    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)));
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)));
    child.once('error', (cause) => finish(() => {
      const error = new Error(`secret backend command unavailable: ${command}`);
      error.code = 'DSH_SECRET_BACKEND_UNAVAILABLE';
      error.command = command;
      error.cause = cause;
      reject(error);
    }));
    child.once('close', (code) => finish(() => {
      if (code === 0) {
        resolvePromise(Buffer.concat(stdout).toString('utf8'));
        return;
      }
      const detail = Buffer.concat(stderr).toString('utf8').trim();
      const error = new Error(`${command} exited with code ${code}${detail ? `: ${detail}` : ''}`);
      error.code = 'DSH_SECRET_BACKEND_UNAVAILABLE';
      error.command = command;
      reject(error);
    }));
    child.stdin.end(input);
  });
}

export function configuredSecretKeyBackend(env = process.env) {
  const backend = String(env.DSH_SECRET_KEY_BACKEND || 'auto').trim().toLowerCase();
  if (!BACKENDS.has(backend)) throw new Error(`unsupported DSH secret key backend: ${backend}`);
  return backend;
}

export function preferredSecretKeyBackend(platform = process.platform) {
  if (platform === 'win32') return 'dpapi';
  if (platform === 'linux') return 'secret-service';
  return 'file';
}

function decodeKey(raw) {
  const key = Buffer.from(String(raw || '').trim(), 'base64');
  if (key.byteLength !== 32) throw new Error('invalid DSH secret master key');
  return key;
}

export async function readSecretBackendMarker(paths) {
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

function nativeCacheKey(paths, backend) {
  return `${backend}:${paths.base}`;
}

function cacheNativeKey(paths, backend, key) {
  if (backend === 'dpapi' || backend === 'secret-service') {
    nativeMasterKeyCache.set(nativeCacheKey(paths, backend), key);
  }
  return key;
}

function cachedNativeKey(paths, backend) {
  return nativeMasterKeyCache.get(nativeCacheKey(paths, backend)) || null;
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

async function storeDpapiKey(paths, key, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') throw new Error('DPAPI secret backend is only available on Windows');
  const run = options.runCommand || runSecretBackendCommand;
  const wrapped = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_PROTECT_SCRIPT], `${key.toString('base64')}\n`, { ...options, platform });
  await atomicWrite(paths.dpapi, `${wrapped.trim()}\n`);
  await writeBackendMarker(paths, { backend: 'dpapi' });
  return key;
}

async function readDpapiKey(paths, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'win32') throw new Error('DPAPI secret backend is only available on Windows');
  const run = options.runCommand || runSecretBackendCommand;
  const wrapped = await readFile(paths.dpapi, 'utf8');
  const plain = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', DPAPI_UNPROTECT_SCRIPT], wrapped, { ...options, platform });
  return decodeKey(plain);
}

function secretServiceKeyId(paths) {
  return createHash('sha256').update(paths.base).digest('hex').slice(0, 32);
}

async function storeSecretServiceKey(paths, key, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'linux') throw new Error('Secret Service backend is only available on Linux');
  const run = options.runCommand || runSecretBackendCommand;
  const keyId = secretServiceKeyId(paths);
  await run(
    'secret-tool',
    ['store', '--label=DSH secret master key', 'application', 'dsh-go', 'store', keyId],
    `${key.toString('base64')}\n`,
    { ...options, platform },
  );
  await writeBackendMarker(paths, { backend: 'secret-service', key_id: keyId });
  return key;
}

async function readSecretServiceKey(paths, marker, options = {}) {
  const platform = options.platform || process.platform;
  if (platform !== 'linux') throw new Error('Secret Service backend is only available on Linux');
  const run = options.runCommand || runSecretBackendCommand;
  const keyId = marker.key_id || secretServiceKeyId(paths);
  const raw = await run('secret-tool', ['lookup', 'application', 'dsh-go', 'store', keyId], '', { ...options, platform });
  return decodeKey(raw);
}

export async function readExistingSecretMasterKey(paths, options = {}) {
  const marker = await readSecretBackendMarker(paths);
  if (marker) {
    const cached = cachedNativeKey(paths, marker.backend);
    if (cached) return { key: cached, backend: marker.backend, marker };
    const key = marker.backend === 'dpapi'
      ? await readDpapiKey(paths, options)
      : await readSecretServiceKey(paths, marker, options);
    return { key: cacheNativeKey(paths, marker.backend, key), backend: marker.backend, marker };
  }

  try {
    const key = decodeKey(await readFile(paths.key, 'utf8'));
    return { key, backend: 'file', marker: null };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return null;
  }
}

async function storeFileKey(paths, key) {
  await atomicWrite(paths.key, `${key.toString('base64')}\n`);
  return key;
}

async function createWithBackend(paths, backend, key, options = {}) {
  if (backend === 'file') return { key: await storeFileKey(paths, key), backend: 'file', fallback_from: null };
  if (backend === 'dpapi') return { key: await storeDpapiKey(paths, key, options), backend: 'dpapi', fallback_from: null };
  if (backend === 'secret-service') return { key: await storeSecretServiceKey(paths, key, options), backend: 'secret-service', fallback_from: null };
  throw new Error(`unsupported DSH secret key backend: ${backend}`);
}

export async function createSecretMasterKey(paths, configured = configuredSecretKeyBackend(), options = {}) {
  const key = randomBytes(32);
  if (configured !== 'auto') return createWithBackend(paths, configured, key, options);

  const platform = options.platform || process.platform;
  const preferred = preferredSecretKeyBackend(platform);
  if (preferred === 'file') return createWithBackend(paths, 'file', key, options);

  try {
    return await createWithBackend(paths, preferred, key, options);
  } catch (error) {
    if (platform !== 'linux' || preferred !== 'secret-service') throw error;
    if (!['DSH_SECRET_BACKEND_UNAVAILABLE', 'DSH_SECRET_BACKEND_TIMEOUT'].includes(error?.code)) throw error;
    const fallback = await createWithBackend(paths, 'file', key, options);
    return { ...fallback, fallback_from: 'secret-service' };
  }
}

export async function secretProviderStatus(paths, configured = configuredSecretKeyBackend(), options = {}) {
  const marker = await readSecretBackendMarker(paths);
  let active = marker?.backend || null;
  if (!active && await exists(paths.key)) active = 'file';
  const platform = options.platform || process.platform;
  const preferred = preferredSecretKeyBackend(platform);
  return {
    configured_backend: configured,
    active_backend: active || 'uninitialized',
    preferred_new_backend: configured === 'auto' ? preferred : configured,
    native_backend: active === 'dpapi' || active === 'secret-service',
    native_backend_available: preferred === 'file' ? null : preferred,
    existing_key_preserved: active !== null,
    automatic_migration: false,
    migration_recommended: active === 'file' && preferred !== 'file',
    legacy_file_key: active === 'file',
  };
}
