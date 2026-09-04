export const KNOWN_PERMISSIONS = Object.freeze([
  'filesystem.read',
  'filesystem.write',
  'network',
  'network.unrestricted',
  'shell',
  'secrets.read',
  'mcp.tools',
  'process.spawn',
]);

const DANGEROUS = new Set(['filesystem.write', 'network.unrestricted', 'shell', 'secrets.read', 'process.spawn']);

function permissionName(item) {
  if (typeof item === 'string') return item.trim().toLowerCase();
  if (item && typeof item === 'object') {
    const value = item.name ?? item.id ?? item.permission;
    return typeof value === 'string' ? value.trim().toLowerCase() : '';
  }
  return '';
}

export function normalizePermissions(value) {
  const input = Array.isArray(value) ? value : Array.isArray(value?.required) ? value.required : [];
  return [...new Set(input.map(permissionName).filter(Boolean))].sort();
}

export function permissionRisk(permission) {
  if (DANGEROUS.has(permission)) return 'high';
  if (permission === 'network' || permission === 'mcp.tools') return 'medium';
  return 'low';
}

export function inspectPermissions(value) {
  const permissions = normalizePermissions(value);
  const unknown = permissions.filter((permission) => !KNOWN_PERMISSIONS.includes(permission));
  const dangerous = permissions.filter((permission) => DANGEROUS.has(permission));
  return {
    permissions,
    unknown,
    dangerous,
    requires_consent: dangerous.length > 0 || unknown.length > 0,
    risks: permissions.map((permission) => ({ permission, level: permissionRisk(permission) })),
  };
}

export function permissionDiff(previousValue, nextValue) {
  const previous = new Set(normalizePermissions(previousValue));
  const next = new Set(normalizePermissions(nextValue));
  return {
    added: [...next].filter((item) => !previous.has(item)).sort(),
    removed: [...previous].filter((item) => !next.has(item)).sort(),
    unchanged: [...next].filter((item) => previous.has(item)).sort(),
  };
}

export function assertPermissionConsent(value, options = {}) {
  const report = inspectPermissions(value);
  if (report.requires_consent && options.approved !== true) {
    const details = [...report.dangerous, ...report.unknown].join(', ');
    const error = new Error(`explicit permission consent required: ${details}`);
    error.code = 'DSH_PERMISSION_CONSENT_REQUIRED';
    error.permissionReport = report;
    throw error;
  }
  return report;
}
