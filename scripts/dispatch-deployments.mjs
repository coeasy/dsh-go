#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const DEFAULT_RETRIES = 5;
const DEFAULT_RETRY_DELAY_MS = 5_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 60_000;
const COMMAND_KILL_GRACE_MS = 1_000;

export function validateRevision(value) {
  if (!/^[0-9a-f]{40}$/i.test(value || '')) {
    throw new Error('DEPLOY_REVISION must be an exact 40-character commit SHA');
  }
  return value.toLowerCase();
}

export function parseWorkflowList(value) {
  const workflows = String(value || '')
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  if (workflows.length === 0) throw new Error('DEPLOY_WORKFLOWS must contain at least one workflow');
  for (const workflow of workflows) {
    if (!/^[A-Za-z0-9._/-]+\.ya?ml$/.test(workflow)) throw new Error(`Invalid workflow path: ${workflow}`);
  }
  return [...new Set(workflows)];
}

export function isWorkflowRegistrationError(value) {
  return /HTTP 422:.*Workflow does not have ['"]?workflow_dispatch['"]? trigger|Workflow does not have ['"]workflow_dispatch['"] trigger/i.test(String(value || ''));
}

function parseBoundedInt(value, name, fallback, min, max) {
  if (value === undefined || value === null || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) throw new Error(`${name} must be an integer`);
  const number = Number(value);
  if (number < min || number > max) throw new Error(`${name} must be between ${min} and ${max}`);
  return number;
}

function runGh(args, { timeoutMs = DEFAULT_COMMAND_TIMEOUT_MS, env = process.env } = {}) {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    let cleanupTimer;
    const child = spawn('gh', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    let killTimer;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      killTimer = setTimeout(() => {
        if (settled) return;
        try { child.kill('SIGKILL'); } catch { /* process exited between checks */ }
        cleanupTimer = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (killTimer) clearTimeout(killTimer);
          resolve({ code: 124, stdout, stderr, timedOut: true, process_cleanup_failed: true });
        }, COMMAND_KILL_GRACE_MS);
        cleanupTimer.unref?.();
      }, COMMAND_KILL_GRACE_MS);
      killTimer.unref?.();
    }, timeoutMs);
    timer.unref?.();

    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (cleanupTimer) clearTimeout(cleanupTimer);
      resolve({ code: timedOut ? 124 : (code ?? 1), stdout, stderr, timedOut, process_cleanup_failed: false });
    };
    child.on('error', (error) => {
      stderr += error.message;
      finish(127);
    });
    child.on('close', finish);
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeOutput(name, value) {
  if (!process.env.GITHUB_OUTPUT) return;
  appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${String(value)}\n`);
}

function appendSummary(lines) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.join('\n')}\n`);
}

function markdownCell(value) {
  return String(value || '').replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ').slice(0, 500);
}

export async function dispatchDeployments({ env = process.env, execute = runGh, wait = sleep } = {}) {
  const revision = validateRevision(env.DEPLOY_REVISION);
  const workflows = parseWorkflowList(env.DEPLOY_WORKFLOWS);
  const label = env.DEPLOY_LABEL || workflows.join(', ');
  const retries = parseBoundedInt(env.DEPLOY_DISPATCH_RETRIES, 'DEPLOY_DISPATCH_RETRIES', DEFAULT_RETRIES, 1, 8);
  const retryDelayMs = parseBoundedInt(env.DEPLOY_DISPATCH_RETRY_DELAY_MS, 'DEPLOY_DISPATCH_RETRY_DELAY_MS', DEFAULT_RETRY_DELAY_MS, 0, 60_000);
  const commandTimeoutMs = parseBoundedInt(env.DEPLOY_DISPATCH_TIMEOUT_MS, 'DEPLOY_DISPATCH_TIMEOUT_MS', DEFAULT_COMMAND_TIMEOUT_MS, 5_000, 120_000);
  const results = [];

  console.log(`Authoritative deployment revision: ${revision}`);

  for (const workflow of workflows) {
    let status = 'failed';
    let runUrl = '';
    let lastError = '';
    let attemptsUsed = 0;

    for (let attempt = 1; attempt <= retries; attempt += 1) {
      attemptsUsed = attempt;
      console.log(`Dispatching ${workflow} at ${revision} (attempt ${attempt}/${retries})`);
      const result = await execute(['workflow', 'run', workflow, '--ref', 'main', '-f', `commit_sha=${revision}`], {
        timeoutMs: commandTimeoutMs,
        env,
      });
      const output = `${result.stdout || ''}\n${result.stderr || ''}`.trim();

      if (result.code === 0) {
        status = 'dispatched';
        runUrl = (result.stdout || '').trim().split(/\r?\n/).filter(Boolean).at(-1) || '';
        console.log(`${workflow}: dispatched${runUrl ? ` -> ${runUrl}` : ''}`);
        break;
      }

      lastError = output || (result.timedOut ? 'gh workflow run timed out' : `gh workflow run exited with ${result.code}`);
      console.error(`${workflow}: ${lastError}`);
      const registrationLag = isWorkflowRegistrationError(lastError);
      if (registrationLag && attempt < retries) {
        const delay = retryDelayMs * attempt;
        console.log(`${workflow}: workflow_dispatch registration is not ready; retrying in ${delay / 1_000}s`);
        await wait(delay);
        continue;
      }
      break;
    }

    results.push({ workflow, status, runUrl, error: lastError, attempts: attemptsUsed });
  }

  const failures = results.filter((result) => result.status !== 'dispatched');
  writeOutput('dispatched', failures.length === 0 ? 'true' : 'false');
  writeOutput('dispatch_failures', failures.map((result) => result.workflow).join(','));

  appendSummary([
    '### Deployment fan-out',
    `- authoritative revision: ${revision}`,
    `- requested targets: ${markdownCell(label)}`,
    '',
    '| workflow | status | attempts | run |',
    '| --- | --- | ---: | --- |',
    ...results.map((result) => `| ${markdownCell(result.workflow)} | ${result.status} | ${result.attempts} | ${result.runUrl ? `[run](${result.runUrl})` : '-'} |`),
  ]);

  if (failures.length > 0) {
    const failureSummary = failures.map((result) => `${result.workflow}: ${result.error}`).join('\n');
    throw new Error(`Deployment fan-out completed with ${failures.length} failed dispatch(es):\n${failureSummary}`);
  }

  return results;
}

async function main() {
  await dispatchDeployments();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
