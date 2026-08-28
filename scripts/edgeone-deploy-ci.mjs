#!/usr/bin/env node

import { appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const MIN_CLI_VERSION = [1, 6, 0];
const DEFAULT_CLI_VERSION = '1.6.28';
const DEFAULT_PROJECT = 'dsh-go';
const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_SECONDS = 240;
const MAX_CAPTURE_BYTES = 2 * 1024 * 1024;

export function validateCliVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value || '');
  if (!match) throw new Error('EDGEONE_CLI_VERSION must be a pinned semver');
  const version = match.slice(1, 4).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (version[index] > MIN_CLI_VERSION[index]) return value;
    if (version[index] < MIN_CLI_VERSION[index]) throw new Error('EdgeOne CLI >= 1.6.0 is required');
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

export function classifyFailure(text, status = 1, timedOut = false) {
  const value = String(text ?? '');
  if (timedOut || status === 124 || status === 137) return 'transport';
  if (/has finished versions|uploads? are only allowed for the latest version|only latest version can upload/i.test(value)) {
    return 'version_state';
  }
  if (/(^|[^0-9])(401|403)([^0-9]|$)|unauthori[sz]ed|forbidden|invalid[ _-]*token|token.*(expired|invalid)|authentication failed|permission denied|not logged in|login required/i.test(value)) {
    return 'authentication';
  }
  if (/(^|[^0-9])429([^0-9]|$)|rate[ _-]*limit|quota|exceed(?:ed|s)? .*limit|project exceeds [0-9]+ limit/i.test(value)) {
    return 'quota';
  }
  if (/(^|[^0-9])409([^0-9]|$)|already exists|project.*exists|name.*conflict|duplicate project/i.test(value)) {
    return 'project_conflict';
  }
  if (status === 0) return 'protocol';
  if (/fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|network|TLS|certificate|connection reset|connection refused/i.test(value)) {
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
  if (!result || result.status !== 'success' || typeof result.url !== 'string' || result.url.length === 0 || result.projectId === undefined || result.projectId === null || String(result.projectId).length === 0) {
    throw new Error('EdgeOne CLI returned an invalid success payload');
  }
  return result;
}

export function buildDeployArgs({ project, token, cliVersion, directory = './dist' }) {
  return [
    '--yes',
    `edgeone@${cliVersion}`,
    'makers',
    'deploy',
    directory,
    '-n',
    project,
    '-t',
    token,
    '-e',
    'production',
    '--json',
  ];
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
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
          killTimer.unref?.();
        }, timeoutMs)
      : null;
    timeout?.unref?.();

    const finish = (code) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (killTimer) clearTimeout(killTimer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut });
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
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A').slice(0, 900);
}

function tailLines(value, count = 20) {
  return String(value).split(/\r?\n/).slice(-count).join('\n').trim();
}

