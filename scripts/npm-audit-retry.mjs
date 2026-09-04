#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const MAX_ATTEMPTS = 3;
export const AUDIT_TIMEOUT_MS = 60_000;
export const RETRY_DELAY_MS = 10_000;

const AUDIT_ARGS = [
  'audit',
  '--audit-level=high',
  '--fetch-retries=0',
  '--fetch-timeout=30000',
];

const TRANSIENT_ERROR_PATTERNS = [
  /\b503\b.*service unavailable/i,
  /\b429\b.*too many requests/i,
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

export function runAudit({ cwd, timeoutMs = AUDIT_TIMEOUT_MS, spawnImpl = spawn } = {}) {
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
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killHandle = setTimeout(() => child.kill('SIGKILL'), 5_000);
    }, timeoutMs);

    const writeOutput = (chunk) => {
      const text = String(chunk);
      output += text;
      process.stdout.write(text);
    };

    const finish = (code, signal = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeoutHandle);
      clearTimeout(killHandle);
      resolvePromise({
        code: code ?? 1,
        output: timedOut ? `${output}\nnpm audit process timed out` : output,
        signal,
        timedOut,
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
  run().then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
