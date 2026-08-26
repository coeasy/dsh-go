#!/usr/bin/env node

import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const DEFAULT_REGISTRY_PATH = 'catalog/registry-v3.json';
const DEFAULT_ATTEMPTS = 9;
const DEFAULT_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 20_000;

export function buildRegistryUrl(baseUrl) {
  const base = new URL(baseUrl);
  const inheritedSearch = base.search;
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  const registryUrl = new URL('catalog/registry-v3.json', base);
  registryUrl.search = inheritedSearch;
  return registryUrl;
}

export function safeDisplayUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function expectedRegistryState(registry) {
  if (!registry || registry.registry_version !== 3) {
    throw new Error('Local Registry must use registry_version=3');
  }
  const hash = registry.generated?.content_hash;
  if (typeof hash !== 'string' || hash.length === 0) {
    throw new Error('Local Registry is missing generated.content_hash');
  }
  if (!Array.isArray(registry.plugins)) {
    throw new Error('Local Registry is missing plugins[]');
  }
  return { version: 3, hash, count: registry.plugins.length };
}

export function deployedRegistryState(registry) {
  return {
    version: registry?.registry_version,
    hash: registry?.generated?.content_hash,
    count: Array.isArray(registry?.plugins) ? registry.plugins.length : -1,
  };
}

export function registryMatches(expected, deployed) {
  const actual = deployedRegistryState(deployed);
  return actual.version === expected.version && actual.hash === expected.hash && actual.count === expected.count;
}

export function describeRegistryMismatch(expected, deployed) {
  const actual = deployedRegistryState(deployed);
  return `expected version=${expected.version} hash=${expected.hash} count=${expected.count}; got version=${String(actual.version)} hash=${String(actual.hash)} count=${actual.count}`;
}

function parsePositiveInt(value, name, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith('--')) throw new Error(`Unknown argument: ${arg}`);
    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
    result[key] = value;
    index += 1;
  }
  return result;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkDeploymentConvergence({
  baseUrl,
  label = 'Deployment',
  registryPath = DEFAULT_REGISTRY_PATH,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  log = console.log,
  wait = sleep,
}) {
  if (!baseUrl) throw new Error('A deployment base URL is required');

  const localRegistry = JSON.parse(await readFile(registryPath, 'utf8'));
  const expected = expectedRegistryState(localRegistry);
  const registryUrl = buildRegistryUrl(baseUrl);
  const safeUrl = safeDisplayUrl(registryUrl);
  let lastProblem = 'no response received';

  log(`${label} convergence target: ${safeUrl}`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(registryUrl, {
        headers: { accept: 'application/json', 'cache-control': 'no-cache' },
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) {
        lastProblem = `HTTP ${response.status}`;
      } else {
        const deployed = await response.json();
        if (registryMatches(expected, deployed)) {
          log(`${label} Registry V3 converged: hash=${expected.hash}, count=${expected.count}`);
          return { expected, registryUrl };
        }
        lastProblem = describeRegistryMismatch(expected, deployed);
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      log(`${label} not converged (${attempt}/${attempts}): ${lastProblem}`);
      await wait(delayMs);
    }
  }

  throw new Error(`${label} did not converge to the exact Registry V3 revision after ${attempts} attempts: ${lastProblem}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args['base-url'] || process.env.DEPLOY_BASE_URL;
  const label = args.label || process.env.DEPLOY_LABEL || 'Deployment';
  const registryPath = args.registry || process.env.DEPLOY_REGISTRY_PATH || DEFAULT_REGISTRY_PATH;
  const attempts = parsePositiveInt(args.attempts || process.env.DEPLOY_CONVERGENCE_ATTEMPTS, 'attempts', DEFAULT_ATTEMPTS, 1, 30);
  const delayMs = parsePositiveInt(args['delay-ms'] || process.env.DEPLOY_CONVERGENCE_DELAY_MS, 'delay-ms', DEFAULT_DELAY_MS, 0, 120_000);
  const timeoutMs = parsePositiveInt(args['timeout-ms'] || process.env.DEPLOY_CONVERGENCE_TIMEOUT_MS, 'timeout-ms', DEFAULT_TIMEOUT_MS, 1_000, 120_000);

  await checkDeploymentConvergence({ baseUrl, label, registryPath, attempts, delayMs, timeoutMs });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
