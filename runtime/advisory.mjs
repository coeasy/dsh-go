import {
  compareVersion,
  normalizePackageId,
  normalizePackageType,
  normalizeReleaseChannel,
  normalizeVersionRange,
  satisfiesRange,
} from '../packages/protocol-core/index.mjs';

function advisoryList(pkg) {
  return Array.isArray(pkg?.security?.advisories)
    ? pkg.security.advisories
    : Array.isArray(pkg?.advisories)
      ? pkg.advisories
      : [];
}

export function packageAdvisories(pkg) {
  return advisoryList(pkg).filter((item) => {
    const range = item?.affected || item?.range || '*';
    try { return satisfiesRange(pkg.version, range); } catch { return false; }
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
  const belowMinimum = Boolean(minimumSafe && compareVersion(pkg.version, minimumSafe) < 0);
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

function registryReleases(registry, request) {
  const type = normalizePackageType(request.type);
  const id = normalizePackageId(request.id);
  const channel = normalizeReleaseChannel(request.channel || 'stable');
  const range = normalizeVersionRange(request.range || request.version || request.versionRange || '*');
  const pkg = (registry?.packages || []).find((item) => {
    try { return normalizePackageType(item.type) === type && normalizePackageId(item.id) === id; }
    catch { return false; }
  });
  if (!pkg) return { type, id, channel, range, releases: [] };
  const releases = (pkg.releases || [])
    .filter((release) => normalizeReleaseChannel(release.channel || 'stable') === channel)
    .filter((release) => {
      try { return satisfiesRange(release.version, range); } catch { return false; }
    })
    .map((release) => ({
      ...release,
      type,
      id,
      publisher: release.publisher || pkg.publisher || (pkg.publisher_id ? { id: pkg.publisher_id } : null),
      metadata: { ...(pkg.metadata || {}), ...(release.metadata || {}) },
    }))
    .sort((left, right) => compareVersion(right.version, left.version));
  return { type, id, channel, range, releases };
}

export function inspectPackageAdvisories(registry, request) {
  const selected = registryReleases(registry, request);
  if (!selected.releases.length) {
    const error = new Error(`runtime package not found for advisory inspection: ${selected.type}:${selected.id}@${selected.range} [${selected.channel}]`);
    error.code = 'DSH_PACKAGE_NOT_FOUND';
    throw error;
  }
  return {
    request: { type: selected.type, id: selected.id, range: selected.range, channel: selected.channel },
    versions: selected.releases.map((item) => ({
      type: selected.type,
      id: selected.id,
      version: item.version,
      channel: selected.channel,
      security: packageSecurityDecision(item),
    })),
  };
}

export function assertPackageSecurityAllowed(pkg, options = {}) {
  const decision = packageSecurityDecision(pkg, options);
  if (decision.revoked) {
    const error = new Error(`runtime package is revoked: ${pkg.type}:${pkg.id}@${pkg.version}`);
    error.code = 'DSH_PACKAGE_REVOKED';
    error.security = decision;
    throw error;
  }
  if (decision.below_minimum_safe_version || decision.critical > 0) {
    const error = new Error(`runtime package is blocked by security advisory: ${pkg.type}:${pkg.id}@${pkg.version}`);
    error.code = 'DSH_SECURITY_ADVISORY_BLOCKED';
    error.security = decision;
    throw error;
  }
  return decision;
}
