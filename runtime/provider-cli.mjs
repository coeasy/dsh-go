#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { resolveProviderAdapter, searchProviderAdapters } from './provider-adapter-registry.mjs';
import {
  installProviderAdapterRelease,
  listInstalledProviderAdapters,
  loadProviderAdapterRegistry,
  providerAdapterStatus,
  rollbackInstalledProviderAdapter,
} from './provider-store.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function has(args, name) {
  return args.includes(name);
}

function positional(args, index) {
  const values = args.filter((value, valueIndex) => {
    if (value.startsWith('--')) return false;
    const previous = args[valueIndex - 1];
    return !previous?.startsWith('--');
  });
  return values[index];
}

function parseProviderSpec(raw) {
  const value = String(raw || '').trim();
  if (!value) throw new Error('provider adapter id is required');
  const at = value.lastIndexOf('@');
  return at > 0
    ? { id: value.slice(0, at), selector: value.slice(at + 1) || null }
    : { id: value, selector: null };
}

function summarizeGroup(group) {
  const latest = group.versions.at(-1) || null;
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    kind: group.kind,
    channels: group.channels,
    versions: group.versions.map((release) => release.version),
    latest: latest ? { version: latest.version, release_id: latest.release_id, capabilities: latest.capabilities } : null,
  };
}

async function marketplace(args) {
  return loadProviderAdapterRegistry(option(args, '--registry', ''));
}

async function installCommand(args, update = false) {
  const spec = parseProviderSpec(positional(args, 1));
  const registry = await marketplace(args);
  let selector = spec.selector || option(args, '--version') || option(args, '--channel');
  if (update && !selector) {
    const current = await providerAdapterStatus(spec.id, { home: option(args, '--root') });
    selector = current.installed ? current.channel : 'stable';
  }
  selector ||= 'stable';
  const release = resolveProviderAdapter(registry, spec.id, selector);
  if (has(args, '--dry-run')) {
    return {
      action: update ? 'update' : 'install',
      id: release.id,
      version: release.version,
      selector,
      release_id: release.release_id,
      artifact: release.artifact,
      restart_required: true,
      executed: false,
    };
  }
  return installProviderAdapterRelease(release, {
    home: option(args, '--root'),
    channel: option(args, '--channel') || (['stable', 'beta', 'nightly', 'dev'].includes(selector) ? selector : release.release.channel),
  });
}

export async function runProviderCli(args = process.argv.slice(2)) {
  const action = args[0] || 'list';
  if (action === 'list') {
    if (has(args, '--installed')) return { providers: await listInstalledProviderAdapters({ home: option(args, '--root') }) };
    const registry = await marketplace(args);
    return {
      registry_version: registry.registry_version,
      content_hash: registry.generated.content_hash,
      providers: registry.providers.map(summarizeGroup),
    };
  }
  if (action === 'search') {
    const query = positional(args, 1) || '';
    const registry = await marketplace(args);
    return { query, providers: searchProviderAdapters(registry, query).map(summarizeGroup) };
  }
  if (action === 'info') {
    const spec = parseProviderSpec(positional(args, 1));
    const registry = await marketplace(args);
    const group = registry.providers.find((item) => item.id.toLowerCase() === spec.id.toLowerCase());
    if (!group) throw new Error(`provider adapter not found: ${spec.id}`);
    const selector = spec.selector || option(args, '--version') || option(args, '--channel');
    return {
      ...group,
      selected: selector ? resolveProviderAdapter(registry, spec.id, selector) : null,
      installed: await providerAdapterStatus(spec.id, { home: option(args, '--root') }),
    };
  }
  if (action === 'install') return installCommand(args, false);
  if (action === 'update') return installCommand(args, true);
  if (action === 'rollback') {
    const id = positional(args, 1);
    if (!id) throw new Error('provider rollback requires id');
    const version = positional(args, 2) || option(args, '--version') || null;
    if (has(args, '--dry-run')) {
      const current = await providerAdapterStatus(id, { home: option(args, '--root') });
      const target = version || current.history?.at(-1) || null;
      return { action: 'rollback', id, from: current.active_version, to: target, executed: false, restart_required: Boolean(target && target !== current.active_version) };
    }
    return rollbackInstalledProviderAdapter(id, version, { home: option(args, '--root') });
  }
  if (action === 'status') {
    const id = positional(args, 1);
    if (!id) throw new Error('provider status requires id');
    return providerAdapterStatus(id, { home: option(args, '--root') });
  }
  throw new Error(`unknown provider adapter action: ${action}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runProviderCli().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`[dsh-provider] ${error.stack || error.message}`);
    process.exit(1);
  });
}
