#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_ATTEMPTS = 4;
export const AUDIT_TIMEOUT_MS = 45_000;
export const RETRY_DELAY_MS = 10_000;
export const OSV_API_URL = 'https://api.osv.dev/v1/querybatch';
export const OSV_TIMEOUT_MS = 30_000;
export const OSV_MAX_ATTEMPTS = 2;
export const OSV_RETRY_DELAY_MS = 5_000;
export const OSV_BATCH_SIZE = 1_000;

const AUDIT_ARGS = ['audit', '--audit-level=high', '--fetch-retries=0', '--fetch-timeout=30000'];

const TRANSIENT_ERROR_PATTERNS = [
  /\b503\b.*service unavailable/i,
  /\b429\b.*too many requests/i,
  /\b5\d{2}\b.*(?:server error|internal server error|bad gateway|gateway timeout)/i,
  /audit endpoint returned an error/i,
  /\b(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|ENOTFOUND)\b/i,
  /network request failed/i,
];

export function buildAuditArgs() {
  return [...AUDIT_ARGS];
}

export function isTransientAuditFailure(output) {
  return TRANSIENT_ERROR_PATTERNS.some((pattern) => pattern.test(String(output)));
}

export function parseArgs(argv = []) {
  let cwd = process.cwd();
  let label = 'project';

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--cwd') {
      cwd = argv[index + 1];
      index += 1;
      if (!cwd) throw new Error('--cwd requires a directory');
    } else if (argument === '--label') {
      label = argv[index + 1];
      index += 1;
      if (!label) throw new Error('--label requires a value');
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return { cwd: resolve(cwd), label };
}

function wait(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function packageNameFromLockPath(lockPath) {
  const marker = 'node_modules/';
  const markerIndex = String(lockPath).lastIndexOf(marker);
  if (markerIndex < 0) return null;
  const segments = String(lockPath)
    .slice(markerIndex + marker.length)
    .split('/');
  if (!segments[0]) return null;
  if (segments[0].startsWith('@')) {
    return segments[1] ? `${segments[0]}/${segments[1]}` : null;
  }
  return segments[0];
}

function collectDependencyTree(dependencies, out) {
  if (!dependencies || typeof dependencies !== 'object') return;
  for (const [name, metadata] of Object.entries(dependencies)) {
    if (!metadata || typeof metadata !== 'object') continue;
    if (typeof metadata.version === 'string' && metadata.version) {
      out.push({ name, version: metadata.version });
    }
    collectDependencyTree(metadata.dependencies, out);
  }
}

export function collectLockfilePackages(lockfile) {
  const packages = [];
  for (const [lockPath, metadata] of Object.entries(lockfile?.packages || {})) {
    if (
      !metadata ||
      typeof metadata !== 'object' ||
      typeof metadata.version !== 'string' ||
      !metadata.version
    )
      continue;
    const name =
      typeof metadata.name === 'string' && metadata.name
        ? metadata.name
        : packageNameFromLockPath(lockPath);
    if (name) packages.push({ name, version: metadata.version });
  }

  if (packages.length === 0) collectDependencyTree(lockfile?.dependencies, packages);

  const unique = new Map();
  for (const dependency of packages) {
    unique.set(`${dependency.name}\u0000${dependency.version}`, dependency);
  }
  return [...unique.values()];
}

function severityRank(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value >= 9) return 4;
    if (value >= 7) return 3;
    if (value >= 4) return 2;
    if (value > 0) return 1;
    return 0;
  }
  if (typeof value !== 'string') return null;
  const normalized = value.toLowerCase();
  if (normalized.includes('critical')) return 4;
  if (normalized.includes('high')) return 3;
  if (normalized.includes('moderate') || normalized.includes('medium')) return 2;
  if (normalized.includes('low')) return 1;
  const numeric = Number.parseFloat(normalized);
  return Number.isFinite(numeric) && numeric > 0 ? severityRank(numeric) : null;
}

