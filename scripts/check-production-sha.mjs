#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_DELAY_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 20_000;
const CACHE_BUSTER = '__dsh_sha_gate';

export function validateExpectedSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('EXPECTED_DEPLOYMENT_SHA must be an exact 40-character commit SHA');
  }
  return sha;
}

export function buildVersionUrl(baseUrl, nonce = Date.now()) {
  if (!baseUrl) throw new Error('A deployment base URL is required');
  const base = new URL(baseUrl);
  const inheritedSearch = new URLSearchParams(base.search);
  base.search = '';
  base.hash = '';
  if (!base.pathname.endsWith('/')) base.pathname += '/';

  const versionUrl = new URL('version.json', base);
  for (const [key, value] of inheritedSearch.entries()) versionUrl.searchParams.append(key, value);
  versionUrl.searchParams.set(CACHE_BUSTER, String(nonce));
  return versionUrl;
}

export function safeDisplayUrl(value) {
  const url = value instanceof URL ? new URL(value) : new URL(value);
  url.search = '';
  url.hash = '';
  return url.toString();
}

export function deployedVersionSha(metadata) {
  const value = metadata?.git_sha;
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function versionMatches(expectedSha, metadata) {
  return validateExpectedSha(expectedSha) === deployedVersionSha(metadata);
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

function writeGithubOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  const safeValue = String(value ?? '').replaceAll('\r', ' ').replaceAll('\n', ' ').slice(0, 1000);
  appendFileSync(outputFile, `${name}=${safeValue}\n`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function checkProductionSha({
  baseUrl,
  expectedSha,
  label = 'Production',
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  fetchImpl = fetch,
  log = console.log,
  wait = sleep,
  nonceFactory = (attempt) => `${Date.now()}-${attempt}`,
} = {}) {
  if (!baseUrl) throw new Error('A deployment base URL is required');
  const expected = validateExpectedSha(expectedSha);
  let lastProblem = 'no response received';
  let lastUrl = buildVersionUrl(baseUrl, nonceFactory(0));

  log(`${label} SHA target: ${safeDisplayUrl(lastUrl)} expected=${expected}`);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    lastUrl = buildVersionUrl(baseUrl, nonceFactory(attempt));
    try {
      const response = await fetchImpl(lastUrl, {
        headers: {
          accept: 'application/json',
          'cache-control': 'no-cache, no-store, max-age=0',
          pragma: 'no-cache',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        lastProblem = `HTTP ${response.status}`;
      } else {
        const metadata = await response.json();
        const actual = deployedVersionSha(metadata);
        if (actual === expected) {
          log(`${label} SHA verified: ${expected}`);
          return { expectedSha: expected, actualSha: actual, versionUrl: lastUrl, metadata };
        }
        lastProblem = actual ? `expected SHA=${expected}; got SHA=${actual}` : 'version.json is missing git_sha';
      }
    } catch (error) {
      lastProblem = error instanceof Error ? error.message : String(error);
    }

    if (attempt < attempts) {
      log(`${label} SHA not converged (${attempt}/${attempts}): ${lastProblem}`);
      await wait(delayMs);
    }
  }

  throw new Error(`${label} did not converge to commit ${expected} after ${attempts} attempts: ${lastProblem}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const baseUrl = args['base-url'] || process.env.DEPLOY_BASE_URL;
  const expectedSha = args.sha || process.env.EXPECTED_DEPLOYMENT_SHA || process.env.DEPLOYMENT_SHA;
  const label = args.label || process.env.DEPLOY_LABEL || 'Production';
  const attempts = parsePositiveInt(args.attempts || process.env.DEPLOY_SHA_ATTEMPTS, 'attempts', DEFAULT_ATTEMPTS, 1, 30);
  const delayMs = parsePositiveInt(args['delay-ms'] || process.env.DEPLOY_SHA_DELAY_MS, 'delay-ms', DEFAULT_DELAY_MS, 0, 120_000);
  const timeoutMs = parsePositiveInt(args['timeout-ms'] || process.env.DEPLOY_SHA_TIMEOUT_MS, 'timeout-ms', DEFAULT_TIMEOUT_MS, 1_000, 120_000);

  try {
    const result = await checkProductionSha({ baseUrl, expectedSha, label, attempts, delayMs, timeoutMs });
    writeGithubOutput('actual_sha', result.actualSha);
    writeGithubOutput('version_url', safeDisplayUrl(result.versionUrl));
    writeGithubOutput('problem', 'none');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeGithubOutput('actual_sha', '');
    writeGithubOutput('problem', message);
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
