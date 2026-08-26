import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { registryCacheFile, registryCacheMetadataFile, resolveRegistrySource } from './catalog.mjs';
import { checkRuntimePackageHealth } from './health.mjs';
import { assertPackageType, packageKey } from './package-model.mjs';
import {
  findRuntimePackage,
  getRuntimePackage,
  readRuntimeRegistry,
  registryLockPath,
  registryPath,
  runtimeRegistryEnv,
} from './registry.mjs';
import { runtimeEnvironment } from './self-update.mjs';
import { transactionsRoot } from './transaction.mjs';

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonIfPresent(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    return { error: error.message };
  }
}

async function catalogDiagnostics() {
  const source = await resolveRegistrySource();
  const cache = resolve(registryCacheFile());
  const metadataFile = resolve(registryCacheMetadataFile(cache));
  const present = await exists(cache);
  let sizeBytes = 0;
  if (present) {
    try { sizeBytes = (await stat(cache)).size; } catch { sizeBytes = 0; }
  }
  const metadata = await readJsonIfPresent(metadataFile);
  return {
    source,
    source_kind: /^https?:\/\//i.test(source) ? 'remote' : 'local',
    cache: {
      file: cache,
      present,
      size_bytes: sizeBytes,
      metadata_file: metadataFile,
      metadata,
    },
  };
}

async function transactionDiagnostics() {
  const root = transactionsRoot();
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return { root, pending: 0, journals: [], warnings: [] };
    return { root, pending: 0, journals: [], warnings: [`transactions:${error.message}`] };
  }

  const journals = [];
  const warnings = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = join(root, entry.name, 'journal.json');
    const journal = await readJsonIfPresent(file);
    if (!journal) continue;
    if (journal.error) {
      warnings.push(`transaction:${entry.name}:invalid-journal`);
      journals.push({ id: entry.name, state: 'invalid', error: journal.error });
      continue;
    }
    journals.push({
      id: journal.id || entry.name,
      state: journal.state || 'unknown',
      kind: journal.kind || null,
      expected_generation: journal.expected_generation ?? null,
    });
  }
  const pending = journals.filter((item) => item.state !== 'committed').length;
  if (pending) warnings.push(`transactions:pending:${pending}`);
  return { root, pending, journals, warnings };
}

function lifecycleHealth(record, health) {
  const failed = [...(health.failed || [])];
  const warnings = [...(health.warnings || [])];
  if (record.state === 'failed' && !failed.includes('lifecycle')) failed.push('lifecycle');
  if (record.restart_required) warnings.push('restart-required');
  if (record.enabled !== false && !record.restart_required && !['active', 'disabled'].includes(record.state)) {
    warnings.push(`lifecycle:${record.state}`);
  }
  const status = failed.length ? 'failed' : warnings.length ? 'warning' : 'healthy';
  return { ...health, status, failed, warnings };
}

function summarizePackages(packages) {
  const byType = { plugin: 0, mcp: 0, skill: 0, agent: 0 };
  const byHealth = { healthy: 0, warning: 0, failed: 0 };
  let restartRequired = 0;
  for (const item of packages) {
    byType[item.type] = (byType[item.type] || 0) + 1;
    byHealth[item.health.status] = (byHealth[item.health.status] || 0) + 1;
    if (item.restart_required) restartRequired += 1;
  }
  return { total: packages.length, by_type: byType, by_health: byHealth, restart_required: restartRequired };
}

export async function runDoctor(packageVersion, options = {}) {
  const runtimeFile = resolve(options.registryFile || registryPath());
  const runtimeFilePresent = await exists(runtimeFile);
  const registry = await readRuntimeRegistry(runtimeFile);
  const type = options.type ? assertPackageType(options.type) : null;
  let records = (registry.packages || []).filter((item) => options.includeRemoved || item.state !== 'removed');

  if (options.id) {
    const record = type
      ? getRuntimePackage(registry, type, options.id, { includeRemoved: options.includeRemoved })
      : findRuntimePackage(registry, options.id, { includeRemoved: options.includeRemoved });
    if (!record) throw new Error(`runtime package is not installed: ${type ? `${type}:` : ''}${options.id}`);
    records = [record];
  } else if (type) {
    records = records.filter((item) => item.type === type);
  }

  const packages = [];
  for (const record of records) {
    const health = await checkRuntimePackageHealth(record, {
      runtimeRegistry: registry,
      verifyCommit: options.quick !== true,
    });
    packages.push({
      id: record.id,
      type: record.type,
      key: packageKey(record.type, record.id),
      version: record.version,
      state: record.state,
      enabled: record.enabled,
      activated: record.activated,
      restart_required: record.restart_required,
      health: lifecycleHealth(record, health),
    });
  }

  const runtime = await runtimeEnvironment(packageVersion, options.runtimeOptions || {});
  const transactions = await transactionDiagnostics();
  const catalog = await catalogDiagnostics();
  const runtimeEnv = runtimeRegistryEnv();
  const warnings = [...transactions.warnings];
  if (runtimeEnv?.legacy) warnings.push('runtime-registry:legacy-DSH_REGISTRY');
  if (await exists(registryLockPath(runtimeFile))) warnings.push('runtime-registry:write-lock-present');
  if (!runtimeFilePresent && packages.length === 0) warnings.push('runtime-registry:not-initialized');

  const summary = summarizePackages(packages);
  const failures = [];
  if (!runtime.node_supported) failures.push('runtime:unsupported-node');
  if (summary.by_health.failed) failures.push(`packages:failed:${summary.by_health.failed}`);
  if (transactions.journals.some((item) => item.state === 'invalid')) failures.push('transactions:invalid-journal');

  const status = failures.length ? 'failed' : (warnings.length || summary.by_health.warning ? 'warning' : 'healthy');
  return {
    status,
    healthy: status === 'healthy',
    checked_at: new Date().toISOString(),
    runtime: {
      ...runtime,
      runtime_registry_schema: registry.schema_version,
      api_version: 'v1',
      package_types: ['plugin', 'mcp', 'skill', 'agent'],
    },
    registry: {
      runtime: {
        file: runtimeFile,
        present: runtimeFilePresent,
        generation: registry.generation,
        updated_at: registry.updated_at || null,
        env: runtimeEnv,
        lock_file: registryLockPath(runtimeFile),
        lock_present: await exists(registryLockPath(runtimeFile)),
      },
      catalog,
    },
    transactions,
    summary,
    packages,
    warnings,
    failures,
  };
}
