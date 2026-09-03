import { compareVersions, satisfiesVersion } from './semver.mjs';
import { inferPackageType } from './package-model.mjs';

function advisoryList(pkg) {
  return Array.isArray(pkg?.security?.advisories) ? pkg.security.advisories : Array.isArray(pkg?.advisories) ? pkg.advisories : [];
}

export function packageAdvisories(pkg) {
  return advisoryList(pkg).filter((item) => {
    const range = item?.affected || item?.range || '*';
    return satisfiesVersion(pkg.version, range);
  }).map((item) => ({
    id: String(item.id || item.advisory_id || 'unknown'),
    severity: String(item.severity || 'unknown').toLowerCase(),
    title: item.title || item.summary || null,
    affected: item.affected || item.range || '*',
    fixed_in: item.fixed_in || item.minimum_safe_version || null,
    url: item.url || null,
  }));
}

export function packageSecurityDecision(pkg, options = {}) {
  const advisories = packageAdvisories(pkg);
  const revoked = pkg?.security?.revoked === true || pkg?.revoked === true;
  const yanked = pkg?.security?.yanked === true || pkg?.yanked === true;
  const minimumSafe = pkg?.security?.minimum_safe_version || pkg?.minimum_safe_version || null;
  const belowMinimum = Boolean(minimumSafe && compareVersions(pkg.version, minimumSafe) < 0);
  const critical = advisories.filter((item) => item.severity === 'critical');
  const blocked = revoked || belowMinimum || (options.blockCritical !== false && critical.length > 0);
  return {
    blocked,
    revoked,
    yanked,
    below_minimum_safe_version: belowMinimum,
    minimum_safe_version: minimumSafe,
    advisories,
    critical: critical.length,
  };
}

export function inspectPackageAdvisories(registry, request) {
  const range = request.version || request.versionRange || '*';
  const channel = request.channel || 'stable';
  const candidates = (registry?.plugins || [])
    .filter((item) => inferPackageType(item) === request.type)
    .filter((item) => String(item.id || '').toLowerCase() === String(request.id || '').toLowerCase())
    .filter((item) => (item.channel || item.release_channel || 'stable') === channel)
    .filter((item) => satisfiesVersion(item.version, range))
    .sort((left, right) => compareVersions(right.version, left.version));
  if (!candidates.length) {
    const error = new Error(`runtime package not found for advisory inspection: ${request.type}:${request.id}@${range} [${channel}]`);
    error.code = 'DSH_PACKAGE_NOT_FOUND';
    throw error;
  }
  return {
    request: { type: request.type, id: request.id, version: range, channel },
    versions: candidates.map((item) => ({
      type: request.type,
      id: item.id,
      version: item.version,
      channel,
      security: packageSecurityDecision(item),
    })),
  };
}

export function assertPackageSecurityAllowed(pkg, options = {}) {
  const decision = packageSecurityDecision(pkg, options);
  if (decision.revoked) {
    const error = new Error(`runtime package is revoked: ${pkg.type || 'plugin'}:${pkg.id}@${pkg.version}`);
    error.code = 'DSH_PACKAGE_REVOKED';
    error.security = decision;
    throw error;
  }
  if (decision.below_minimum_safe_version || decision.critical > 0) {
    const error = new Error(`runtime package is blocked by security advisory: ${pkg.type || 'plugin'}:${pkg.id}@${pkg.version}`);
    error.code = 'DSH_SECURITY_ADVISORY_BLOCKED';
    error.security = decision;
    throw error;
  }
  return decision;
}
