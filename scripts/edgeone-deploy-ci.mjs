#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkProductionSha } from './check-production-sha.mjs';

const MIN_CLI_VERSION = [1, 6, 0];
const DEFAULT_CLI_VERSION = '1.6.28';
const DEFAULT_PROJECT = 'dsh-go';
const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_SECONDS = 240;
const DEFAULT_VERIFY_ATTEMPTS = 6;
const DEFAULT_VERIFY_DELAY_MS = 5_000;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;
const EDGEONE_API_ENDPOINTS = Object.freeze({
  china: 'https://pages-api.cloud.tencent.com/v1',
  global: 'https://pages-api.edgeone.ai/v1',
});

export function validateCliVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value || '');
  if (!match) throw new Error('EDGEONE_CLI_VERSION must be a pinned semver');
  const version = match.slice(1, 4).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > MIN_CLI_VERSION[index]) return value;
    if (version[index] < MIN_CLI_VERSION[index])
      throw new Error('EdgeOne CLI >= 1.6.0 is required');
  }
  return value;
}

export function resolveProject(env = process.env) {
  const project = env.EDGEONE_PROJECT || DEFAULT_PROJECT;
  const expectedProject = env.EDGEONE_EXPECTED_PROJECT || DEFAULT_PROJECT;
  if (project !== expectedProject) {
    throw new Error(`EdgeOne project mismatch: expected=${expectedProject} actual=${project}`);
  }
  return project;
}

export function sanitizeLog(value, token = '') {
  let text = String(value ?? '');
  if (token) text = text.split(token).join('***');
  return text
    .replace(/([?&](?:eo_)?token=)[^&\s"'<>]+/gi, '$1***')
    .replace(/("(?:token|apiToken|accessToken)"\s*:\s*")[^"]+("?)/gi, '$1***$2')
    .replace(/(authorization\s*:\s*bearer\s+)[^\s]+/gi, '$1***');
}

export function cliTransferDiagnostics(value, token = '') {
  const lines = String(value ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const relevant = lines
    .filter((line) =>
      /uploadToEdgeOneCOS|uploadFiles|upload successful|file uploaded|targetPath|CreatePagesDeployment|DistType|scanning directory|found \d+ files|deployment/i.test(
        line,
      ),
    )
    .slice(-24);
  return relevant.map((line) => sanitizeLog(line, token)).join('\n');
}

export function classifyFailure(text, status = 1, timedOut = false) {
  const value = String(text ?? '');
  if (timedOut || status === 124 || status === 137) return 'transport';
  if (
    /has finished versions|uploads? are only allowed for the latest version|only latest version can upload/i.test(
      value,
    )
  ) {
    return 'version_state';
  }
  if (
    /(^|[^0-9])(401|403)([^0-9]|$)|unauthori[sz]ed|forbidden|invalid[ _-]*token|token.*(expired|invalid)|authentication failed|permission denied|not logged in|login required/i.test(
      value,
    )
  ) {
    return 'authentication';
  }
  if (
    /(^|[^0-9])429([^0-9]|$)|rate[ _-]*limit|quota|exceed(?:ed|s)? .*limit|project exceeds [0-9]+ limit/i.test(
      value,
    )
  ) {
    return 'quota';
  }
  if (
    /(^|[^0-9])409([^0-9]|$)|(?:project|name).*(?:conflict|duplicate)|duplicate project|cannot create .*project|project .*already exists(?![. ]+using existing project)/i.test(
      value,
    )
  ) {
    return 'project_conflict';
  }
  if (status === 0) return 'protocol';
  if (
    /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|TLS|certificate|connection reset|connection refused/i.test(
      value,
    )
  ) {
    return 'transport';
  }
  return 'api';
}

export function parseLastJson(text) {
  const value = String(text ?? '');
  let last = null;
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (start < 0) {
      if (char === '{') {
        start = index;
        depth = 1;
        inString = false;
        escaped = false;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
    } else if (char === '{') {
      depth += 1;
    } else if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        const candidate = value.slice(start, index + 1);
        try {
          last = JSON.parse(candidate);
        } catch {
          // Ignore non-JSON brace blocks emitted by dependencies.
        }
        start = -1;
      }
    }
  }

  return last;
}

export function validateDeployResult(result) {
  if (
    !result ||
    result.status !== 'success' ||
    typeof result.url !== 'string' ||
    result.url.length === 0 ||
    result.projectId === undefined ||
    result.projectId === null ||
    String(result.projectId).length === 0 ||
    result.deploymentId === undefined ||
    result.deploymentId === null ||
    String(result.deploymentId).length === 0
  ) {
    throw new Error('EdgeOne CLI returned an invalid success payload');
  }
  return result;
}

export function buildDeployArgs({ project, token, cliVersion, directory = './' }) {
  const args = ['--yes', `edgeone@${cliVersion}`, 'makers', 'deploy'];
  if (directory) args.push(directory);
  args.push('-n', project, '-t', token, '-e', 'production', '--json');
  return args;
}

export function resolveUploadSpec(env = process.env) {
  const mode = String(env.EDGEONE_UPLOAD_MODE || 'directory')
    .trim()
    .toLowerCase();
  if (mode === 'auto') {
    const cwd = String(env.EDGEONE_UPLOAD_CWD || './site').trim();
    if (!cwd) throw new Error('EDGEONE_UPLOAD_CWD must be a non-empty path');
    return { directory: '', cwd };
  }
  if (mode !== 'directory') throw new Error('EDGEONE_UPLOAD_MODE must be directory or auto');

  const directory = String(env.EDGEONE_UPLOAD_PATH || './').trim();
  if (!directory) throw new Error('EDGEONE_UPLOAD_PATH must be a non-empty path');

  const cwd = String(env.EDGEONE_UPLOAD_CWD || (directory === './' ? './site/dist' : '.')).trim();
  if (!cwd) throw new Error('EDGEONE_UPLOAD_CWD must be a non-empty path');

  return { directory, cwd };
}

function parseBoundedInt(value, name, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

function appendBounded(current, chunk) {
  const value = current + chunk;
  return value.length > MAX_CAPTURE_BYTES ? value.slice(-MAX_CAPTURE_BYTES) : value;
}

export function runProcess(command, args, { timeoutMs, env = process.env, cwd } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let killTimer;
    let cleanupTimer;

    const child = spawn(command, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => {
      stdout = appendBounded(stdout, chunk.toString());
    });
    child.stderr.on('data', (chunk) => {
      stderr = appendBounded(stderr, chunk.toString());
    });

    const timeout = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          try {
            child.kill('SIGTERM');
          } catch {
            /* process exited between checks */
          }
          killTimer = setTimeout(() => {
            if (settled) return;
            try {
              child.kill('SIGKILL');
            } catch {
              /* process exited between checks */
            }
            cleanupTimer = setTimeout(() => {
              if (settled) return;
              settled = true;
              if (timeout) clearTimeout(timeout);
              if (killTimer) clearTimeout(killTimer);
              resolve({ code: 124, stdout, stderr, timedOut: true, process_cleanup_failed: true });
            }, 5_000);
            cleanupTimer.unref?.();
          }, 5_000);
          killTimer.unref?.();
        }, timeoutMs)
      : null;
    timeout?.unref?.();

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      resolve({
        code: timedOut ? 124 : (code ?? 1),
        stdout,
        stderr,
        timedOut,
        process_cleanup_failed: false,
      });
    };

    child.on('error', (error) => {
      stderr = appendBounded(stderr, error.message);
      finish(127);
    });
    child.on('close', finish);
  });
}

