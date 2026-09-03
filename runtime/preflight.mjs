import { buildDependencyPlan, resolvePackage } from './resolver.mjs';
import { evaluateCompatibility } from './compatibility.mjs';
import { inspectPermissions, permissionDiff } from './permissions.mjs';
import { assertPackageType, inferPackageType, packageKey, parsePackageRequest } from './package-model.mjs';

function active(records) {
  return (records || []).filter((record) => record.state !== 'removed');
}

function resolveRequestedPackage(registry, spec, options = {}) {
  const defaultType = assertPackageType(options.type || 'plugin');
  const request = parsePackageRequest(spec, {
    defaultVersion: '*',
    defaultType,
    channel: options.channel || 'stable',
    registry: options.registry || null,
  });
  try {
    return resolvePackage(registry, request.type, request.id, request.versionRange, { channel: request.channel });
  } catch (error) {
    const match = (registry.plugins || []).find((item) =>
      inferPackageType(item) === request.type
      && item.source?.repo === request.id
      && (item.channel || item.release_channel || 'stable') === request.channel);
    if (!match) throw error;
    return resolvePackage(registry, request.type, match.id, request.versionRange, { channel: request.channel });
  }
}

export function preflightPackage(registry, spec, options = {}) {
  const root = resolveRequestedPackage(registry, spec, options);
  const requestedType = options.type && options.type !== 'ecosystem' ? assertPackageType(options.type) : null;
  const actualType = root.type || inferPackageType(root);
  const installed = active(options.installed);
  const reasons = [];
  const typeOk = !requestedType || requestedType === actualType;
  if (!typeOk) reasons.push(`package type mismatch: requested ${requestedType}, registry contains ${actualType}`);

  let dependencyPlan = null;
  try {
    dependencyPlan = buildDependencyPlan(registry, root, {
      channel: options.channel || root.channel || 'stable',
      installed,
    });
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : String(error));
  }

  const candidates = dependencyPlan?.order || [root];
  const packageChecks = candidates.map((candidate) => {
    const compatibility = evaluateCompatibility(candidate, options.environment);
    const permissions = inspectPermissions(candidate.permissions);
    for (const reason of compatibility.reasons) reasons.push(`${packageKey(candidate.type || 'plugin', candidate.id)}: ${reason}`);
    return {
      id: candidate.id,
      version: candidate.version,
      type: candidate.type || inferPackageType(candidate),
      commit: candidate.commit,
      compatibility,
      permissions,
      provides: candidate.provides || [],
      conflicts: candidate.conflicts || [],
      replaces: candidate.replaces || [],
    };
  });

  const aggregatePermissions = inspectPermissions(candidates.flatMap((candidate) => candidate.permissions || []));
  const rootKey = packageKey(actualType, root.id);
  const current = installed.find((record) => packageKey(record.type || 'plugin', record.id) === rootKey);
  const rootPermissionDiff = permissionDiff(current?.permissions || [], root.permissions || []);

  return {
    allowed: reasons.length === 0,
    id: root.id,
    version: root.version,
    type: actualType,
    channel: root.channel,
    commit: root.commit,
    compatibility: packageChecks.find((entry) => entry.id === root.id && entry.type === actualType)?.compatibility
      || evaluateCompatibility(root, options.environment),
    permissions: aggregatePermissions,
    permission_diff: rootPermissionDiff,
    dependency_plan: dependencyPlan ? {
      order: dependencyPlan.order.map((candidate) => ({
        id: candidate.id,
        version: candidate.version,
        type: candidate.type || inferPackageType(candidate),
        commit: candidate.commit,
        provides: candidate.provides || [],
      })),
      graph: dependencyPlan.graph,
      replacements: dependencyPlan.replacements,
      declared_replacements: dependencyPlan.declared_replacements || [],
    } : null,
    package_checks: packageChecks,
    conflicts: root.conflicts || [],
    replaces: root.replaces || [],
    provides: root.provides || [],
    publisher: root.publisher || null,
    security: root.security || null,
    reasons: [...new Set(reasons)],
  };
}