function edgeOneProcessEnv(env) {
  return { ...env, PAGES_SOURCE: env.PAGES_SOURCE || 'skills' };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function deployEdgeOne({ env = process.env, execute = runProcess, wait = sleep } = {}) {
  const token = env.EDGEONE_API_TOKEN || '';
  if (!token) throw new Error('EDGEONE_API_TOKEN is required');

  const project = resolveProject(env);
  const cliVersion = validateCliVersion(env.EDGEONE_CLI_VERSION || DEFAULT_CLI_VERSION);
  const retries = parseBoundedInt(env.EDGEONE_DEPLOY_RETRIES, 'EDGEONE_DEPLOY_RETRIES', DEFAULT_RETRIES, 1, 5);
  const timeoutSeconds = parseBoundedInt(env.EDGEONE_ATTEMPT_TIMEOUT_SECONDS, 'EDGEONE_ATTEMPT_TIMEOUT_SECONDS', DEFAULT_TIMEOUT_SECONDS, 30, 300);

  console.log(`::add-mask::${token}`);
  let lastError = 'EdgeOne deployment did not start';
  let failureClass = 'api';
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= retries; attempt += 1) {
    attemptsMade = attempt;
    console.log(`EdgeOne deployment attempt ${attempt}/${retries} using direct named-project token auth`);
    const args = buildDeployArgs({ project, token, cliVersion });
    const result = await execute('npx', args, {
      timeoutMs: timeoutSeconds * 1_000,
      env: edgeOneProcessEnv(env),
      cwd: './site',
    });
    const combined = `${result.stdout || ''}\n${result.stderr || ''}`;
    const parsed = parseLastJson(combined);

    if (result.code === 0 && parsed) {
      try {
        const deployment = validateDeployResult(parsed);
        const deployUrl = deployment.url;
        const projectId = String(deployment.projectId);
        const consoleUrl = typeof deployment.consoleUrl === 'string' ? deployment.consoleUrl : '';
        const healthUrl = env.EDGEONE_SITE_URL || deployUrl;

        console.log(`::add-mask::${deployUrl}`);
        if (healthUrl.includes('?')) console.log(`::add-mask::${healthUrl}`);
        writeOutput('failure_class', 'none');
        writeOutput('deploy_url', deployUrl);
        writeOutput('project_id', projectId);
        writeOutput('console_url', consoleUrl);
        writeOutput('health_url', healthUrl);
        writeStepSummary([
          '#### EdgeOne CLI deployment diagnostics',
          `- project: ${project}`,
          `- CLI: edgeone@${cliVersion}`,
          '- auth mode: direct named-project CI deploy (`-n` + `-t`)',
          '- failure class: none',
          `- attempts: ${attemptsMade}/${retries}`,
        ]);
        console.log(`EdgeOne deployment accepted: project=${projectId}`);
        return { deployment, healthUrl };
      } catch (error) {
        lastError = sanitizeLog(`${error.message}\n${tailLines(combined)}`, token);
        failureClass = 'protocol';
      }
    } else if (result.timedOut) {
      lastError = `EdgeOne CLI attempt exceeded ${timeoutSeconds}s timeout`;
      failureClass = 'transport';
    } else if (result.code === 0) {
      lastError = sanitizeLog(`EdgeOne CLI exited successfully but returned no valid JSON result\n${tailLines(combined)}`, token);
      failureClass = 'protocol';
    } else {
      lastError = sanitizeLog(tailLines(combined) || `EdgeOne CLI exited with status ${result.code} and no output`, token);
      failureClass = classifyFailure(lastError, result.code, result.timedOut);
    }

    console.log(`Sanitized EdgeOne error output (class=${failureClass}):`);
    console.log(lastError);
    console.log(`::warning title=EdgeOne attempt ${attempt} [${failureClass}]::${annotationValue(lastError)}`);

    if (attempt < retries && failureClass === 'transport') {
      const waitMs = attempt * 10_000;
      console.log(`Transient EdgeOne transport failure; retrying in ${waitMs / 1_000}s`);
      await wait(waitMs);
      continue;
    }
    break;
  }

  writeOutput('failure_class', failureClass);
  writeStepSummary([
    '#### EdgeOne CLI deployment diagnostics',
    `- project: ${project}`,
    `- CLI: edgeone@${cliVersion}`,
    '- auth mode: direct named-project CI deploy (`-n` + `-t`)',
    `- failure class: ${failureClass}`,
    `- attempts: ${attemptsMade}/${retries}`,
  ]);
  writeDiagnostic(env, {
    status: 'failure',
    project,
    cli_version: cliVersion,
    failure_class: failureClass,
    attempts: attemptsMade,
    error: lastError,
  }, token);
  console.error(`::error title=EdgeOne deployment failure [${failureClass}]::${annotationValue(lastError)}`);
  throw new Error(`EdgeOne deployment failed after retry policy [${failureClass}]: ${lastError}`);
}

export async function checkCliContract({ env = process.env, execute = runProcess } = {}) {
  const cliVersion = validateCliVersion(env.EDGEONE_CLI_VERSION || DEFAULT_CLI_VERSION);
  const result = await execute('npx', ['--yes', `edgeone@${cliVersion}`, 'makers', 'deploy', '--help'], {
    timeoutMs: 120_000,
    env: edgeOneProcessEnv(env),
  });
  if (result.code !== 0) {
    throw new Error(`EdgeOne CLI deploy contract check failed: ${sanitizeLog(tailLines(`${result.stdout}\n${result.stderr}`), env.EDGEONE_API_TOKEN || '')}`);
  }
  console.log(`EdgeOne CLI contract verified: edgeone@${cliVersion} makers deploy`);
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
