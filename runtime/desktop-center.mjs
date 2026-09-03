import { readRuntimeRegistry } from './registry.mjs';
import { withPackageActivationState } from './package-status.mjs';
import { loadRegistryFile, resolvePackage } from './resolver.mjs';
import { resolveAcrossRegistries } from './registry-manager.mjs';
import { compareVersions } from './semver.mjs';
import { inferPackageType, packageKey } from './package-model.mjs';
import { inspectEnterprisePolicy } from './enterprise-policy.mjs';

export function desktopIpcContract() {
  return {
    protocol_version: 1,
    local_only: true,
    authentication: 'bearer-token',
    approval_required_for_mutations: true,
    auto_restart: false,
    routes: {
      health: { method: 'GET', path: '/health' },
      center: { method: 'GET', path: '/v1/desktop/center' },
      policy: { method: 'GET', path: '/v1/enterprise/policy' },
      registries: { method: 'GET', path: '/v1/registries', mutates: false },
      registry_add: { method: 'POST', path: '/v1/registries', mutates: true, approval_field: 'approved' },
      registry_remove: { method: 'DELETE', path: '/v1/registries/{name}', mutates: true, approval_field: 'approved' },
      install_plan: { method: 'POST', path: '/v1/install/plan', mutates: false },
      install_execute: { method: 'POST', path: '/v1/install/execute', mutates: true, approval_field: 'approved' },
      packages: { method: 'GET', path: '/v1/packages' },
      package_logs: { method: 'GET', path: '/v1/packages/mcp/{id}/logs', mutates: false },
      package_doctor: { method: 'POST', path: '/v1/packages/{type}/{id}/doctor', mutates: true, approval_field: 'approved' },
      package_action: { method: 'PATCH', path: '/v1/packages/{type}/{id}', mutates: true, approval_field: 'approved' },
      package_remove: { method: 'DELETE', path: '/v1/packages/{type}/{id}', mutates: true, approval_field: 'approved' },
    },
    restart: {
      activation_state_after_install: 'pending-restart',
      host_must_own_restart: true,
      package_manager_may_restart_host: false,
    },
  };
}

function advisoryAlerts(record) {
  const security = record.security || {};
  const alerts = [];
  if (security.revoked === true) alerts.push({ severity: 'critical', code: 'DSH_PACKAGE_REVOKED', message: 'Installed package version is revoked.' });
  if (security.yanked === true) alerts.push({ severity: 'warning', code: 'DSH_PACKAGE_YANKED', message: 'Installed package version is yanked from new selection.' });
  for (const advisory of Array.isArray(security.advisories) ? security.advisories : []) {
    alerts.push({
      severity: String(advisory?.severity || 'warning').toLowerCase(),
      code: 'DSH_SECURITY_ADVISORY',
      advisory_id: advisory?.id || advisory?.advisory_id || null,
      message: advisory?.summary || advisory?.title || 'Security advisory applies to this package.',
    });
  }
  return alerts;
}

async function catalogOrNull(file) {
  try { return await loadRegistryFile(file); } catch { return null; }
}

function installedRegistry(record) {
  return String(record.source_registry || record.source?.registry || 'official').trim() || 'official';
}

function latestFromCatalog(catalog, record) {
  if (!catalog) return null;
  const type = record.type || inferPackageType(record);
  try {
    return resolvePackage(catalog, type, record.id, '*', { channel: 'stable' });
  } catch {
    return null;
  }
}

async function latestForRecord(officialCatalog, record, options = {}) {
  const registry = installedRegistry(record);
  if (registry === 'official') return { package: latestFromCatalog(officialCatalog, record), registry, error: null };
  const type = record.type || inferPackageType(record);
  try {
    if (/^https?:\/\//i.test(registry)) {
      const directCatalog = await loadRegistryFile(registry);
      return { package: latestFromCatalog(directCatalog, record), registry, error: null };
    }
    const resolved = await resolveAcrossRegistries(record.id, {
      type,
      version: '*',
      channel: 'stable',
      registry,
      file: options.registriesFile,
      allowStale: true,
    });
    return { package: resolved.package, registry: resolved.registry.name, error: null };
  } catch (error) {
    return {
      package: null,
      registry,
      error: { code: error.code || 'DSH_UPDATE_SOURCE_UNAVAILABLE', message: error.message },
    };
  }
}

export async function buildDesktopCenter(options = {}) {
  const runtime = await readRuntimeRegistry(options.runtimeRegistry);
  const catalog = await catalogOrNull(options.catalog || 'catalog/registry-v3.json');
  const policy = await inspectEnterprisePolicy(options.enterprisePolicyFile);
  const packages = [];
  const alerts = [];

  for (const source of runtime.packages || []) {
    if (source.state === 'removed' && options.includeRemoved !== true) continue;
    const record = withPackageActivationState(source);
    const latestResult = await latestForRecord(catalog, record, options);
    const latest = latestResult.package;
    let updateAvailable = false;
    if (latest?.version && record.version) {
      try { updateAvailable = compareVersions(latest.version, record.version) > 0; } catch { updateAvailable = latest.version !== record.version; }
    }
    const key = packageKey(record.type || inferPackageType(record), record.id);
    const packageAlerts = advisoryAlerts(record).map((alert) => ({ ...alert, package: key, version: record.version }));
    alerts.push(...packageAlerts);
    packages.push({
      ...record,
      key,
      source_registry: latestResult.registry,
      latest_stable: latest?.version || null,
      update_available: updateAvailable,
      update_source_error: latestResult.error,
      alerts: packageAlerts,
    });
  }

  const groups = {
    active: packages.filter((item) => item.activation_state === 'active'),
    pending_restart: packages.filter((item) => item.activation_state === 'pending-restart'),
    disabled: packages.filter((item) => item.activation_state === 'disabled'),
    failed: packages.filter((item) => item.activation_state === 'failed'),
    updates: packages.filter((item) => item.update_available),
  };
  return {
    schema_version: 1,
    runtime_generation: runtime.generation,
    packages,
    groups,
    counts: Object.fromEntries(Object.entries(groups).map(([name, items]) => [name, items.length])),
    restart_required: groups.pending_restart.length > 0,
    auto_restart: false,
    security_alerts: alerts,
    enterprise: {
      configured: policy.configured,
      organization: policy.policy.organization,
      enforce: policy.policy.enforce,
    },
    contract: desktopIpcContract(),
  };
}