function writeOutput(name, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (!outputFile) return;
  appendFileSync(outputFile, `${name}=${String(value)}\n`);
}

function writeStepSummary(lines) {
  const summaryFile = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryFile) return;
  appendFileSync(summaryFile, `${lines.join('\n')}\n`);
}

export function writeDiagnostic(env, payload, token = '') {
  const diagnosticFile = env.EDGEONE_DIAGNOSTIC_FILE;
  if (!diagnosticFile) return;
  const safePayload = {
    ...payload,
    error: payload.error ? sanitizeLog(payload.error, token) : undefined,
  };
  writeFileSync(diagnosticFile, `${JSON.stringify(safePayload, null, 2)}\n`, { mode: 0o600 });
}

function annotationValue(value) {
  return String(value)
    .replaceAll('%', '%25')
    .replaceAll('\r', '%0D')
    .replaceAll('\n', '%0A')
    .slice(0, 900);
}

function tailLines(value, count = 20) {
  return String(value).split(/\r?\n/).slice(-count).join('\n').trim();
}

function edgeOneProcessEnv(env) {
  return { ...env, PAGES_SOURCE: env.PAGES_SOURCE || 'skills' };
}

function hasSignedAccessQuery(value) {
  const url = new URL(value);
  return url.searchParams.has('eo_token') && url.searchParams.has('eo_time');
}

