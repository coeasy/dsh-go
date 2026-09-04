import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const DIGEST_RE = /^[0-9a-f]{64}$/;
const DEFAULT_IGNORES = new Set(['.dsh-install.json']);

export function casStoreRoot() {
  return resolve(process.env.DSH_STORE_HOME || join(homedir(), '.dsh', 'store', 'sha256'));
}

export function casBlobRoot() {
  return resolve(process.env.DSH_BLOB_STORE_HOME || join(homedir(), '.dsh', 'store', 'blobs', 'sha256'));
}

export function casSnapshotPath(digest, root = casStoreRoot()) {
  const normalized = String(digest || '').toLowerCase();
  if (!DIGEST_RE.test(normalized)) throw new Error(`invalid CAS digest: ${digest}`);
  return join(resolve(root), normalized);
}

export function casBlobPath(digest, root = casBlobRoot()) {
  const normalized = String(digest || '').toLowerCase();
  if (!DIGEST_RE.test(normalized)) throw new Error(`invalid CAS digest: ${digest}`);
  return join(resolve(root), normalized);
}

function portablePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

function ignoreEntry(relativePath, options = {}) {
  const base = relativePath.split('/').at(-1);
  const ignores = new Set([...DEFAULT_IGNORES, ...(options.ignore || [])]);
  if (ignores.has(relativePath) || ignores.has(base)) return true;
  if (base.endsWith('.lock') && base.includes('index')) return true;
  return false;
}

async function walk(root, current, entries, options = {}) {
  const items = await readdir(current, { withFileTypes: true });
  items.sort((left, right) => left.name.localeCompare(right.name));
  for (const item of items) {
    const file = join(current, item.name);
    const path = portablePath(root, file);
    if (ignoreEntry(path, options)) continue;
    if (item.isDirectory()) {
      entries.push({ kind: 'dir', path });
      await walk(root, file, entries, options);
      continue;
    }
    if (item.isSymbolicLink()) {
      entries.push({ kind: 'symlink', path, target: await readlink(file) });
      continue;
    }
    if (item.isFile()) entries.push({ kind: 'file', path, file });
  }
}

export async function hashDirectory(directory, options = {}) {
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error(`CAS source is not a directory: ${root}`);
  const entries = [];
  await walk(root, root, entries, options);
  const hash = createHash('sha256');
  hash.update('dsh-cas-directory-v1\0');
  for (const entry of entries) {
    hash.update(entry.kind);
    hash.update('\0');
    hash.update(entry.path);
    hash.update('\0');
    if (entry.kind === 'symlink') {
      hash.update(entry.target);
      hash.update('\0');
    } else if (entry.kind === 'file') {
      const content = await readFile(entry.file);
      hash.update(String(content.byteLength));
      hash.update('\0');
      hash.update(content);
      hash.update('\0');
    }
  }
  return { algorithm: 'sha256', digest: hash.digest('hex'), entries: entries.length };
}

export async function hasCasSnapshot(digest, options = {}) {
  const verified = await verifyCasSnapshot(digest, options);
  return verified.ok;
}

export async function verifyCasSnapshot(digest, options = {}) {
  const path = casSnapshotPath(digest, options.root);
  try {
    const actual = await hashDirectory(path, options);
    return {
      ok: actual.digest === String(digest).toLowerCase(),
      digest: String(digest).toLowerCase(),
      actual_digest: actual.digest,
      entries: actual.entries,
      path,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, digest: String(digest).toLowerCase(), actual_digest: null, entries: 0, path, missing: true };
    throw error;
  }
}

