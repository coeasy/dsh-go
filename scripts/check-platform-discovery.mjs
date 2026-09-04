#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_TYPES = ['plugin', 'mcp', 'skill', 'agent'];
const REQUIRED_CHANNELS = ['stable', 'beta', 'nightly', 'dev'];
const REQUIRED_LOCALES = ['en', 'zh-CN', 'ja', 'ko', 'es'];
const REQUIRED_DEPLOYMENTS = ['cloudflare-pages', 'github-pages', 'edgeone-pages'];
const REQUIRED_API_ENDPOINTS = [
  'index',
  'health',
  'capabilities',
  'packages',
  'package_detail',
  'package_releases',
  'search',
  'resolve',
  'install_plan',
  'publishers',
  'advisories',
  'registry_revision',
  'registry_delta',
  'mcp',
];

function sameArray(actual, expected) {
  return Array.isArray(actual)
    && actual.length === expected.length
    && actual.every((value, index) => value === expected[index]);
}

function absoluteHttpUrl(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function validatePlatformDiscovery(document) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { valid: false, errors: ['discovery manifest must be an object'] };
  }

  if (document.schema !== 'dsh-marketplace-discovery.v2') errors.push('schema must be dsh-marketplace-discovery.v2');
  if (document.service?.id !== 'dsh-go') errors.push('service.id must be dsh-go');
  if (!String(document.service?.version || '').trim()) errors.push('service.version is required');
  if (document.service?.mode !== 'read-only-discovery') errors.push('service.mode must be read-only-discovery');

  if (document.protocol?.version !== 2) errors.push('protocol.version must be 2');
  if (!sameArray(document.protocol?.package_types, REQUIRED_TYPES)) errors.push('protocol.package_types must be plugin,mcp,skill,agent');
  if (!sameArray(document.protocol?.release_channels, REQUIRED_CHANNELS)) errors.push('protocol.release_channels must be stable,beta,nightly,dev');
  if (document.protocol?.package_coordinate !== '<type>:<id>@<semver-range>') errors.push('protocol.package_coordinate must declare the canonical V2 coordinate');

  if (document.api?.version !== 'v2') errors.push('api.version must be v2');
  if (!absoluteHttpUrl(document.api?.base_url)) errors.push('api.base_url must be an absolute HTTP(S) URL');
  if (!absoluteHttpUrl(document.api?.openapi_url)) errors.push('api.openapi_url must be an absolute HTTP(S) URL');
  for (const name of REQUIRED_API_ENDPOINTS) {
    const value = document.api?.[name];
    if (typeof value !== 'string' || !value.startsWith('/api/v2')) errors.push(`api.${name} must be a canonical /api/v2 endpoint`);
  }

  if (document.registry?.version !== 4) errors.push('registry.version must be 4');
  if (document.registry?.authority_path !== '/catalog/registry-v4.json') errors.push('registry.authority_path must be /catalog/registry-v4.json');
  if (document.registry?.distribution?.version !== 2) errors.push('registry.distribution.version must be 2');
  if (document.registry?.distribution?.index_path !== '/catalog/registry-v4/index.json') errors.push('registry.distribution.index_path must be /catalog/registry-v4/index.json');
  if (document.registry?.search_index?.version !== 3) errors.push('registry.search_index.version must be 3');
  if (document.registry?.search_index?.path !== '/catalog/search-index-v3.json') errors.push('registry.search_index.path must be /catalog/search-index-v3.json');

  if (Number(document.marketplace?.detail_min_stars) < 200) errors.push('marketplace.detail_min_stars must be at least 200');
  if (document.marketplace?.trust_is_popularity !== false) errors.push('marketplace.trust_is_popularity must be false');
  if (!sameArray(document.marketplace?.locales, REQUIRED_LOCALES)) errors.push('marketplace.locales must be en,zh-CN,ja,ko,es');

  if (document.installation?.remote_mode !== 'plan-only') errors.push('installation.remote_mode must be plan-only');
  if (document.installation?.remote_mutation !== false) errors.push('installation.remote_mutation must be false');
  if (document.installation?.local_runtime_is_write_authority !== true) errors.push('installation.local_runtime_is_write_authority must be true');
  if (document.installation?.cli_template !== 'dsh package install {type}:{id}@{range}') errors.push('installation.cli_template must use the canonical package command');
  if (!String(document.installation?.deep_link_template || '').startsWith('dsh://package/install?spec=')) errors.push('installation.deep_link_template must use dsh://package/install');
  if (document.installation?.deep_link_registry_override !== false) errors.push('installation.deep_link_registry_override must be false');
  if (document.installation?.explicit_confirmation_required !== true) errors.push('installation must require explicit confirmation');
  if (document.installation?.auto_restart !== false) errors.push('installation.auto_restart must be false');

  const deployments = Array.isArray(document.deployments) ? document.deployments : [];
  const deploymentIds = deployments.map((entry) => entry?.id);
  for (const id of REQUIRED_DEPLOYMENTS) if (!deploymentIds.includes(id)) errors.push('deployments must include ' + id);
  const cloudflare = deployments.find((entry) => entry?.id === 'cloudflare-pages');
  if (cloudflare && (cloudflare.role !== 'api-and-static-authority' || cloudflare.api !== true || cloudflare.static !== true)) {
    errors.push('cloudflare-pages must be the API and static authority');
  }
  for (const id of ['github-pages', 'edgeone-pages']) {
    const replica = deployments.find((entry) => entry?.id === id);
    if (replica && (replica.role !== 'static-replica' || replica.api !== false || replica.static !== true)) {
      errors.push(`${id} must be a static replica`);
    }
  }

  return { valid: errors.length === 0, errors };
}

