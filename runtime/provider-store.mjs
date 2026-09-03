import { createHash, randomUUID } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { assertProviderAdapterId, assertProviderAdapterRelease, normalizeAdapterPath, PROVIDER_ADAPTER_CHANNELS } from './provider-adapter.mjs';
import { assertProviderAdapterRegistry } from './provider-adapter-registry.mjs';
import { lockOwnerAlive } from './file-lock.mjs';

const DEFAULT_PROVIDER_REGISTRY_URL = 'https://dsh-go.pages.dev/catalog/provider-adapters.json';
const MAX_REGISTRY_BYTES = 8 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
const MAX_ARCHIVE_FILES = 2048;
const LOCK_TIMEOUT_MS = 5000;
const LOCK_STALE_MS = 30000;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const INTEGRITY_RE = /^sha256-[0-9a-f]{64}$/i;
const RELEASE_ID_RE = /^[0-9a-f]{64}$/i;

function sha256Integrity(buffer) {
  return `sha256-${createHash('sha256').update(buffer).digest('hex')}`;
}

export function providerHome(options = {}) {
  return resolve(options.home || process.env.DSH_PROVIDER_HOME || join(homedir(), '.dsh', 'providers'));
}

function stateFile(home) {
  return join(home, 'state.json');
}

function lockFile(home) {
  return join(home, 'state.lock');
}

function normalizeState(data, home = null) {
  if (!data || typeof data !== 'object') return { schema_version: 1, updated_at: null, providers: [] };
  if (Number(data.schema_version || 1) !== 1) throw new Error(`unsupported provider adapter state schema: ${data.schema_version}`);
  const seen = new Set();
  const providers = (Array.isArray(data.providers) ? data.providers : []).map((item) => {
    const id = assertProviderAdapterId(item?.id);
    if (seen.has(id.toLowerCase())) throw new Error(`invalid or duplicate installed provider adapter: ${id}`);
    seen.add(id.toLowerCase());
    const activeVersion = item.active_version ? String(item.active_version) : null;
    if (activeVersion && !VERSION_RE.test(activeVersion)) throw new Error(`invalid active provider adapter version: ${id}@${activeVersion}`);
    const history = [...new Set((Array.isArray(item.history) ? item.history : []).map(String))].slice(-20);
    if (history.some((version) => !VERSION_RE.test(version))) throw new Error(`invalid provider adapter history: ${id}`);
    const installedSeen = new Set();
    const installed = (Array.isArray(item.installed) ? item.installed : []).map((release) => {
      const version = String(release.version || '');
      const releaseId = String(release.release_id || '');
      const integrity = String(release.artifact_integrity || '');
      const path = resolve(String(release.path || ''));
      if (!VERSION_RE.test(version) || installedSeen.has(version)) throw new Error(`invalid or duplicate installed provider adapter release: ${id}@${version}`);
      if (!RELEASE_ID_RE.test(releaseId) || !INTEGRITY_RE.test(integrity)) throw new Error(`invalid installed provider adapter evidence: ${id}@${version}`);
      if (home && path !== resolve(installedPath(home, { id, version }))) throw new Error(`provider adapter state path escapes version store: ${id}@${version}`);
      installedSeen.add(version);
      return {
        version,
        release_id: releaseId,
        artifact_integrity: integrity,
        path,
        installed_at: release.installed_at || null,
      };
    });
    if (activeVersion && !installedSeen.has(activeVersion)) throw new Error(`active provider adapter release is not installed: ${id}@${activeVersion}`);
    const channel = String(item.channel || 'stable').toLowerCase();
    if (!PROVIDER_ADAPTER_CHANNELS.includes(channel)) throw new Error(`invalid provider adapter channel: ${id}@${channel}`);
    return {
      id,
      active_version: activeVersion,
      channel,
      history,
      installed,
    };
  });
  return { schema_version: 1, updated_at: data.updated_at || null, providers };
}

export async function readProviderState(options = {}) {
  const home = providerHome(options);
  try {
    return normalizeState(JSON.parse(await readFile(stateFile(home), 'utf8')), home);
  } catch (error) {
    if (error?.code === 'ENOENT') return normalizeState(null);
    throw error;
  }
}

