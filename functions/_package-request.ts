import { ecosystemType, type EcosystemType, type RegistryV3Plugin, type ReleaseChannel } from './_registry';

const TYPES: EcosystemType[] = ['plugin', 'mcp', 'skill', 'agent'];
const CHANNELS: ReleaseChannel[] = ['stable', 'beta', 'nightly', 'dev'];
const ID_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/;

export interface EdgePackageRequest {
  id: string;
  type?: EcosystemType;
  versionRange: string;
  channel: ReleaseChannel;
}

function parseVersion(version: string) {
  const match = String(version || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] || '' };
}

export function compareSemanticVersions(leftVersion: string, rightVersion: string) {
  const left = parseVersion(leftVersion);
  const right = parseVersion(rightVersion);
  if (!left || !right) throw new Error(`invalid semantic version comparison: ${leftVersion}, ${rightVersion}`);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

function wildcardMatch(version: string, range: string) {
  const parsed = parseVersion(version);
  if (!parsed) return false;
  const parts = String(range).replace(/^v/, '').split('.');
  const actual = [parsed.major, parsed.minor, parsed.patch];
  return parts.every((part, index) => ['x', 'X', '*'].includes(part) || Number(part) === actual[index]);
}

function comparator(version: string, token: string) {
  const raw = token.trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'latest') return true;
  if (/[xX*]/.test(raw)) return wildcardMatch(version, raw);
  if (raw.startsWith('^')) {
    const base = parseVersion(raw.slice(1));
    const current = parseVersion(version);
    if (!base || !current || compareSemanticVersions(version, raw.slice(1)) < 0) return false;
    if (base.major > 0) return current.major === base.major;
    if (base.minor > 0) return current.major === 0 && current.minor === base.minor;
    return current.major === 0 && current.minor === 0 && current.patch === base.patch;
  }
  if (raw.startsWith('~')) {
    const base = parseVersion(raw.slice(1));
    const current = parseVersion(version);
    return Boolean(base && current && compareSemanticVersions(version, raw.slice(1)) >= 0 && current.major === base.major && current.minor === base.minor);
  }
  const match = raw.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!match) return false;
  const op = match[1] || '=';
  const target = match[2];
  if (!parseVersion(target)) return false;
  const compared = compareSemanticVersions(version, target);
  return op === '>=' ? compared >= 0 : op === '<=' ? compared <= 0 : op === '>' ? compared > 0 : op === '<' ? compared < 0 : compared === 0;
}

export function satisfiesSemanticVersion(version: string, range = '*') {
  const expression = String(range || '*').trim();
  return expression.split('||').some((group) => group.trim().split(/\s+/).every((token) => comparator(version, token)));
}

export function normalizeEdgePackageRequest(input: { id?: string; type?: string; version?: string; channel?: string }): EdgePackageRequest {
  const id = String(input.id || '').trim();
  if (!id || id.length > 200 || !ID_RE.test(id)) throw new Error(`invalid package id: ${id || '<empty>'}`);
  const rawType = String(input.type || '').trim().toLowerCase();
  const type = rawType ? TYPES.find((candidate) => candidate === rawType) : undefined;
  if (rawType && !type) throw new Error(`invalid ecosystem type: ${rawType}`);
  const channel = String(input.channel || 'stable').trim().toLowerCase() as ReleaseChannel;
  if (!CHANNELS.includes(channel)) throw new Error(`invalid release channel: ${channel}`);
  const versionRange = String(input.version || '*').trim() || '*';
  return { id, type, versionRange, channel };
}

function releaseChannel(plugin: RegistryV3Plugin): ReleaseChannel {
  return plugin.channel || plugin.release_channel || 'stable';
}

function security(plugin: RegistryV3Plugin): Record<string, any> {
  return (plugin.security && typeof plugin.security === 'object' ? plugin.security : {}) as Record<string, any>;
}

function blockingReason(plugin: RegistryV3Plugin): string | null {
  const policy = security(plugin);
  if (policy.revoked === true) return 'revoked';
  if (policy.yanked === true) return 'yanked';
  const minimum = typeof policy.minimum_safe_version === 'string' ? policy.minimum_safe_version : null;
  if (minimum && parseVersion(minimum) && compareSemanticVersions(plugin.version, minimum) < 0) return `below-minimum-safe:${minimum}`;
  const advisories = Array.isArray(policy.advisories) ? policy.advisories : [];
  const critical = advisories.find((item: any) => String(item?.severity || '').toLowerCase() === 'critical'
    && satisfiesSemanticVersion(plugin.version, item?.affected || item?.range || '*'));
  if (critical) return `critical-advisory:${critical.id || critical.advisory_id || 'unknown'}`;
  return null;
}

function securityError(blocked: Array<{ plugin: RegistryV3Plugin; reason: string }>, request: EdgePackageRequest): Error {
  const reasons = [...new Set(blocked.map((item) => item.reason))];
  const error = new Error(`ecosystem item is blocked by security policy: ${request.id}@${request.versionRange} [${request.channel}] (${reasons.join(', ')})`);
  (error as Error & { code?: string; security?: unknown }).code = reasons.some((reason) => reason === 'revoked')
    ? 'DSH_PACKAGE_REVOKED'
    : reasons.some((reason) => reason === 'yanked') && reasons.every((reason) => reason === 'yanked')
      ? 'DSH_PACKAGE_YANKED'
      : 'DSH_SECURITY_ADVISORY_BLOCKED';
  (error as Error & { code?: string; security?: unknown }).security = blocked.map(({ plugin, reason }) => ({ id: plugin.id, type: ecosystemType(plugin), version: plugin.version, reason }));
  return error;
}

export function resolveEdgePackageRequest(plugins: RegistryV3Plugin[], raw: { id?: string; type?: string; version?: string; channel?: string }) {
  const request = normalizeEdgePackageRequest(raw);
  const idKey = request.id.toLowerCase();
  const matching = plugins
    .filter((plugin) => releaseChannel(plugin) === request.channel)
    .filter((plugin) => !request.type || ecosystemType(plugin) === request.type)
    .filter((plugin) => plugin.id.toLowerCase() === idKey || plugin.source.repo.toLowerCase() === idKey)
    .filter((plugin) => satisfiesSemanticVersion(plugin.version, request.versionRange));

  if (!matching.length) throw new Error(`ecosystem item not found: ${request.id}@${request.versionRange} [${request.channel}]`);
  const types = [...new Set(matching.map(ecosystemType))].sort();
  if (!request.type && types.length > 1) throw new Error(`ecosystem item is ambiguous; specify type (${types.join(', ')}): ${request.id}`);

  const blocked = matching.map((plugin) => ({ plugin, reason: blockingReason(plugin) })).filter((item): item is { plugin: RegistryV3Plugin; reason: string } => Boolean(item.reason));
  const candidates = matching.filter((plugin) => !blockingReason(plugin));
  if (!candidates.length) throw securityError(blocked, request);
  candidates.sort((left, right) => compareSemanticVersions(right.version, left.version));
  return { request, package: candidates[0], blocked };
}
