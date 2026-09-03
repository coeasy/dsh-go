import { createHash, randomUUID } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { assertPermissionConsent } from './permissions.mjs';
import { assertPackageSecurityAllowed } from './advisory.mjs';
import { packageKey } from './package-model.mjs';
import { getRuntimePackage, packagePath, pathExists, readRuntimeRegistry, updateRuntimeRegistry, upsertRuntimePackage } from './registry.mjs';
import { readInstallLock, normalizeInstallLock } from './verifier.mjs';
import { recordRuntimeEvent } from './lifecycle.mjs';
import { enforceEnterprisePolicy } from './enterprise-policy.mjs';
import { withPackageOperationLock } from './package-operation-lock.mjs';

export const DSHPKG_SCHEMA_VERSION = 1;

async function collectFiles(root, current = root, out = []) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    const path = relative(root, absolute).replaceAll('\\', '/');
    const info = await lstat(absolute);
    if (entry.isSymbolicLink()) throw new Error(`offline package export refuses symbolic link: ${path}`);
    if (entry.isDirectory()) {
      out.push({ path, kind: 'directory', mode: info.mode & 0o777 });
      await collectFiles(root, absolute, out);
    } else if (entry.isFile()) {
      out.push({ path, kind: 'file', mode: info.mode & 0o777, data: (await readFile(absolute)).toString('base64') });
    }
  }
  return out;
}

function canonicalPayload(bundle) {
  return JSON.stringify({ schema_version: DSHPKG_SCHEMA_VERSION, package: bundle.package, files: bundle.files });
}

export function dshpkgDigest(bundle) {
  return createHash('sha256').update(canonicalPayload(bundle)).digest('hex');
}

