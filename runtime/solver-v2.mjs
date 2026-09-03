import { assertCompatibility } from './compatibility.mjs';
import { packageAdvisories, packageSecurityDecision } from './advisory.mjs';
import { buildDependencyPlan, resolvePackage } from './resolver.mjs';
import { inferPackageType, packageKey } from './package-model.mjs';
import { satisfiesVersion } from './semver.mjs';

function releaseChannel(item) {
  return item.channel || item.release_channel || 'stable';
}

function candidateReason(item, request, options = {}) {
  const reasons = [];
  const type = inferPackageType(item);
  if (type !== request.type) reasons.push(`type ${type} != ${request.type}`);
  if (String(item.id).toLowerCase() !== String(request.id).toLowerCase()) reasons.push('different package id');
  if (releaseChannel(item) !== request.channel) reasons.push(`channel ${releaseChannel(item)} != ${request.channel}`);
  if (!satisfiesVersion(item.version, request.version)) reasons.push(`version ${item.version} does not satisfy ${request.version}`);
  const security = packageSecurityDecision({ ...item, type });
  if (security.revoked) reasons.push('revoked');
  if (security.yanked) reasons.push('yanked');
  if (security.below_minimum_safe_version) reasons.push(`below minimum safe version ${security.minimum_safe_version}`);
  if (security.critical) reasons.push(`${security.critical} critical advisory`);
  try { assertCompatibility(item, options.environment); } catch (error) { reasons.push(`incompatible: ${error.message}`); }
  return reasons;
}

export function explainResolution(registry, request, options = {}) {
  const normalized = {
    type: request.type || 'plugin',
    id: request.id,
    version: request.version || request.versionRange || '*',
    channel: request.channel || 'stable',
  };
  const considered = (registry.plugins || [])
    .filter((item) => String(item.id).toLowerCase() === String(normalized.id).toLowerCase())
    .map((item) => ({
      type: inferPackageType(item),
      id: item.id,
      version: item.version,
      channel: releaseChannel(item),
      accepted: candidateReason(item, normalized, options).length === 0,
      rejected_because: candidateReason(item, normalized, options),
      advisories: packageAdvisories(item),
    }));
  const selected = resolvePackage(registry, normalized.type, normalized.id, normalized.version, { channel: normalized.channel });
  const plan = buildDependencyPlan(registry, selected, { channel: normalized.channel, installed: options.installed || [] });
  return {
    request: normalized,
    selected: { type: selected.type, id: selected.id, version: selected.version, channel: selected.channel, commit: selected.commit },
    selected_because: [
      `satisfies ${normalized.version}`,
      `${normalized.channel} channel`,
      'highest compatible non-yanked, non-revoked version',
    ],
    dependency_order: plan.order.map((item) => ({ key: packageKey(item.type, item.id), version: item.version, commit: item.commit })),
    graph: plan.graph,
    replacements: plan.replacements,
    considered,
  };
}

export function dependencyGraph(registry, request, options = {}) {
  return explainResolution(registry, request, options).graph;
}
