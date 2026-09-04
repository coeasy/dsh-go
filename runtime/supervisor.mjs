import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { parsePackageCoordinate, formatPackageCoordinate } from '../packages/protocol-core/index.mjs';
import { appendAuditEvent } from './audit-log.mjs';
import { withFileLock } from './file-lock.mjs';
import { readRuntimeRegistry, runtimeRoot } from './registry.mjs';
import {
  installPackageRequest,
  removePackageRequest,
  rollbackPackageRequest,
  setPackageEnabled,
  updatePackageRequest,
} from './package-service.mjs';
import { activateRuntimeGeneration } from './activation-manager.mjs';
import { restoreEnvironmentLock } from './environment-lock.mjs';

const MUTATION_OPERATIONS = new Set([
  'install', 'update', 'remove', 'rollback', 'enable', 'disable', 'activate', 'environment-restore',
  'config-write', 'secret-write', 'secret-delete', 'trust-write', 'store-gc',
]);

export function supervisorLockPath() {
  return resolve(process.env.DSH_SUPERVISOR_LOCK || join(runtimeRoot(), 'state', 'runtime-supervisor.lock'));
}

function coordinate(value, options = {}) {
  if (!value) return null;
  if (typeof value === 'string') {
    try { return formatPackageCoordinate(parsePackageCoordinate(value, { channel: options.channel || 'stable' })); }
    catch { return String(value); }
  }
  try { return formatPackageCoordinate(value); } catch { return null; }
}

function requireApproval(operation, options) {
  if (!MUTATION_OPERATIONS.has(operation) || options.dryRun === true || options.dry_run === true) return;
  if (options.approved === true) return;
  const error = new Error(`explicit local approval required for ${operation}`);
  error.code = 'DSH_PERMISSION_DENIED';
  throw error;
}

export async function superviseMutation(operation, context = {}, executor, options = {}) {
  if (typeof executor !== 'function') throw new TypeError('Runtime Supervisor requires an executor');
  requireApproval(operation, options);
  const operationId = options.operationId || randomUUID();
  const requestId = options.requestId || context.request_id || randomUUID();
  const started = Date.now();
  const registryFile = options.registryFile;

  return withFileLock(supervisorLockPath(), async () => {
    const before = await readRuntimeRegistry(registryFile);
    await appendAuditEvent({
      request_id: requestId,
      operation_id: operationId,
      operation,
      package_coordinate: context.package_coordinate || coordinate(context.spec, options),
      registry_revision: context.registry_revision || null,
      resolution_hash: context.resolution_hash || null,
      policy: context.policy || null,
      generation_before: before.generation,
      result: 'started',
      details: { source: context.source || options.source || 'local' },
    }, options.audit || {});

    try {
      const result = await executor({ operationId, requestId, generationBefore: before.generation });
      const after = await readRuntimeRegistry(registryFile);
      await appendAuditEvent({
        request_id: requestId,
        operation_id: operationId,
        transaction_id: result?.transaction_id || null,
        operation,
        package_coordinate: context.package_coordinate || coordinate(context.spec, options),
        registry_revision: result?.plan?.registry_revision || result?.registry_revision || context.registry_revision || null,
        resolution_hash: result?.plan?.resolution_hash || result?.resolution_hash || context.resolution_hash || null,
        policy: result?.policy_snapshot || context.policy || null,
        generation_before: before.generation,
        generation_after: after.generation,
        result: 'success',
        duration_ms: Date.now() - started,
        details: { changed: result?.changed ?? null, restart_required: result?.restart_required ?? null },
      }, options.audit || {});
      return { ...result, supervisor: { operation_id: operationId, request_id: requestId, generation_before: before.generation, generation_after: after.generation } };
    } catch (error) {
      const after = await readRuntimeRegistry(registryFile).catch(() => before);
      await appendAuditEvent({
        request_id: requestId,
        operation_id: operationId,
        operation,
        package_coordinate: context.package_coordinate || coordinate(context.spec, options),
        registry_revision: context.registry_revision || null,
        resolution_hash: context.resolution_hash || null,
        policy: error.policy || context.policy || null,
        generation_before: before.generation,
        generation_after: after.generation,
        result: 'failure',
        duration_ms: Date.now() - started,
        error_code: error.code || 'DSH_RUNTIME_OPERATION_FAILED',
        recoverable: error.recoverable === true,
        recovery_required: error.recovery_required === true,
        details: { message: error.message },
      }, options.audit || {}).catch(() => {});
      error.operation_id = operationId;
      error.request_id = requestId;
      throw error;
    }
  }, {
    timeoutMs: Number(options.supervisorLockTimeoutMs || process.env.DSH_SUPERVISOR_LOCK_TIMEOUT_MS || 120_000),
    staleMs: Number(options.supervisorLockStaleMs || process.env.DSH_SUPERVISOR_LOCK_STALE_MS || 180_000),
  });
}

export function supervisedInstall(value, options = {}) {
  return superviseMutation('install', { spec: value, source: options.source }, () => installPackageRequest(value, { ...options, approved: true }), options);
}

export function supervisedUpdate(value, options = {}) {
  return superviseMutation('update', { spec: value, source: options.source }, () => updatePackageRequest(value, { ...options, approved: true }), options);
}

export function supervisedRemove(value, options = {}) {
  return superviseMutation('remove', { spec: value, source: options.source }, () => removePackageRequest(value, { ...options, approved: true }), options);
}

export function supervisedRollback(value, options = {}) {
  return superviseMutation('rollback', { spec: value, source: options.source }, () => rollbackPackageRequest(value, { ...options, approved: true }), options);
}

export function supervisedSetEnabled(value, enabled, options = {}) {
  return superviseMutation(enabled ? 'enable' : 'disable', { spec: value, source: options.source }, () => setPackageEnabled(value, enabled, { ...options, approved: true }), options);
}

export function supervisedActivate(options = {}) {
  return superviseMutation('activate', { source: options.source }, () => activateRuntimeGeneration({ ...options, approved: true }), options);
}

export function supervisedEnvironmentRestore(options = {}) {
  return superviseMutation('environment-restore', { source: options.source }, () => restoreEnvironmentLock({ ...options, approved: true }), options);
}
