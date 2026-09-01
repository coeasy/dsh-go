#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const REQUIRED_TYPES = ['plugin', 'mcp', 'skill', 'agent'];
const REQUIRED_DEPLOYMENTS = ['cloudflare-pages', 'github-pages', 'edgeone-pages'];
const REQUIRED_ENDPOINTS = ['health', 'capabilities', 'registry', 'registry_delta', 'mcp'];

export function validatePlatformDiscovery(document) {
  const errors = [];
  if (!document || typeof document !== 'object' || Array.isArray(document)) {
    return { valid: false, errors: ['discovery manifest must be an object'] };
  }
  if (document.schema !== 'dsh-marketplace-discovery.v1') errors.push('schema must be dsh-marketplace-discovery.v1');
  if (document.service?.id !== 'dsh-go') errors.push('service.id must be dsh-go');
  if (document.service?.version !== '0.1.0') errors.push('service.version must be 0.1.0');
  if (document.service?.mode !== 'read-only') errors.push('service.mode must be read-only');
  if (document.api?.version !== 'v1') errors.push('api.version must be v1');
  if (!/^https?:\\/\\//.test(String(document.api?.base_url || ''))) errors.push('api.base_url must be an absolute URL');
  if (document.registry?.version !== 3) errors.push('registry.version must be 3');
  if (typeof document.registry?.distribution?.index_path !== 'string') errors.push('registry.distribution.index_path is required');
  if (document.registry?.distribution?.version !== 1) errors.push('registry.distribution.version must be 1');
  if (JSON.stringify(document.package_types) !== JSON.stringify(REQUIRED_TYPES)) errors.push('package_types must be plugin,mcp,skill,agent');
  if (document.installation?.mode !== 'plan-only') errors.push('installation.mode must be plan-only');
  if (document.installation?.deep_link_scheme !== 'dsh') errors.push('installation.deep_link_scheme must be dsh');
  if (document.installation?.explicit_confirmation_required !== true) errors.push('installation must require explicit confirmation');
  if (document.installation?.restart_required_after_install !== true) errors.push('installation must declare restart_required_after_install');
  const endpoints = document.api?.endpoints;
  if (endpoints && typeof endpoints === 'object') {
    for (const name of REQUIRED_ENDPOINTS) if (typeof endpoints[name] !== 'string') errors.push('api.endpoints.' + name + ' is required');
  } else {
    for (const name of REQUIRED_ENDPOINTS) if (typeof document.api?.[name] !== 'string') errors.push('api.' + name + ' is required');
  }
  const deploymentIds = Array.isArray(document.deployments) ? document.deployments.map((entry) => entry?.id) : [];
  for (const id of REQUIRED_DEPLOYMENTS) if (!deploymentIds.includes(id)) errors.push('deployments must include ' + id);
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
