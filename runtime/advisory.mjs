import { compareVersions, satisfiesVersion } from './semver.mjs';

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