export async function exportDshPackage(raw, output, options = {}) {
  const runtime = await readRuntimeRegistry(options.registryFile);
  const [type, id] = String(raw).includes(':') ? String(raw).split(':', 2) : [options.type || 'plugin', String(raw)];
  const record = getRuntimePackage(runtime, type, id);
  if (!record || record.state === 'removed') throw new Error(`runtime package is not installed: ${type}:${id}`);
  const root = record.path || packagePath(type, id);
  if (!await pathExists(root)) throw new Error(`runtime package path missing: ${root}`);
  const lock = await readInstallLock(root);
  const files = await collectFiles(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  const bundle = {
    schema_version: DSHPKG_SCHEMA_VERSION,
    created_at: new Date().toISOString(),
    package: {
      type: lock.type,
      id: lock.id,
      version: lock.version,
      channel: lock.channel || 'stable',
      source: lock.source,
      artifact: lock.artifact || null,
      runtime: lock.runtime || {},
      capabilities: lock.capabilities || [],
      dependencies: lock.dependencies || [],
      permissions: lock.permissions || [],
      permission_policy: lock.permission_policy || null,
      permission_manifest: lock.permission_manifest || null,
      compatibility: lock.compatibility || {},
      publisher: lock.publisher || null,
      security: lock.security || null,
      conflicts: lock.conflicts || [],
      replaces: lock.replaces || [],
      provides: lock.provides || [],
      type_config: lock.type_config || null,
      install_lock: lock,
    },
    files,
  };
  bundle.digest = dshpkgDigest(bundle);
  const target = resolve(output || `${id}-${lock.version}.dshpkg`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(bundle)}\n`, 'utf8');
  return { file: target, key: packageKey(type, id), version: lock.version, digest: bundle.digest, files: files.filter((item) => item.kind === 'file').length };
}

export async function readDshPackage(file) {
  const target = resolve(file);
  const bundle = JSON.parse(await readFile(target, 'utf8'));
  if (bundle?.schema_version !== DSHPKG_SCHEMA_VERSION || !bundle?.package || !Array.isArray(bundle?.files)) throw new Error(`invalid .dshpkg: ${target}`);
  const actual = dshpkgDigest(bundle);
  if (actual !== bundle.digest) {
    const error = new Error(`.dshpkg digest mismatch: expected ${bundle.digest}, calculated ${actual}`);
    error.code = 'DSH_INTEGRITY_MISMATCH';
    throw error;
  }
  const lock = normalizeInstallLock(bundle.package.install_lock);
  if (lock.type !== bundle.package.type || lock.id !== bundle.package.id || lock.version !== bundle.package.version) throw new Error('.dshpkg install lock identity mismatch');
  return { file: target, bundle, lock };
}

async function materialize(files, root) {
  const base = resolve(root);
  for (const item of files) {
    const target = resolve(base, item.path);
    const rel = relative(base, target);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error(`unsafe .dshpkg path: ${item.path}`);
    if (item.kind === 'directory') await mkdir(target, { recursive: true });
    else if (item.kind === 'file') {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.from(item.data, 'base64'));
      if (item.mode) await chmod(target, item.mode);
    } else throw new Error(`unsupported .dshpkg entry: ${item.kind}`);
  }
}

export async function installDshPackage(file, options = {}) {
  const { bundle, lock } = await readDshPackage(file);
  const pkg = bundle.package;
  assertPackageSecurityAllowed(pkg);
  await enforceEnterprisePolicy({
    package: pkg,
    publisher: pkg.publisher,
    permissions: pkg.permissions,
    approved: options.approved === true || options.dryRun === true || process.env.DSH_PERMISSION_APPROVED === '1',
    operation: 'offline-install',
  }, { file: options.enterprisePolicyFile });
  if (!options.dryRun) assertPermissionConsent(pkg.permissions, { approved: options.approved === true || process.env.DSH_PERMISSION_APPROVED === '1' });
  const initialRuntime = await readRuntimeRegistry(options.registryFile);
  const initialCurrent = getRuntimePackage(initialRuntime, pkg.type, pkg.id, { includeRemoved: true });
  const initialTarget = initialCurrent?.path || packagePath(pkg.type, pkg.id, options.root);
  const plan = { key: packageKey(pkg.type, pkg.id), version: pkg.version, target: initialTarget, digest: bundle.digest, restart_required: true, auto_restart: false, offline: true };
  if (options.dryRun) return { ...plan, dry_run: true, executed: false };

  return withPackageOperationLock(pkg.type, pkg.id, async () => {
    const runtime = await readRuntimeRegistry(options.registryFile);
    const current = getRuntimePackage(runtime, pkg.type, pkg.id, { includeRemoved: true });
    const target = current?.path || packagePath(pkg.type, pkg.id, options.root);
    const currentPlan = { ...plan, target };
    const transactionId = randomUUID();
    const stage = `${target}.dshpkg-stage-${transactionId}`;
    const backup = `${target}.dshpkg-backup-${transactionId}`;
    let hadPrevious = false;
    let targetCommitted = false;
    let registryCommitted = false;
    await rm(stage, { recursive: true, force: true });
    try {
      await mkdir(stage, { recursive: true });
      await materialize(bundle.files, stage);
      const stagedLock = await readInstallLock(stage);
      if (stagedLock.type !== lock.type || stagedLock.id !== lock.id || stagedLock.version !== lock.version || stagedLock.source.commit !== lock.source.commit) throw new Error('materialized .dshpkg identity mismatch');
      hadPrevious = await pathExists(target);
      if (hadPrevious) await rename(target, backup);
      await mkdir(dirname(target), { recursive: true });
      await rename(stage, target);
      targetCommitted = true;
      const base = current?.state === 'removed' ? {} : current || {};
      const record = recordRuntimeEvent({
        ...base,
        id: pkg.id,
        type: pkg.type,
        version: pkg.version,
        channel: pkg.channel || 'stable',
        state: 'pending-restart',
        path: target,
        source: pkg.source,
        commit: pkg.source.commit,
        runtime: pkg.runtime || {},
        capabilities: pkg.capabilities || [],
        permissions: pkg.permissions || [],
        permission_policy: pkg.permission_policy || null,
        permission_manifest: pkg.permission_manifest || null,
        compatibility: pkg.compatibility || {},
        publisher: pkg.publisher || null,
        security: pkg.security || null,
        conflicts: pkg.conflicts || [],
        replaces: pkg.replaces || [],
        provides: pkg.provides || [],
        enabled: current?.enabled ?? true,
        activated: false,
        binding: null,
        restart_required: true,
        health: null,
        offline_package_digest: bundle.digest,
      }, 'offline-package-installed', { transaction_id: transactionId, digest: bundle.digest });
      await updateRuntimeRegistry((latest) => upsertRuntimePackage(latest, record), options.registryFile);
      registryCommitted = true;
      // Registry commit is the point of no return. Cleanup is best effort so a
      // transient filesystem failure cannot roll back a package that the
      // registry already declares installed.
      await rm(backup, { recursive: true, force: true }).catch(() => {});
      return { ...currentPlan, executed: true, dry_run: false, transaction_id: transactionId };
    } catch (error) {
      await rm(stage, { recursive: true, force: true }).catch((cleanupError) => {
        error.filesystem_cleanup_error = cleanupError.message;
        error.recovery_required = true;
      });
      if (registryCommitted) {
        error.state_preserved = true;
        throw error;
      }
      if (targetCommitted) {
        await rm(target, { recursive: true, force: true }).catch((cleanupError) => {
          error.filesystem_rollback_error = cleanupError.message;
          error.recovery_required = true;
        });
      }
      if (hadPrevious) {
        let backupExists = false;
        try {
          backupExists = await pathExists(backup);
        } catch (inspectError) {
          error.filesystem_rollback_error = inspectError.message;
          error.recovery_required = true;
        }
        if (backupExists) {
          try {
            await rename(backup, target);
          } catch (rollbackError) {
            error.filesystem_rollback_error = rollbackError.message;
            error.recovery_required = true;
          }
        } else if (!error.recovery_required) {
          error.filesystem_rollback_error = `offline package backup is missing: ${backup}`;
          error.recovery_required = true;
        }
      }
      throw error;
    }
  }, options);
}
