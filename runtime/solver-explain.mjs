import { preflightPackage } from './preflight.mjs';
import { compareVersions, satisfiesVersion } from './semver.mjs';
import { assertPackageType, inferPackageType, packageKey, parsePackageRequest } from './package-model.mjs';

function releaseChannel(item) {
  return item.channel || item.release_channel || 'stable';
}

function matchesRequestIdentity(item, request) {
  const type = inferPackageType(item);
  if (type !== request.type || releaseChannel(item) !== request.channel) return false;
  const token = String(request.id || '').toLowerCase();
  return String(item.id || '').toLowerCase() === token || String(item.source?.repo || '').toLowerCase() === token;
}

function candidateReason(item, request, selected) {
  if (item.security?.revoked === true || item.security?.recalled === true) return 'revoked';
  if (item.security?.yanked === true) return 'yanked';
  if (!satisfiesVersion(item.version, request.versionRange)) return `does-not-satisfy:${request.versionRange}`;
  if (selected && item.version === selected.version && item.source?.commit === selected.commit) return 'selected-highest-compatible';
  return 'lower-compatible-version';
}

export function explainPackageResolution(registry, rawSpec, options = {}) {
  const request = parsePackageRequest(rawSpec, {
    defaultType: assertPackageType(options.type || 'plugin'),
    defaultVersion: options.version || '*',
    channel: options.channel || 'stable',
    registry: options.registry || null,
  });

  let preflight;
  try {
    preflight = preflightPackage(registry, `${request.type}:${request.id}@${request.versionRange}`, {
      type: request.type,
      channel: request.channel,
      installed: options.installed || [],
      environment: options.environment,
    });
  } catch (firstError) {
    const repoMatch = (registry.plugins || []).find((item) => matchesRequestIdentity(item, request));
    if (!repoMatch) {
      return {
        request,
        resolved: false,
        error: { code: firstError?.code || 'DSH_PACKAGE_NOT_FOUND', message: firstError?.message || String(firstError) },
        candidates: [],
      };
    }
    try {
      preflight = preflightPackage(registry, `${request.type}:${repoMatch.id}@${request.versionRange}`, {
        type: request.type,
        channel: request.channel,
        installed: options.installed || [],
        environment: options.environment,
      });
    } catch (error) {
      return {
        request,
        resolved: false,
        error: { code: error?.code || 'DSH_PACKAGE_NOT_FOUND', message: error?.message || String(error) },
        candidates: [],
      };
    }
  }

  const selected = preflight?.id ? {
    id: preflight.id,
    type: preflight.type,
    key: packageKey(preflight.type, preflight.id),
    version: preflight.version,
    channel: preflight.channel,
    commit: preflight.commit,
  } : null;

  const identityRequest = { ...request, id: preflight?.id || request.id };
  const candidates = (registry.plugins || [])
    .filter((item) => matchesRequestIdentity(item, identityRequest))
    .sort((left, right) => compareVersions(right.version, left.version))
    .map((item) => ({
      id: item.id,
      type: inferPackageType(item),
      version: item.version,
      channel: releaseChannel(item),
      commit: item.source?.commit || null,
      integrity: item.artifact?.integrity || null,
      yanked: item.security?.yanked === true,
      revoked: item.security?.revoked === true || item.security?.recalled === true,
      satisfies: satisfiesVersion(item.version, request.versionRange),
      decision: candidateReason(item, request, selected),
    }));

  return {
    request,
    resolved: Boolean(selected),
    allowed: Boolean(preflight?.allowed),
    selected,
    candidates,
    reasons: preflight?.reasons || [],
    permission_diff: preflight?.permission_diff || { added: [], removed: [], unchanged: [] },
    permissions: preflight?.permissions || null,
    compatibility: preflight?.compatibility || null,
    dependency_plan: preflight?.dependency_plan || null,
    package_checks: preflight?.package_checks || [],
    conflicts: preflight?.conflicts || [],
    replaces: preflight?.replaces || [],
    provides: preflight?.provides || [],
  };
}

export function dependencyGraphFromExplanation(explanation) {
  return {
    request: explanation.request,
    resolved: explanation.resolved,
    allowed: explanation.allowed ?? false,
    root: explanation.selected,
    graph: explanation.dependency_plan?.graph || {},
    order: explanation.dependency_plan?.order || [],
    replacements: explanation.dependency_plan?.replacements || [],
    declared_replacements: explanation.dependency_plan?.declared_replacements || [],
    reasons: explanation.reasons || [],
    error: explanation.error || null,
  };
}
