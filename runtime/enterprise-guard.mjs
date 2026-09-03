import { enforceEnterprisePolicy } from './enterprise-policy.mjs';
import { assertPackageType, parsePackageRequest } from './package-model.mjs';
import { preflightPackage } from './preflight.mjs';
import { loadRegistryFile } from './resolver.mjs';
import { findRuntimePackage, readRuntimeRegistry } from './registry.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function positional(args, index) {
  const value = args[index];
  return value && !value.startsWith('--') ? value : undefined;
}

function mutationRequest(args) {
  const command = args[0];
  if (!command) return null;
  let type = option(args, '--type', 'plugin');
  let action;
  let raw;
  let requestedVersion;

  if (['plugin', 'mcp', 'skill', 'agent'].includes(command)) {
    type = command;
    action = args[1];
    raw = positional(args, 2);
    requestedVersion = positional(args, 3);
  } else if (command === 'package') {
    action = args[1];
    raw = positional(args, 2);
  } else if (command === 'install') {
    action = 'install';
    raw = positional(args, 1);
  } else return null;

  if (!['install', 'add', 'update', 'repair'].includes(action) || !raw || String(raw).toLowerCase().endsWith('.dshpkg')) return null;
  const parsed = parsePackageRequest(raw, {
    defaultVersion: requestedVersion || '*',
    defaultType: assertPackageType(type),
    channel: option(args, '--channel', 'stable'),
    registry: option(args, '--registry') || null,
  });
  return { action: action === 'add' ? 'install' : action, parsed, requestedVersion };
}

export async function guardEnterpriseMutation(args = []) {
  const request = mutationRequest(args);
  if (!request) return null;
  const runtime = await readRuntimeRegistry(option(args, '--runtime-registry'));
  let range = request.requestedVersion || request.parsed.versionRange || '*';
  if (request.action === 'repair') {
    const current = findRuntimePackage(runtime, request.parsed.id, { type: request.parsed.type });
    if (!current) return null;
    range = current.version;
  }
  const catalogFile = option(args, '--registry', 'catalog/registry-v3.json');
  const catalog = await loadRegistryFile(catalogFile);
  const preflight = preflightPackage(catalog, `${request.parsed.type}:${request.parsed.id}@${range}`, {
    type: request.parsed.type,
    channel: request.parsed.channel,
    installed: runtime.packages,
  });
  if (!preflight.allowed) return null;
  const explicitRegistry = option(args, '--registry');
  return enforceEnterprisePolicy({
    package: {
      type: preflight.type,
      id: preflight.id,
      version: preflight.version,
      publisher: preflight.publisher,
      security: preflight.security,
      permissions: preflight.permissions.permissions,
    },
    publisher: preflight.publisher,
    permissions: preflight.permissions.permissions,
    registry: explicitRegistry || { name: 'official', trusted: true },
    approved: args.includes('--yes') || args.includes('--dry-run'),
    operation: request.action,
  });
}