function apiEndpoints(env) {
  const region = String(env.EDGEONE_PAGES_API_REGION || '')
    .trim()
    .toLowerCase();
  if (region === 'china') return [EDGEONE_API_ENDPOINTS.china];
  if (region === 'global') return [EDGEONE_API_ENDPOINTS.global];
  // EdgeOne's Makers preset domains (including *.edgeone.cool) are served by
  // the global Pages control plane. Prefer that endpoint when the workflow has
  // not pinned a region, then fall back to China for accounts hosted there.
  return [EDGEONE_API_ENDPOINTS.global, EDGEONE_API_ENDPOINTS.china];
}

/**
 * @param {{ deployment?: { type?: string, isTld?: number, url?: string }, token?: string, env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} options
 */
export async function resolveDeploymentUrl({
  deployment,
  token,
  env = process.env,
  fetchImpl = fetch,
} = {}) {
  const rawUrl = String(deployment?.url || '');
  // The CLI marks TLD preset domains as public and deliberately omits the
  // enciphered query. Preserve that contract; signing them can turn a valid
  // public site URL into an invalid site URL.
  // EdgeOne may label a preset host as a TLD while still requiring the
  // signed eo_token/eo_time query for the deployment URL to be readable.
  if (deployment?.type !== 'preset' || hasSignedAccessQuery(rawUrl)) return rawUrl;

  const url = new URL(rawUrl);
  let lastError = 'no response received';
  for (const endpoint of apiEndpoints(env)) {
    try {
      const response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ Action: 'DescribePagesEncipherToken', Text: url.host }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) {
        lastError = `HTTP ${response.status}`;
        continue;
      }
      const payload = await response.json();
      const data = payload?.Data?.Response;
      if (payload?.Code === 0 && typeof data?.Token === 'string' && data.Token && data.Timestamp) {
        url.searchParams.set('eo_token', data.Token);
        url.searchParams.set('eo_time', String(data.Timestamp));
        return url.toString();
      }
      lastError = 'invalid signed URL response';
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }
  throw new Error(
    `EdgeOne preset deployment URL is unsigned and could not be signed: ${lastError}`,
  );
}

