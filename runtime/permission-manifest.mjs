import { KNOWN_PERMISSIONS, normalizePermissions } from './permissions.mjs';
import { normalizePermissionPolicy } from './permission-policy.mjs';

function list(value) {
  if (value === true) return ['*'];
  return [...new Set((Array.isArray(value) ? value : []).map((item) => String(item || '').trim()).filter(Boolean))];
}

function scopedRule(value) {
  if (value === true) return { declared: true, scoped: false, allow: [], deny: [] };
  if (Array.isArray(value)) return { declared: value.length > 0, scoped: value.length > 0, allow: list(value), deny: [] };
  if (!value || typeof value !== 'object') return { declared: false, scoped: false, allow: [], deny: [] };
  const allow = list(value.allow);
  const deny = list(value.deny);
  const enabled = value.enabled === true || allow.length > 0 || deny.length > 0;
  return { declared: enabled, scoped: allow.length > 0 || deny.length > 0, allow, deny };
}

function addRule(model, permission, rule) {
  if (!rule.declared) return;
  model.permissions.add(permission);
  if (rule.scoped) model.policy[permission] = { allow: rule.allow, deny: rule.deny };
}

function object(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function isStructuredPermissionManifest(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['filesystem', 'network', 'process', 'secrets', 'mcp', 'shell'].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

export function compilePermissionManifest(value, explicitPolicy = {}) {
  /** @type {Record<string, { allow: string[], deny: string[] }>} */
  const policy = {};
  const model = {
    permissions: new Set(normalizePermissions(value)),
    policy,
    structured: isStructuredPermissionManifest(value),
    manifest: null,
  };

  if (model.structured) {
    const source = object(value);
    const filesystem = object(source.filesystem);
    const network = source.network;
    const processRule = object(source.process);
    const secrets = object(source.secrets);
    const mcp = object(source.mcp);

    addRule(model, 'filesystem.read', scopedRule(filesystem.read));
    addRule(model, 'filesystem.write', scopedRule(filesystem.write));

    if (network === true) {
      model.permissions.add('network.unrestricted');
    } else if (network && typeof network === 'object' && !Array.isArray(network)) {
      const networkObject = object(network);
      if (networkObject.unrestricted === true) model.permissions.add('network.unrestricted');
      addRule(model, 'network', scopedRule({
        enabled: networkObject.enabled === true || Array.isArray(networkObject.allow) || Array.isArray(networkObject.deny),
        allow: networkObject.allow,
        deny: networkObject.deny,
      }));
    } else if (Array.isArray(network)) {
      addRule(model, 'network', scopedRule(network));
    }

    addRule(model, 'process.spawn', scopedRule(processRule.spawn));
    addRule(model, 'secrets.read', scopedRule(secrets.access ?? secrets.read));
    addRule(model, 'mcp.tools', scopedRule(mcp.tools));
    addRule(model, 'shell', scopedRule(source.shell));

    model.manifest = {
      filesystem: {
        read: list(filesystem.read?.allow ?? filesystem.read),
        write: list(filesystem.write?.allow ?? filesystem.write),
      },
      network: network === true ? { unrestricted: true, allow: [], deny: [] } : {
        unrestricted: object(network).unrestricted === true,
        allow: list(object(network).allow ?? (Array.isArray(network) ? network : [])),
        deny: list(object(network).deny),
      },
      process: { spawn: processRule.spawn === true ? true : list(object(processRule.spawn).allow ?? processRule.spawn) },
      secrets: { access: list(secrets.access ?? secrets.read) },
      mcp: { tools: list(mcp.tools) },
      shell: source.shell === true ? true : list(object(source.shell).allow ?? source.shell),
    };
  }

  const normalizedExplicit = normalizePermissionPolicy(explicitPolicy);
  model.policy = { ...model.policy, ...normalizedExplicit };
  const permissions = [...model.permissions].map(String).filter(Boolean).sort();
  const unknown = permissions.filter((permission) => !KNOWN_PERMISSIONS.includes(permission));
  return {
    permissions,
    permission_policy: model.policy,
    permission_manifest: model.manifest,
    structured: model.structured,
    unknown,
  };
}