export function osvVulnerabilitySeverity(vulnerability) {
  const values = [
    vulnerability?.database_specific?.severity,
    ...(Array.isArray(vulnerability?.severity)
      ? vulnerability.severity.flatMap((entry) => [entry?.score, entry?.severity])
      : []),
    ...(Array.isArray(vulnerability?.affected)
      ? vulnerability.affected.flatMap((entry) => [entry?.database_specific?.severity])
      : []),
  ];
  const ranks = values.map(severityRank).filter((rank) => rank !== null);
  return ranks.length > 0 ? Math.max(...ranks) : null;
}

export function parseOsvAuditResults(payload, dependencies) {
  const findings = [];
  const results = Array.isArray(payload?.results) ? payload.results : [];
  for (let index = 0; index < results.length; index += 1) {
    const result = results[index];
    const dependency = dependencies[index] || { name: 'unknown', version: 'unknown' };
    for (const vulnerability of result?.vulns || []) {
      const rank = osvVulnerabilitySeverity(vulnerability);
      // An advisory without a usable severity is treated conservatively as high.
      if (rank === null || rank >= 3) {
        findings.push({
          id: vulnerability?.id || 'unknown-advisory',
          name: dependency.name,
          version: dependency.version,
          severity: rank === null ? 'unknown' : rank >= 4 ? 'critical' : 'high',
        });
      }
    }
  }
  const output =
    findings.length === 0
      ? `OSV fallback found no high or critical vulnerabilities in ${dependencies.length} locked packages`
      : `OSV fallback found high or critical vulnerabilities:\n${findings.map((finding) => `${finding.severity} ${finding.id} ${finding.name}@${finding.version}`).join('\n')}`;
  return { code: findings.length === 0 ? 0 : 1, output, findings };
}