async function atomicWriteState(home, state) {
  await mkdir(home, { recursive: true });
  const file = stateFile(home);
  const temp = `${file}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  const next = { ...normalizeState(state, home), updated_at: new Date().toISOString() };
  try {
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temp, file);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    throw error;
  }
  return next;
}

async function acquireStateLock(home) {
  await mkdir(home, { recursive: true });
  const file = lockFile(home);
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  while (true) {
    try {
      const handle = await open(file, 'wx', 0o600);
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, created_at: new Date().toISOString() })}\n`);
      } catch (writeError) {
        await handle.close().catch(() => {});
        await rm(file, { force: true }).catch(() => {});
        throw writeError;
      }
      let released = false;
      return async () => {
        if (released) return;
        released = true;
        await handle.close().catch(() => {});
        await rm(file, { force: true }).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        const info = await stat(file);
        if (Date.now() - info.mtimeMs > LOCK_STALE_MS) {
          const ownerAlive = await lockOwnerAlive(file);
          if (ownerAlive === null) continue;
          if (ownerAlive === false) {
            await rm(file, { force: true });
            continue;
          }
        }
      } catch (statError) {
        if (statError?.code === 'ENOENT') continue;
        throw statError;
      }
      if (Date.now() >= deadline) {
        const busy = new Error('provider adapter state is busy');
        busy.code = 'DSH_PROVIDER_STATE_BUSY';
        throw busy;
      }
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
}

async function withStateLock(home, fn) {
  const release = await acquireStateLock(home);
  try {
    const state = await readProviderState({ home });
    return await fn(state);
  } finally {
    await release();
  }
}

function safeRemoteUrl(value) {
  const url = new URL(String(value || ''));
  if (url.username || url.password || url.hash) throw new Error('provider adapter URL must not contain credentials or fragments');
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !localHttp) throw new Error('provider adapter URL must use HTTPS');
  return url;
}

async function responseBuffer(response, maxBytes) {
  const length = Number(response.headers.get('content-length') || 0);
  if (length > maxBytes) throw new Error(`provider adapter download exceeds ${maxBytes} bytes`);
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.length;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error(`provider adapter download exceeds ${maxBytes} bytes`);
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    reader.releaseLock();
  }
}

async function readJsonSource(source, maxBytes = MAX_REGISTRY_BYTES) {
  if (/^https?:\/\//i.test(source)) {
    const url = safeRemoteUrl(source);
    const response = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`provider adapter registry HTTP ${response.status}`);
    const buffer = await responseBuffer(response, maxBytes);
    return JSON.parse(buffer.toString('utf8'));
  }
  return JSON.parse(await readFile(resolve(source), 'utf8'));
}

export async function loadProviderAdapterRegistry(source = '') {
  let selected = String(source || process.env.DSH_PROVIDER_REGISTRY || '').trim();
  if (!selected) {
    const local = fileURLToPath(new URL('../catalog/provider-adapters.json', import.meta.url));
    try {
      await access(local);
      selected = local;
    } catch {
      selected = DEFAULT_PROVIDER_REGISTRY_URL;
    }
  }
  return assertProviderAdapterRegistry(await readJsonSource(selected));
}

export async function downloadProviderAdapterArtifact(release) {
  const canonical = assertProviderAdapterRelease(release);
  if (!canonical.artifact.url) throw new Error(`provider adapter artifact URL is missing: ${canonical.id}@${canonical.version}`);
  const url = safeRemoteUrl(canonical.artifact.url);
  const response = await fetch(url, { headers: { Accept: 'application/octet-stream' }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`provider adapter artifact HTTP ${response.status}`);
  return responseBuffer(response, MAX_ARCHIVE_BYTES);
}

function tarString(buffer, offset, length) {
  const end = buffer.indexOf(0, offset);
  const limit = end >= offset && end < offset + length ? end : offset + length;
  return buffer.subarray(offset, limit).toString('utf8');
}

function tarOctal(buffer, offset, length) {
  const raw = tarString(buffer, offset, length).trim().replace(/\0/g, '');
  if (!raw) return 0;
  if (!/^[0-7]+$/.test(raw)) throw new Error(`invalid provider adapter tar numeric field: ${raw}`);
  const value = Number.parseInt(raw, 8);
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`invalid provider adapter tar numeric field: ${raw}`);
  return value;
}

function targetWithin(root, file) {
  return file === root || file.startsWith(`${root}${sep}`);
}

