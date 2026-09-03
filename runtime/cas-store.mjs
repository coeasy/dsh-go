import { createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, readlink, rename, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { homedir } from 'node:os';

const DIGEST_RE = /^[0-9a-f]{64}$/;

export function casStoreRoot() {
  return resolve(process.env.DSH_STORE_HOME || join(homedir(), '.dsh', 'store', 'sha256'));
}

export function casSnapshotPath(digest, root = casStoreRoot()) {
  const normalized = String(digest || '').toLowerCase();
  if (!DIGEST_RE.test(normalized)) throw new Error(`invalid CAS digest: ${digest}`);
  return join(resolve(root), normalized);
}

function portablePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

async function walk(root, current, entries) {
  const items = await readdir(current, { withFileTypes: true });
  items.sort((left, right) => left.name.localeCompare(right.name));
  for (const item of items) {
    if (item.name.endsWith('.lock') && item.name.includes('index')) continue;
    const file = join(current, item.name);
    const path = portablePath(root, file);
    if (item.isDirectory()) {
      entries.push({ kind: 'dir', path });
      await walk(root, file, entries);
      continue;
    }
    if (item.isSymbolicLink()) {
      entries.push({ kind: 'symlink', path, target: await readlink(file) });
      continue;
    }
    if (item.isFile()) entries.push({ kind: 'file', path, file });
  }
}

export async function hashDirectory(directory) {
  const root = resolve(directory);
  const info = await lstat(root);
  if (!info.isDirectory()) throw new Error(`CAS source is not a directory: ${root}`);
  const entries = [];
  await walk(root, root, entries);
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

export async function verifyCasSnapshot(digest, options = {}) {
  const path = casSnapshotPath(digest, options.root);
  try {
    const actual = await hashDirectory(path);
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
  const hashed = await hashDirectory(source);
  const root = resolve(options.root || casStoreRoot());
  const target = casSnapshotPath(hashed.digest, root);
  await mkdir(root, { recursive: true });
  const existing = await verifyCasSnapshot(hashed.digest, { root });
  if (existing.ok) return { ...hashed, path: target, cache_hit: true };
  if (!existing.missing) await rm(target, { recursive: true, force: true });

  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await rm(temp, { recursive: true, force: true });
  await mkdir(dirname(temp), { recursive: true });
  await cp(source, temp, { recursive: true, force: true, dereference: false, preserveTimestamps: false });
  const copied = await hashDirectory(temp);
  if (copied.digest !== hashed.digest) {
    await rm(temp, { recursive: true, force: true });
    throw new Error(`CAS snapshot digest changed during copy: expected ${hashed.digest}, got ${copied.digest}`);
  }
  try {
    await rename(temp, target);
  } catch (error) {
    if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
    await rm(temp, { recursive: true, force: true });
    const raced = await verifyCasSnapshot(hashed.digest, { root });
    if (!raced.ok) throw new Error(`CAS snapshot race produced invalid digest: ${hashed.digest}`);
  }
  return { ...hashed, path: target, cache_hit: false };
}

export async function copyCasSnapshot(digest, destination, options = {}) {
  const verified = await verifyCasSnapshot(digest, options);
  if (!verified.ok) throw new Error(`CAS snapshot is missing or corrupt: ${digest}`);
  const target = resolve(destination);
  await rm(target, { recursive: true, force: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(verified.path, target, { recursive: true, force: true, dereference: false, preserveTimestamps: false });
  const copied = await hashDirectory(target);
  if (copied.digest !== String(digest).toLowerCase()) {
    await rm(target, { recursive: true, force: true });
    throw new Error(`restored CAS snapshot digest mismatch: expected ${digest}, got ${copied.digest}`);
  }
  return { digest: copied.digest, path: target, entries: copied.entries };
}