function exactCommitSha(value) {
  const sha = String(value || '')
    .trim()
    .toLowerCase();
  return /^[0-9a-f]{40}$/.test(sha) ? sha : '';
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deployEdgeOne({
  env = process.env,
  execute = runProcess,
  wait = sleep,
  verifyDeployment = checkProductionSha,
  fetchImpl = fetch,
} = {}) {
  const token = env.EDGEONE_API_TOKEN || '';
  if (!token) throw new Error('EDGEONE_API_TOKEN is required');

  const project = resolveProject(env);
  const healthUrl = String(env.EDGEONE_SITE_URL || '').trim();
  const cliVersion = validateCliVersion(env.EDGEONE_CLI_VERSION || DEFAULT_CLI_VERSION);
  const retries = parseBoundedInt(
    env.EDGEONE_DEPLOY_RETRIES,
    'EDGEONE_DEPLOY_RETRIES',
    DEFAULT_RETRIES,
    1,
    5,
  );
  const timeoutSeconds = parseBoundedInt(
    env.EDGEONE_ATTEMPT_TIMEOUT_SECONDS,
    'EDGEONE_ATTEMPT_TIMEOUT_SECONDS',
    DEFAULT_TIMEOUT_SECONDS,
    30,
    300,
  );
  const verifyAttempts = parseBoundedInt(
    env.EDGEONE_DEPLOY_VERIFY_ATTEMPTS,
    'EDGEONE_DEPLOY_VERIFY_ATTEMPTS',
    DEFAULT_VERIFY_ATTEMPTS,
    1,
    12,
  );
  const verifyDelayMs = parseBoundedInt(
    env.EDGEONE_DEPLOY_VERIFY_DELAY_MS,
    'EDGEONE_DEPLOY_VERIFY_DELAY_MS',
    DEFAULT_VERIFY_DELAY_MS,
    0,
    30_000,
  );
  const expectedSha = exactCommitSha(env.DEPLOYMENT_SHA);
  const uploadSpec = resolveUploadSpec(env);

  console.log(`::add-mask::${token}`);
  let lastError = 'EdgeOne deployment did not start';
  let failureClass = 'api';
  let attemptsMade = 0;
  let lastDeploymentId = '';
  let lastProjectId = '';
  let lastConsoleUrl = '';
  let lastTransferDiagnostics = '';

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    attemptsMade = attempt;
    console.log(
      `EdgeOne deployment attempt ${attempt}/${retries} using direct named-project token auth`,
    );
    const args = buildDeployArgs({
      project,
      token,
      cliVersion,
      directory: uploadSpec.directory,
    });
    const result = await execute('npx', args, {
      timeoutMs: timeoutSeconds * 1_000,
      env: edgeOneProcessEnv(env),
      cwd: uploadSpec.cwd,
    });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    const transferDiagnostics = cliTransferDiagnostics(combined, token);
    lastTransferDiagnostics = transferDiagnostics;
    if (transferDiagnostics) {
      console.log('EdgeOne CLI transfer diagnostics:');
      console.log(transferDiagnostics);
    }
    const parsed = parseLastJson(combined);

    if (result.code === 0 && parsed) {
      try {
        const deployment = validateDeployResult(parsed);
        let safeCliUrl = 'n/a';
        try {
          const url = new URL(deployment.url);
          url.search = '';
          url.hash = '';
          safeCliUrl = url.toString();
        } catch {
          // validateDeployResult already rejects an empty URL; keep diagnostics safe.
        }
        console.log(
          `EdgeOne CLI response: type=${deployment.type || 'n/a'} isTld=${deployment.isTld ?? 'n/a'} site=${deployment.site || 'n/a'} url=${safeCliUrl}`,
        );
        const deployUrl = await resolveDeploymentUrl({ deployment, token, env, fetchImpl });
        const resolvedDeployment = { ...deployment, url: deployUrl };
        const projectId = String(deployment.projectId);
        const deploymentId = String(deployment.deploymentId);
        const consoleUrl = typeof deployment.consoleUrl === 'string' ? deployment.consoleUrl : '';
        lastProjectId = projectId;
        lastDeploymentId = deploymentId;
        lastConsoleUrl = consoleUrl;

        console.log(`::add-mask::${deployUrl}`);
        if (healthUrl.includes('?')) console.log(`::add-mask::${healthUrl}`);
        writeOutput('deploy_url', deployUrl);
        writeOutput('project_id', projectId);
        writeOutput('deployment_id', deploymentId);
        writeOutput('console_url', consoleUrl);
        // Without a configured custom domain, the CLI-returned production URL
        // is the only authoritative URL available. It may contain EdgeOne's
        // signed eo_token/eo_time query and must be passed through unchanged.
        const verificationUrl = healthUrl || deployUrl;
        writeOutput('health_url', verificationUrl);

        if (expectedSha) {
          console.log(
            `EdgeOne CLI accepted deployment=${deploymentId}; verifying deployment URL before declaring success`,
          );
          try {
            await verifyDeployment({
              baseUrl: deployUrl,
              expectedSha,
              label: `Tencent EdgeOne accepted deployment ${deploymentId}`,
              attempts: verifyAttempts,
              delayMs: verifyDelayMs,
            });
          } catch (error) {
            lastError = sanitizeLog(
              `EdgeOne deployment ${deploymentId} was accepted but did not become readable at the returned deployment URL: ${error instanceof Error ? error.message : String(error)}`,
              token,
            );
            failureClass = 'deployment_unavailable';
            throw new Error(lastError);
          }
        }

        writeOutput('failure_class', 'none');
        writeStepSummary([
          '#### EdgeOne CLI deployment diagnostics',
          `- project: ${project}`,
          `- project id: ${projectId}`,
          `- deployment id: ${deploymentId}`,
          `- CLI: edgeone@${cliVersion}`,
          '- auth mode: direct named-project CI deploy (`-n` + `-t`)',
          `- production health target: ${healthUrl ? 'configured EDGEONE_SITE_URL' : 'CLI production URL'}`,
          `- deployment URL verified: ${expectedSha ? 'yes' : 'not requested'}`,
          '- failure class: none',
          `- attempts: ${attemptsMade}/${retries}`,
        ]);
        console.log(`EdgeOne deployment verified: project=${projectId} deployment=${deploymentId}`);
        return { deployment: resolvedDeployment, healthUrl: verificationUrl };
      } catch (error) {
        if (failureClass !== 'deployment_unavailable') {
          lastError = sanitizeLog(
            `${error instanceof Error ? error.message : String(error)}\n${tailLines(combined)}`,
            token,
          );
          failureClass = 'protocol';
        }
      }
    } else if (result.timedOut) {
      lastError = `EdgeOne CLI attempt exceeded ${timeoutSeconds}s timeout`;
      failureClass = 'transport';
    } else if (result.code === 0) {
      lastError = sanitizeLog(
        `EdgeOne CLI exited successfully but returned no valid JSON result\n${tailLines(combined)}`,
        token,
      );
      failureClass = 'protocol';
    } else {
      lastError = sanitizeLog(
        tailLines(combined) || `EdgeOne CLI exited with status ${result.code} and no output`,
        token,
      );
      failureClass = classifyFailure(lastError, result.code, result.timedOut);
    }

    console.log(`Sanitized EdgeOne error output (class=${failureClass}):`);
    console.log(lastError);
    console.log(
      `::warning title=EdgeOne attempt ${attempt} [${failureClass}]::${annotationValue(lastError)}`,
    );

    if (
      attempt < retries &&
      (failureClass === 'transport' || failureClass === 'deployment_unavailable')
    ) {
      const waitMs = attempt * 10_000;
      console.log(
        `Retryable EdgeOne ${failureClass} failure; retrying full deployment in ${waitMs / 1_000}s`,
      );
      await wait(waitMs);
      continue;
    }
    break;
  }

  writeOutput('failure_class', failureClass);
  if (lastProjectId) writeOutput('project_id', lastProjectId);
  if (lastDeploymentId) writeOutput('deployment_id', lastDeploymentId);
  if (lastConsoleUrl) writeOutput('console_url', lastConsoleUrl);
  writeStepSummary([
    '#### EdgeOne CLI deployment diagnostics',
    `- project: ${project}`,
    `- project id: ${lastProjectId || 'n/a'}`,
    `- deployment id: ${lastDeploymentId || 'n/a'}`,
    `- CLI: edgeone@${cliVersion}`,
    '- auth mode: direct named-project CI deploy (`-n` + `-t`)',
    `- failure class: ${failureClass}`,
    `- attempts: ${attemptsMade}/${retries}`,
  ]);
  writeDiagnostic(
    env,
    {
      status: 'failure',
      project,
      project_id: lastProjectId || undefined,
      deployment_id: lastDeploymentId || undefined,
      console_url: lastConsoleUrl || undefined,
      cli_version: cliVersion,
      failure_class: failureClass,
      attempts: attemptsMade,
      error: lastError,
      transfer_diagnostics: lastTransferDiagnostics || undefined,
    },
    token,
  );
  console.error(
    `::error title=EdgeOne deployment failure [${failureClass}]::${annotationValue(lastError)}`,
  );
  throw new Error(`EdgeOne deployment failed after retry policy [${failureClass}]: ${lastError}`);
}

