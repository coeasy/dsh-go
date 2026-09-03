import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { packageKey } from './package-model.mjs';

export const ENTERPRISE_POLICY_SCHEMA_VERSION = 1;

function uniqueStrings(value) {
  return [...new Set((Array.isArray(value) ? value : [])
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))];
}

function objectValue(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

export function enterprisePolicyPath() {
  return resolve(process.env.DSH_ENTERPRISE_POLICY_FILE || join(homedir(), '.dsh', 'enterprise-policy.json'));
}

export function defaultEnterprisePolicy() {
  return {
    schema_version: ENTERPRISE_POLICY_SCHEMA_VERSION,
    organization: null,
    enforce: false,
    registries: { allow: [], deny: [], require_trusted: false },
    publishers: { allow: [], deny: [] },
    packages: { allow: [], deny: [] },
    permissions: { blocked: [], require_approval: [] },
    lockfile: { required: false, path: null },
    profiles: { allow: [] },
    bundles: { allow: [] },
  };
}

export function normalizeEnterprisePolicy(value = {}) {
  const source = objectValue(value);
  if (source.schema_version !== undefined && Number(source.schema_version) !== ENTERPRISE_POLICY_SCHEMA_VERSION) {
    const error = new Error(`unsupported enterprise policy schema: ${source.schema_version}`);
    error.code = 'DSH_ENTERPRISE_POLICY_SCHEMA_UNSUPPORTED';
    throw error;
  }
  const registries = objectValue(source.registries);
  const publishers = objectValue(source.publishers);
  const packages = objectValue(source.packages);
  const permissions = objectValue(source.permissions);
  const lockfile = objectValue(source.lockfile);
  const profiles = objectValue(source.profiles);
  const bundles = objectValue(source.bundles);
  return {
    schema_version: ENTERPRISE_POLICY_SCHEMA_VERSION,
    organization: typeof source.organization === 'string' && source.organization.trim() ? source.organization.trim() : null,
    enforce: source.enforce === true,
    registries: {
      allow: uniqueStrings(registries.allow),
      deny: uniqueStrings(registries.deny),
      require_trusted: registries.require_trusted === true,
    },
    publishers: { allow: uniqueStrings(publishers.allow), deny: uniqueStrings(publishers.deny) },
    packages: { allow: uniqueStrings(packages.allow), deny: uniqueStrings(packages.deny) },
    permissions: {
      blocked: uniqueStrings(permissions.blocked),
      require_approval: uniqueStrings(permissions.require_approval),
    },
    lockfile: {
      required: lockfile.required === true,
      path: typeof lockfile.path === 'string' && lockfile.path.trim() ? lockfile.path.trim() : null,
    },
    profiles: { allow: uniqueStrings(profiles.allow) },
    bundles: { allow: uniqueStrings(bundles.allow) },
  };
}

export async function readEnterprisePolicy(file = enterprisePolicyPath()) {
  try {
    return normalizeEnterprisePolicy(JSON.parse(await readFile(resolve(file), 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return defaultEnterprisePolicy();
    throw error;
  }
}

async function writeAtomic(file, value) {
  const target = resolve(file);
  await mkdir(dirname(target), { recursive: true });
  const temp = `${target}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, target);
  return target;
}

export async function writeEnterprisePolicy(value, file = enterprisePolicyPath()) {
  const policy = normalizeEnterprisePolicy(value);
  const target = await writeAtomic(file, policy);
  return { file: target, policy };
}

function globMatch(pattern, value) {
  const source = String(pattern || '').trim().toLowerCase();
  const target = String(value || '').trim().toLowerCase();
  if (!source || !target) return false;
  if (source === '*') return true;
  const escaped = source.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replaceAll('*', '.*');
  return new RegExp(`^${escaped}$`, 'i').test(target);
}

function matchesAny(patterns, values) {
  return patterns.some((pattern) => values.some((value) => globMatch(pattern, value)));
}

function publisherIdentity(input) {
  const publisher = input?.publisher || input?.package?.publisher || {};
  return String(publisher.id || publisher.login || publisher.name || publisher.organization || input?.package?.source?.repo?.split('/')[0] || '');
}

function registryValues(input) {
  const registry = input?.registry;
  if (!registry) return [];
  if (typeof registry === 'string') return [registry];
  return [registry.name, registry.url].filter(Boolean).map(String);
}

async function pathExists(path) {
  try { await access(path); return true; } catch { return false; }
}

export async function evaluateEnterprisePolicy(policyValue, input = {}) {
  const policy = normalizeEnterprisePolicy(policyValue);
  const violations = [];
  const approvals = [];
  const warnings = [];
  const pkg = input.package || null;
  const type = pkg?.type || input.type || null;
  const id = pkg?.id || input.id || null;
  const key = type && id ? packageKey(type, id) : null;
  const registry = registryValues(input);
  const publisher = publisherIdentity(input);
  const permissions = uniqueStrings(input.permissions || pkg?.permissions || []);

  if (policy.organization && input.organization && policy.organization !== input.organization) {
    violations.push(`organization mismatch: policy=${policy.organization}, request=${input.organization}`);
  }

  if (registry.length) {
    if (matchesAny(policy.registries.deny, registry)) violations.push(`registry denied by policy: ${registry[0]}`);
    if (policy.registries.allow.length && !matchesAny(policy.registries.allow, registry)) violations.push(`registry is not in organization allowlist: ${registry[0]}`);
    if (policy.registries.require_trusted && typeof input.registry === 'object' && input.registry?.trusted !== true) violations.push(`registry must be trusted: ${registry[0]}`);
  }

  if (publisher) {
    if (matchesAny(policy.publishers.deny, [publisher])) violations.push(`publisher denied by policy: ${publisher}`);
    if (policy.publishers.allow.length && !matchesAny(policy.publishers.allow, [publisher])) violations.push(`publisher is not in organization allowlist: ${publisher}`);
  }

  if (key) {
    if (matchesAny(policy.packages.deny, [key, id])) violations.push(`package denied by policy: ${key}`);
    if (policy.packages.allow.length && !matchesAny(policy.packages.allow, [key, id])) violations.push(`package is not in organization allowlist: ${key}`);
  }

  for (const permission of permissions) {
    if (matchesAny(policy.permissions.blocked, [permission])) violations.push(`permission blocked by policy: ${permission}`);
    if (matchesAny(policy.permissions.require_approval, [permission])) approvals.push(`permission requires organization approval: ${permission}`);
  }

  if (input.plan_kind === 'profile' && policy.profiles.allow.length && !matchesAny(policy.profiles.allow, [input.plan_id || ''])) {
    violations.push(`profile is not in organization allowlist: ${input.plan_id || '<unnamed>'}`);
  }
  if (input.plan_kind === 'bundle' && policy.bundles.allow.length && !matchesAny(policy.bundles.allow, [input.plan_id || ''])) {
    violations.push(`bundle is not in organization allowlist: ${input.plan_id || '<unnamed>'}`);
  }

  if (policy.lockfile.required) {
    const file = resolve(policy.lockfile.path || join(homedir(), '.dsh', 'dsh.lock'));
    if (!await pathExists(file)) violations.push(`organization lockfile is required: ${file}`);
  }

  if (approvals.length && input.approved !== true) violations.push(...approvals);
  if (!policy.enforce && violations.length) warnings.push(...violations);
  const wouldBlock = violations.length > 0;
  const approvalOnly = wouldBlock && violations.every((item) => item.startsWith('permission requires organization approval:'));
  return {
    schema_version: ENTERPRISE_POLICY_SCHEMA_VERSION,
    organization: policy.organization,
    enforce: policy.enforce,
    allowed: policy.enforce ? !wouldBlock : true,
    would_block: wouldBlock,
    code: !wouldBlock ? null : approvalOnly ? 'DSH_ENTERPRISE_APPROVAL_REQUIRED' : 'DSH_ENTERPRISE_POLICY_BLOCKED',
    violations: [...new Set(violations)],
    warnings: [...new Set(warnings)],
    package: key,
    publisher: publisher || null,
    registry: registry[0] || null,
    permissions,
  };
}

export async function enforceEnterprisePolicy(input = {}, options = {}) {
  const policy = options.policy ? normalizeEnterprisePolicy(options.policy) : await readEnterprisePolicy(options.file);
  const result = await evaluateEnterprisePolicy(policy, input);
  if (!result.allowed) {
    const error = new Error(`enterprise policy blocked operation: ${result.violations.join('; ')}`);
    error.code = result.code || 'DSH_ENTERPRISE_POLICY_BLOCKED';
    error.policyResult = result;
    throw error;
  }
  return result;
}

export async function inspectEnterprisePolicy(file = enterprisePolicyPath()) {
  const target = resolve(file);
  const configured = await pathExists(target);
  const policy = await readEnterprisePolicy(target);
  return { file: target, configured, policy };
}
