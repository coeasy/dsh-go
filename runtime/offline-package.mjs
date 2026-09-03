import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, readlink, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { hashDirectory, snapshotDirectory } from './cas-store.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { packageKey, parsePackageRequest } from './package-model.mjs';
import {
  getRuntimePackage,
  packagePath,
  pathExists,
  readRuntimeRegistry,
  runtimeRoot,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from './registry.mjs';
import { readInstallLock } from './verifier.mjs';

export const OFFLINE_PACKAGE_SCHEMA_VERSION = 1;
export const OFFLINE_PACKAGE_FORMAT = 'dshpkg';

function portablePath(root, file) {
  return relative(root, file).split(sep).join('/');
}

function safeBundlePath(value) {
  const raw = String(value || '').replaceAll('\\', '/');
  if (!raw || isAbsolute(raw) || raw.startsWith('/') || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    const error = new Error(`unsafe dshpkg path: ${value}`);
    error.code = 'DSH_OFFLINE_PACKAGE_INVALID';
    throw error;
  }
  return raw;
}

async function collectEntries(root, current, output) {
  const items = await readdir(current, { withFileTypes: true });
  items.sort((left, right) => left.name.localeCompare(right.name));
  for (const item of items) {
    const file = join(current, item.name);
    const path = safeBundlePath(portablePath(root, file));
    const info = await lstat(file);
    if (item.isDirectory()) {
      output.push({ path, kind: 'dir', mode: info.mode & 0o777 });
      await collectEntries(root, file, output);
    } else if (item.isSymbolicLink()) {
      output.push({ path, kind: 'symlink', target: await readlink(file), mode: info.mode & 0o777 });
    } else if (item.isFile()) {
      output.push({ path, kind: 'file', data: (await readFile(file)).toString('base64'), mode: info.mode & 0o777 });
    }
  }
}

async function serializeDirectory(directory) {
  const root = resolve(directory);
  const entries = [];
  await collectEntries(root, root, entries);
  return entries;
}

function canonicalBundle(bundle) {
  return {
    format: OFFLINE_PACKAGE_FORMAT,
    schema_version: OFFLINE_PACKAGE_SCHEMA_VERSION,
    created_at: bundle.created_at,
    package: bundle.package,
    content: bundle.content,
    entries: bundle.entries,
  };
}

export function offlineBundleHash(bundle) {
  return createHash('sha256').update(JSON.stringify(canonicalBundle(bundle))).digest('hex');
}

async function writeAtomic(file, text) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, text, 'utf8');
  await rename(temp, target);
}

function identityMatches(item, lock) {
  return lock.type === item.type
    && lock.id === item.id
    && lock.version === item.version
    && String(lock.source?.commit || '').toLowerCase() === String(item.source?.commit || '').toLowerCase();
}