export async function extractProviderAdapterArchive(archive, destination) {
  let tar;
  try {
    tar = gunzipSync(archive, { maxOutputLength: MAX_UNPACKED_BYTES + 1024 * 1024 });
  } catch (error) {
    throw new Error(`invalid provider adapter gzip archive: ${error.message}`);
  }
  const root = resolve(destination);
  await mkdir(root, { recursive: true });
  let offset = 0;
  let files = 0;
  let unpacked = 0;
  let terminated = false;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) {
      terminated = true;
      offset += 512;
      break;
    }
    const name = tarString(header, 0, 100);
    const prefix = tarString(header, 345, 155);
    const rawPath = `${prefix ? `${prefix}/` : ''}${name}`;
    const type = String.fromCharCode(header[156] || 48);
    const size = tarOctal(header, 124, 12);
    const mode = tarOctal(header, 100, 8);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    const nextOffset = dataStart + Math.ceil(size / 512) * 512;
    if (dataEnd > tar.length || nextOffset > tar.length) throw new Error(`truncated provider adapter tar entry: ${rawPath}`);
    const normalizedRaw = type === '5' ? rawPath.replace(/\/+$/, '') : rawPath;
    const safePath = normalizeAdapterPath(normalizedRaw);
    const target = resolve(root, safePath.split('/').join(sep));
    if (!targetWithin(root, target)) throw new Error(`provider adapter archive path escapes destination: ${safePath}`);
    if (type === '5') {
      await mkdir(target, { recursive: true });
    } else if (type === '0' || type === '\0') {
      files += 1;
      unpacked += size;
      if (files > MAX_ARCHIVE_FILES) throw new Error(`provider adapter archive exceeds ${MAX_ARCHIVE_FILES} files`);
      if (unpacked > MAX_UNPACKED_BYTES) throw new Error(`provider adapter archive exceeds ${MAX_UNPACKED_BYTES} unpacked bytes`);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, tar.subarray(dataStart, dataEnd), { mode: mode & 0o111 ? 0o755 : 0o644 });
    } else {
      throw new Error(`unsupported provider adapter tar entry type ${JSON.stringify(type)} for ${safePath}`);
    }
    offset = nextOffset;
  }
  if (!terminated) throw new Error('provider adapter tar archive is missing its end-of-archive marker');
  if (tar.subarray(offset).some((byte) => byte !== 0)) throw new Error('provider adapter tar archive has non-zero trailing data');
  return { files, unpacked_bytes: unpacked };
}

async function readInstallLock(target) {
  return JSON.parse(await readFile(join(target, '.dsh-provider-install.json'), 'utf8'));
}

function installedPath(home, release) {
  return join(home, 'versions', release.id, release.version);
}

function findStateProvider(state, id) {
  return state.providers.find((item) => item.id.toLowerCase() === String(id).toLowerCase()) || null;
}

function activateStateRelease(state, release, target, channel) {
  let provider = findStateProvider(state, release.id);
  if (!provider) {
    provider = { id: release.id, active_version: null, channel, history: [], installed: [] };
    state.providers.push(provider);
  }
  const existing = provider.installed.find((item) => item.version === release.version);
  if (existing && existing.release_id !== release.release_id) {
    const error = new Error(`installed provider adapter version is immutable: ${release.id}@${release.version}`);
    error.code = 'DSH_PROVIDER_RELEASE_IMMUTABLE';
    throw error;
  }
  if (!existing) {
    provider.installed.push({
      version: release.version,
      release_id: release.release_id,
      artifact_integrity: release.artifact.integrity,
      path: target,
      installed_at: new Date().toISOString(),
    });
  }
  if (provider.active_version && provider.active_version !== release.version) {
    provider.history = provider.history.filter((version) => version !== provider.active_version);
    provider.history.push(provider.active_version);
    provider.history = provider.history.slice(-20);
  }
  provider.active_version = release.version;
  provider.channel = channel || release.release.channel || 'stable';
  return provider;
}