async function fetchOsvBatch({ fetchImpl, queries, timeoutMs, apiUrl }) {
  const controller = new AbortController();
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      controller.abort();
      reject(new Error(`OSV API request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    const response = await Promise.race([
      fetchImpl(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ queries }),
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);
    if (!response?.ok) throw new Error(`OSV API returned HTTP ${response?.status ?? 'unknown'}`);
    const payload =
      typeof response.json === 'function'
        ? await response.json()
        : JSON.parse(await response.text());
    if (!Array.isArray(payload?.results) || payload.results.length !== queries.length) {
      throw new Error('OSV API returned an invalid batch response');
    }
    return payload;
  } finally {
    clearTimeout(timeoutHandle);
  }
}

/**
 * @typedef {Object} OsvAuditOptions
 * @property {string} [cwd]
 * @property {typeof fetch} [fetchImpl]
 * @property {typeof readFile} [readFileImpl]
 * @property {(milliseconds: number) => Promise<void>} [sleep]
 * @property {number} [timeoutMs]
 * @property {number} [maxAttempts]
 * @property {number} [retryDelayMs]
 * @property {string} [apiUrl]
 */

/** @param {OsvAuditOptions} [options] */
export async function runOsvAudit({
  cwd,
  fetchImpl = fetch,
  readFileImpl = readFile,
  sleep = wait,
  timeoutMs = OSV_TIMEOUT_MS,
  maxAttempts = OSV_MAX_ATTEMPTS,
  retryDelayMs = OSV_RETRY_DELAY_MS,
  apiUrl = process.env.OSV_API_URL || OSV_API_URL,
} = {}) {
  let dependencies;
  try {
    const lockfile = JSON.parse(await readFileImpl(join(cwd, 'package-lock.json'), 'utf8'));
    dependencies = collectLockfilePackages(lockfile);
  } catch (error) {
    return { code: 1, output: `OSV fallback could not read package-lock.json: ${error.message}` };
  }
  if (dependencies.length === 0) {
    return { code: 1, output: 'OSV fallback found no locked npm packages' };
  }

  const queries = dependencies.map((dependency) => ({
    package: { name: dependency.name, ecosystem: 'npm' },
    version: dependency.version,
  }));
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const payloads = [];
      for (let index = 0; index < queries.length; index += OSV_BATCH_SIZE) {
        payloads.push(
          await fetchOsvBatch({
            fetchImpl,
            queries: queries.slice(index, index + OSV_BATCH_SIZE),
            timeoutMs,
            apiUrl,
          }),
        );
      }
      const results = payloads.flatMap((payload) => payload.results);
      return parseOsvAuditResults({ results }, dependencies);
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts) await sleep(attempt * retryDelayMs);
    }
  }
  return {
    code: 1,
    output: `OSV fallback failed after ${maxAttempts} attempts: ${lastError?.message || 'unknown error'}`,
  };
}

/**
 * @param {{ cwd?: string, timeoutMs?: number, killGraceMs?: number, cleanupGraceMs?: number, spawnImpl?: typeof spawn }} [options]
 */
export function runAudit({
  cwd,
  timeoutMs = AUDIT_TIMEOUT_MS,
  killGraceMs = 5_000,
  cleanupGraceMs = 5_000,
  spawnImpl = spawn,
} = {}) {
  return new Promise((resolvePromise) => {
    const command = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawnImpl(command, buildAuditArgs(), {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    let settled = false;
    let timedOut = false;
    let killHandle;
    let cleanupHandle;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* process exited between checks */
      }
      killHandle = setTimeout(() => {
        if (settled) return;
        try {
          child.kill('SIGKILL');
        } catch {
          /* process exited between checks */
        }
        cleanupHandle = setTimeout(() => {
          if (settled) return;
          finish(124, 'SIGKILL', true);
        }, cleanupGraceMs);
        cleanupHandle.unref?.();
      }, killGraceMs);
      killHandle.unref?.();
    }, timeoutMs);
    timeoutHandle.unref?.();

    const writeOutput = (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    };

    const finish = (code, signal = null, processCleanupFailed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      clearTimeout(cleanupHandle);
      resolvePromise({
        code: code ?? 1,
        output: timedOut ? `${output}\nnpm audit process timed out` : output,
        signal,
        timedOut,
        process_cleanup_failed: processCleanupFailed,
      });
    };

    child.stdout?.on('data', writeOutput);
    child.stderr?.on('data', writeOutput);
    child.once('error', (error) => {
      writeOutput(`${error.message}\n`);
      finish(1);
    });
    child.once('close', finish);
  });
}

export async function run(argv = process.argv.slice(2), dependencies = {}) {
  const { cwd, label } = parseArgs(argv);
  const {
    audit = runAudit,
    fallbackAudit = runOsvAudit,
    sleep = wait,
    maxAttempts = MAX_ATTEMPTS,
    retryDelayMs = RETRY_DELAY_MS,
  } = dependencies;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    console.log(`Running npm audit for ${label} (attempt ${attempt}/${maxAttempts})`);
    const result = await audit({ cwd });
    if (result.code === 0) return 0;

    const retryable = result.timedOut || isTransientAuditFailure(result.output);
    if (!retryable || attempt === maxAttempts) {
      if (retryable && attempt === maxAttempts) {
        console.warn(`Primary npm audit service unavailable for ${label}; running OSV fallback`);
        const fallbackResult = await fallbackAudit({ cwd, label });
        if (fallbackResult.code === 0) {
          console.warn(
            `OSV fallback passed for ${label}; continuing after transient npm audit outage`,
          );
          return 0;
        }
        if (fallbackResult.output) console.error(fallbackResult.output);
      }
      console.error(`npm audit failed for ${label}; refusing to continue`);
      return result.code || 1;
    }

    const delay = attempt * retryDelayMs;
    console.warn(`Transient npm audit failure for ${label}; retrying in ${delay}ms`);
    await sleep(delay);
  }

  return 1;
}

const entrypoint = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : '';
if (import.meta.url === entrypoint) {
  run()
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