export async function checkCliContract({
  env = process.env,
  execute = runProcess,
  createTempDir = () => mkdtemp(join(tmpdir(), 'dsh-edgeone-cli-')),
  removeTempDir = (directory) => rm(directory, { recursive: true, force: true }),
} = {}) {
  const cliVersion = validateCliVersion(env.EDGEONE_CLI_VERSION || DEFAULT_CLI_VERSION);
  // The probe does not upload files.  Running npx from site/dist still lets
  // npm walk up into the repository root package graph, which has triggered
  // npm's Arborist `edgesOut` crash before the EdgeOne CLI starts.  Use an
  // isolated workspace and cache for the probe while keeping the real
  // deployment cwd unchanged in deployEdgeOne().  A shared npx cache can
  // retain a partially-built Arborist tree after a failed install, so cwd
  // isolation alone is not sufficient.
  const probeCwd = await createTempDir();
  const probeCache = join(probeCwd, 'npm-cache');
  try {
    const result = await execute(
      'npx',
      ['--yes', `edgeone@${cliVersion}`, 'makers', 'deploy', '--help'],
      {
        timeoutMs: 120_000,
        env: {
          ...edgeOneProcessEnv(env),
          npm_config_cache: probeCache,
          NPM_CONFIG_CACHE: probeCache,
          npm_config_userconfig: join(probeCwd, '.npmrc'),
          NPM_CONFIG_USERCONFIG: join(probeCwd, '.npmrc'),
          npm_config_package_lock: 'false',
          npm_config_workspaces: 'false',
          npm_config_audit: 'false',
          npm_config_fund: 'false',
          npm_config_update_notifier: 'false',
        },
        cwd: probeCwd,
      },
    );
    if (result.code !== 0) {
      throw new Error(
        `EdgeOne CLI deploy contract check failed: ${sanitizeLog(tailLines(`${result.stdout}\n${result.stderr}`), env.EDGEONE_API_TOKEN || '')}`,
      );
    }
    console.log(`EdgeOne CLI contract verified: edgeone@${cliVersion} makers deploy`);
  } finally {
    await removeTempDir(probeCwd);
  }
}

async function main() {
  if (process.argv.includes('--check')) {
    await checkCliContract();
    return;
  }
  await deployEdgeOne();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