export function buildDiscoveryUrl(baseUrl) {
  if (!baseUrl) throw new Error('A platform base URL is required');
  const base = new URL(baseUrl);
  const inheritedSearch = base.search;
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const result = new URL('.well-known/dsh-marketplace.json', base);
  result.search = inheritedSearch;
  return result;
}

export function safeDisplayUrl(value) {
  const url = new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error('Unknown argument: ' + arg);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error('Missing value for --' + key);
    result[key] = value;
    index += 1;
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkPlatformDiscovery({
  baseUrl,
  label = 'Platform',
  target,
  attempts = 12,
  delayMs = 5_000,
  timeoutMs = 20_000,
  fetchImpl = fetch,
  wait = sleep,
  log = console.log,
} = {}) {
  if (!baseUrl) throw new Error('A platform base URL is required');
  const url = buildDiscoveryUrl(baseUrl);
  let lastProblem = 'no response received';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(url, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache, no-store, max-age=0' },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (response.ok) {
        const document = await response.json();
        const report = validatePlatformDiscovery(document);
        if (report.valid && (!target || document.deployments.some((entry) => entry.id === target))) {
          log(label + ' platform discovery verified: ' + safeDisplayUrl(url));
          return { url, document };
        }
        lastProblem = report.errors.join('; ') || 'deployment target not declared: ' + target;
      } else {
        lastProblem = 'HTTP ' + response.status;
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }
    if (attempt < attempts) {
      log(label + ' platform discovery not converged (' + attempt + '/' + attempts + '): ' + lastProblem);
      await wait(delayMs);
    }
  }
  throw new Error(label + ' platform discovery failed after ' + attempts + ' attempts: ' + lastProblem);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.file) {
    const document = JSON.parse(await readFile(args.file, 'utf8'));
    const report = validatePlatformDiscovery(document);
    if (!report.valid) throw new Error(report.errors.join('; '));
    console.log('Platform discovery manifest is valid: ' + args.file);
    return;
  }
  await checkPlatformDiscovery({
    baseUrl: args['base-url'],
    label: args.label || 'Platform',
    target: args.target,
    attempts: args.attempts ? Number(args.attempts) : undefined,
    delayMs: args['delay-ms'] ? Number(args['delay-ms']) : undefined,
    timeoutMs: args['timeout-ms'] ? Number(args['timeout-ms']) : undefined,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
