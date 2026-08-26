const POLICY_KEYS = new Set([
  'filesystem.read', 'filesystem.write', 'network', 'network.unrestricted',
  'shell', 'secrets.read', 'mcp.tools', 'process.spawn',
]);

function list(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item).trim()).filter(Boolean))];
}

export function normalizePermissionPolicy(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const policy = {};
  for (const [permission, raw] of Object.entries(value)) {
    if (!POLICY_KEYS.has(permission) || !raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    policy[permission] = { allow: list(raw.allow), deny: list(raw.deny) };
  }
  return policy;
}

function wildcard(pattern) {
  const escaped = String(pattern).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i');
}

function matches(pattern, resource) {
  try { return wildcard(pattern).test(String(resource)); } catch { return false; }
}

export function evaluateResourcePolicy(value, permission, resource) {
  const policy = normalizePermissionPolicy(value);
  const rule = policy[permission] || (permission === 'network' ? policy['network.unrestricted'] : undefined);
  if (!rule) return { allowed: true, enforced: false, permission, resource, reason: 'no scoped policy declared' };
  if (rule.deny.some((pattern) => matches(pattern, resource))) {
    return { allowed: false, enforced: true, permission, resource, reason: `resource denied by ${permission} policy` };
  }
  if (rule.allow.length === 0) {
    return { allowed: false, enforced: true, permission, resource, reason: `no resources allowed by ${permission} policy` };
  }
  const allowed = rule.allow.some((pattern) => matches(pattern, resource));
  return { allowed, enforced: true, permission, resource, reason: allowed ? 'resource allowed' : `resource not listed in ${permission} allow policy` };
}

export function assertResourcePolicy(value, permission, resource) {
  const result = evaluateResourcePolicy(value, permission, resource);
  if (!result.allowed) {
    const error = new Error(`permission policy blocked ${permission} for ${resource}: ${result.reason}`);
    error.code = 'DSH_PERMISSION_POLICY_DENIED';
    error.policyResult = result;
    throw error;
  }
  return result;
}