export async function snapshotDirectory(directory, options = {}) {
  const source = resolve(directory);
  const hashed = await hashDirectory(source, options);
  const root = resolve(options.root || casStoreRoot());
  const target = casSnapshotPath(hashed.digest, root);
  await mkdir(root, { recursive: true });
  const existing = await verifyCasSnapshot(hashed.digest, { ...options, root });
  if (existing.ok) return { ...hashed, path: target, cache_hit: true };
  if (!existing.missing) await rm(target, { recursive: true, force: true });

  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(dirname(temp), { recursive: true });
  try {
    await cp(source, temp, {
      recursive: true,
      force: true,
      dereference: false,
      preserveTimestamps: false,
      filter: async (sourcePath) => {
        const absolute = resolve(sourcePath);
        if (absolute === source) return true;
        return !ignoreEntry(portablePath(source, absolute), options);
      },
    });
    const copied = await hashDirectory(temp, options);
    if (copied.digest !== hashed.digest) {
      throw new Error(`CAS snapshot digest changed during copy: expected ${hashed.digest}, got ${copied.digest}`);
    }
    try {
      await rename(temp, target);
    } catch (error) {
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
      const raced = await verifyCasSnapshot(hashed.digest, { ...options, root });
      if (!raced.ok) throw new Error(`CAS snapshot race produced invalid digest: ${hashed.digest}`);
    }
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
  return { ...hashed, path: target, cache_hit: false };
}

export const putDirectory = snapshotDirectory;

export async function copyCasSnapshot(digest, destination, options = {}) {
  const verified = await verifyCasSnapshot(digest, options);
  if (!verified.ok) throw new Error(`CAS snapshot is missing or corrupt: ${digest}`);
  const target = resolve(destination);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  try {
    await cp(verified.path, target, { recursive: true, force: true, dereference: false, preserveTimestamps: false });
    const copied = await hashDirectory(target, options);
    if (copied.digest !== String(digest).toLowerCase()) {
      throw new Error(`restored CAS snapshot digest mismatch: expected ${digest}, got ${copied.digest}`);
    }
    return { digest: copied.digest, path: target, entries: copied.entries };
  } catch (error) {
    await rm(target, { recursive: true, force: true }).catch((cleanupError) => {
      error.filesystem_cleanup_error = cleanupError.message;
      error.recovery_required = true;
    });
    throw error;
  }
}

export const materializeCasSnapshot = copyCasSnapshot;

export async function putFile(file, options = {}) {
  const source = resolve(file);
  const content = await readFile(source);
  const digest = createHash('sha256').update(content).digest('hex');
  const root = resolve(options.root || casBlobRoot());
  const target = casBlobPath(digest, root);
  await mkdir(root, { recursive: true });
  try {
    const existing = await readFile(target);
    if (createHash('sha256').update(existing).digest('hex') === digest) return { algorithm: 'sha256', digest, path: target, bytes: content.byteLength, cache_hit: true };
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const temp = `${target}.tmp-${process.pid}-${Date.now()}-${randomUUID()}`;
  try {
    await writeFile(temp, content, { mode: 0o600 });
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => {});
    if (error?.code !== 'EEXIST') throw error;
  }
  return { algorithm: 'sha256', digest, path: target, bytes: content.byteLength, cache_hit: false };
}

export async function verifyCasBlob(digest, options = {}) {
  const path = casBlobPath(digest, options.root);
  try {
    const content = await readFile(path);
    const actual = createHash('sha256').update(content).digest('hex');
    return { ok: actual === String(digest).toLowerCase(), digest: String(digest).toLowerCase(), actual_digest: actual, bytes: content.byteLength, path };
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: false, missing: true, digest: String(digest).toLowerCase(), actual_digest: null, bytes: 0, path };
    throw error;
  }
}

export async function gcCasStore(options = {}) {
  const root = resolve(options.root || casStoreRoot());
  const keep = new Set([...(options.keep || [])].map((value) => String(value).toLowerCase()).filter((value) => DIGEST_RE.test(value)));
  let entries = [];
  try { entries = await readdir(root, { withFileTypes: true }); }
  catch (error) { if (error?.code === 'ENOENT') return { removed: [], kept: [] }; throw error; }
  const removed = [];
  const kept = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !DIGEST_RE.test(entry.name)) continue;
    if (keep.has(entry.name)) { kept.push(entry.name); continue; }
    if (options.dryRun === true) { removed.push(entry.name); continue; }
    await rm(join(root, entry.name), { recursive: true, force: true });
    removed.push(entry.name);
  }
  return { removed: removed.sort(), kept: kept.sort(), dry_run: options.dryRun === true };
}