export async function exportOfflinePackage(rawSpec, options = {}) {
  const request = parsePackageRequest(rawSpec, { defaultType: options.type || 'plugin', defaultVersion: '*', channel: 'stable' });
  const runtime = await readRuntimeRegistry(options.registryFile);
  const record = getRuntimePackage(runtime, request.type, request.id, { includeRemoved: true });
  if (!record || record.state === 'removed') {
    const error = new Error(`runtime package is not installed: ${packageKey(request.type, request.id)}`);
    error.code = 'DSH_PACKAGE_NOT_INSTALLED';
    throw error;
  }
  const target = record.path || packagePath(request.type, request.id, options.root);
  if (!await pathExists(target)) throw new Error(`runtime package path is missing: ${target}`);
  const installLock = await readInstallLock(target);
  if (!identityMatches({ type: request.type, id: request.id, version: record.version, source: { commit: record.commit || installLock.source.commit } }, installLock)) {
    const error = new Error(`runtime/install lock identity mismatch: ${packageKey(request.type, request.id)}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  const content = await hashDirectory(target);
  const entries = await serializeDirectory(target);
  const bundle = {
    format: OFFLINE_PACKAGE_FORMAT,
    schema_version: OFFLINE_PACKAGE_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    package: installLock,
    content: { algorithm: 'sha256', digest: content.digest, entries: content.entries },
    entries,
  };
  bundle.bundle_hash = offlineBundleHash(bundle);
  const output = resolve(options.output || `${installLock.id}-${installLock.version}.dshpkg`);
  await writeAtomic(output, `${JSON.stringify(bundle)}\n`);
  return {
    output,
    key: packageKey(installLock.type, installLock.id),
    version: installLock.version,
    commit: installLock.source.commit,
    content_digest: content.digest,
    bundle_hash: bundle.bundle_hash,
    entries: entries.length,
    offline_safe: true,
  };
}

export async function readOfflinePackage(file) {
  const target = resolve(file);
  const bundle = JSON.parse(await readFile(target, 'utf8'));
  if (bundle?.format !== OFFLINE_PACKAGE_FORMAT || bundle?.schema_version !== OFFLINE_PACKAGE_SCHEMA_VERSION || !Array.isArray(bundle?.entries)) {
    const error = new Error(`unsupported or invalid dshpkg: ${target}`);
    error.code = 'DSH_OFFLINE_PACKAGE_INVALID';
    throw error;
  }
  const actual = offlineBundleHash(bundle);
  if (actual !== bundle.bundle_hash) {
    const error = new Error(`dshpkg bundle hash mismatch: expected ${bundle.bundle_hash}, calculated ${actual}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  const seen = new Set();
  for (const entry of bundle.entries) {
    const path = safeBundlePath(entry.path);
    if (seen.has(path)) throw new Error(`duplicate dshpkg path: ${path}`);
    seen.add(path);
    if (!['dir', 'file', 'symlink'].includes(entry.kind)) throw new Error(`invalid dshpkg entry kind: ${entry.kind}`);
    if (entry.kind === 'file' && typeof entry.data !== 'string') throw new Error(`dshpkg file entry has no data: ${path}`);
    if (entry.kind === 'symlink' && typeof entry.target !== 'string') throw new Error(`dshpkg symlink entry has no target: ${path}`);
  }
  const packageLock = bundle.package;
  if (!packageLock?.type || !packageLock?.id || !packageLock?.version || !packageLock?.source?.commit || !bundle.content?.digest) {
    throw new Error('dshpkg package identity is incomplete');
  }
  return { file: target, bundle };
}

async function extractBundle(bundle, directory) {
  const root = resolve(directory);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  const dirs = bundle.entries.filter((entry) => entry.kind === 'dir').sort((a, b) => a.path.split('/').length - b.path.split('/').length);
  for (const entry of dirs) {
    const target = join(root, ...safeBundlePath(entry.path).split('/'));
    await mkdir(target, { recursive: true });
    if (process.platform !== 'win32' && Number.isInteger(entry.mode)) await chmod(target, entry.mode);
  }
  for (const entry of bundle.entries.filter((value) => value.kind !== 'dir')) {
    const target = join(root, ...safeBundlePath(entry.path).split('/'));
    await mkdir(dirname(target), { recursive: true });
    if (entry.kind === 'file') {
      await writeFile(target, Buffer.from(entry.data, 'base64'));
      if (process.platform !== 'win32' && Number.isInteger(entry.mode)) await chmod(target, entry.mode);
    } else {
      try {
        await symlink(entry.target, target);
      } catch (error) {
        error.code ||= 'DSH_OFFLINE_SYMLINK_UNSUPPORTED';
        throw error;
      }
    }
  }
  const digest = await hashDirectory(root);
  if (digest.digest !== bundle.content.digest) {
    const error = new Error(`dshpkg content digest mismatch: expected ${bundle.content.digest}, got ${digest.digest}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  const lock = await readInstallLock(root);
  if (!identityMatches(bundle.package, lock)) {
    const error = new Error(`dshpkg install identity mismatch: ${packageKey(bundle.package.type, bundle.package.id)}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  return { digest, lock };
}

function offlineRuntimeRecord(item, target, previous, transactionId, digest) {
  return recordRuntimeEvent({
    ...(previous || {}),
    id: item.id,
    type: item.type,
    version: item.version,
    channel: item.channel || 'stable',
    state: 'pending-restart',
    path: target,
    source: item.source,
    commit: item.source.commit,
    runtime: item.runtime || {},
    capabilities: item.capabilities || [],
    dependencies: item.dependencies || [],
    permissions: item.permissions || [],
    permission_policy: item.permission_policy || null,
    permission_manifest: item.permission_manifest || null,
    compatibility: item.compatibility || {},
    publisher: item.publisher || null,
    security: item.security || null,
    conflicts: item.conflicts || [],
    replaces: item.replaces || [],
    provides: item.provides || [],
    type_config: item.type_config || null,
    installed_at: item.installed_at || new Date().toISOString(),
    enabled: previous?.enabled ?? true,
    activated: false,
    binding: null,
    restart_required: true,
    health: null,
    offline_bundle_digest: digest,
  }, 'offline-install-complete', { transaction_id: transactionId, content_digest: digest });
}

export async function installOfflinePackage(file, options = {}) {
  const { bundle } = await readOfflinePackage(file);
  const item = bundle.package;
  const runtime = await readRuntimeRegistry(options.registryFile);
  const previous = getRuntimePackage(runtime, item.type, item.id, { includeRemoved: true });
  const target = previous?.path || packagePath(item.type, item.id, options.root);
  const plan = {
    file: resolve(file),
    key: packageKey(item.type, item.id),
    type: item.type,
    id: item.id,
    version: item.version,
    commit: item.source.commit,
    content_digest: bundle.content.digest,
    target,
    restart_required: true,
    auto_restart: false,
    offline_safe: true,
  };
  if (options.dryRun) return { ...plan, dry_run: true, executed: false };
  if (options.approved !== true) {
    const error = new Error('offline package install requires explicit --yes approval');
    error.code = 'DSH_OFFLINE_INSTALL_APPROVAL_REQUIRED';
    error.plan = plan;
    throw error;
  }

  const transactionId = randomUUID();
  const txRoot = join(runtimeRoot(), 'transactions', `offline-install-${transactionId}`);
  const stage = join(txRoot, 'stage');
  const backup = join(txRoot, 'backup');
  let movedCurrent = false;
  let installedTarget = false;
  try {
    await extractBundle(bundle, stage);
    await snapshotDirectory(stage, { root: options.storeRoot });
    await mkdir(dirname(target), { recursive: true });
    if (await pathExists(target)) {
      await mkdir(dirname(backup), { recursive: true });
      await rename(target, backup);
      movedCurrent = true;
    }
    await rename(stage, target);
    installedTarget = true;
    const next = upsertRuntimePackage(runtime, offlineRuntimeRecord(item, target, previous?.state === 'removed' ? null : previous, transactionId, bundle.content.digest));
    const written = await writeRuntimeRegistry(next, options.registryFile);
    await rm(txRoot, { recursive: true, force: true });
    return { ...plan, executed: true, dry_run: false, transaction_id: transactionId, generation: written.generation };
  } catch (error) {
    if (installedTarget) await rm(target, { recursive: true, force: true }).catch(() => {});
    if (movedCurrent && await pathExists(backup)) await rename(backup, target).catch(() => {});
    await rm(txRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}