export async function installProviderAdapterRelease(releaseInput, options = {}) {
  const release = assertProviderAdapterRelease(releaseInput);
  const home = providerHome(options);
  const archive = options.archiveBuffer ? Buffer.from(options.archiveBuffer) : await downloadProviderAdapterArtifact(release);
  if (archive.length > MAX_ARCHIVE_BYTES) throw new Error(`provider adapter archive exceeds ${MAX_ARCHIVE_BYTES} bytes`);
  const actualIntegrity = sha256Integrity(archive);
  if (actualIntegrity !== release.artifact.integrity) {
    const error = new Error(`provider adapter artifact checksum mismatch: expected ${release.artifact.integrity}, got ${actualIntegrity}`);
    error.code = 'DSH_PROVIDER_ARTIFACT_INTEGRITY';
    throw error;
  }

  const target = installedPath(home, release);
  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  let extraction;
  try {
    extraction = await extractProviderAdapterArchive(archive, temp);
    const entrypoint = join(temp, ...release.entrypoint.split('/'));
    try {
      const info = await stat(entrypoint);
      if (!info.isFile()) throw new Error('entrypoint is not a file');
    } catch (error) {
      throw new Error(`provider adapter entrypoint is missing after extraction: ${release.entrypoint} (${error.message})`);
    }
    await writeFile(join(temp, '.dsh-provider-install.json'), `${JSON.stringify({
      schema_version: 1,
      id: release.id,
      version: release.version,
      release_id: release.release_id,
      artifact: release.artifact,
      source: release.source,
      manifest_hash: release.manifest_hash,
      entrypoint: release.entrypoint,
      installed_at: new Date().toISOString(),
    }, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });

    return await withStateLock(home, async (state) => {
      let reused = false;
      try {
        const existing = await readInstallLock(target);
        if (existing.release_id !== release.release_id) {
          const error = new Error(`installed provider adapter version is immutable: ${release.id}@${release.version}`);
          error.code = 'DSH_PROVIDER_RELEASE_IMMUTABLE';
          throw error;
        }
        reused = true;
        await rm(temp, { recursive: true, force: true });
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
        await rename(temp, target);
      }

      try {
        const provider = activateStateRelease(state, release, target, options.channel);
        const nextState = await atomicWriteState(home, state);
        return {
          id: release.id,
          version: release.version,
          channel: provider.channel,
          active: true,
          reused,
          path: target,
          release_id: release.release_id,
          artifact_integrity: release.artifact.integrity,
          extraction,
          restart_required: true,
          state_updated_at: nextState.updated_at,
        };
      } catch (error) {
        // A new version must not become an untracked directory if the state
        // commit fails after the atomic target rename.
        if (!reused) await rm(target, { recursive: true, force: true }).catch(() => {});
        throw error;
      }
    });
  } finally {
    // Covers extraction, manifest validation, state commit, and immutable
    // release failures. Successful installs have already renamed or removed
    // this staging directory, so the cleanup is harmless.
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function rollbackInstalledProviderAdapter(id, version = null, options = {}) {
  const home = providerHome(options);
  return withStateLock(home, async (state) => {
    const provider = findStateProvider(state, id);
    if (!provider) throw new Error(`provider adapter is not installed: ${id}`);
    const from = provider.active_version;
    const target = version ? String(version) : provider.history.at(-1);
    if (!target) throw new Error(`provider adapter has no rollback target: ${id}`);
    const installed = provider.installed.find((item) => item.version === target);
    if (!installed) throw new Error(`provider adapter rollback target is not installed: ${id}@${target}`);
    await access(installed.path);
    const lock = await readInstallLock(installed.path);
    if (lock.id !== provider.id || lock.version !== installed.version || lock.release_id !== installed.release_id || lock.artifact?.integrity !== installed.artifact_integrity) {
      const error = new Error(`provider adapter rollback target identity mismatch: ${id}@${target}`);
      error.code = 'DSH_PROVIDER_STATE_CORRUPT';
      throw error;
    }
    if (target === from) return { id: provider.id, from, to: target, changed: false, restart_required: false };
    provider.history = provider.history.filter((item) => item !== target && item !== from);
    if (from) provider.history.push(from);
    provider.history = provider.history.slice(-20);
    provider.active_version = target;
    await atomicWriteState(home, state);
    return { id: provider.id, from, to: target, changed: true, restart_required: true };
  });
}

export async function providerAdapterStatus(id, options = {}) {
  const state = await readProviderState(options);
  const provider = findStateProvider(state, id);
  if (!provider) return { id, installed: false, active_version: null };
  const active = provider.installed.find((item) => item.version === provider.active_version) || null;
  let healthy = false;
  if (active) {
    try {
      const lock = await readInstallLock(active.path);
      healthy = lock.id === provider.id
        && lock.version === active.version
        && lock.release_id === active.release_id
        && lock.artifact?.integrity === active.artifact_integrity;
    } catch {
      healthy = false;
    }
  }
  return { ...provider, installed: true, active, healthy };
}

export async function listInstalledProviderAdapters(options = {}) {
  const state = await readProviderState(options);
  return Promise.all(state.providers.map((provider) => providerAdapterStatus(provider.id, options)));
}
