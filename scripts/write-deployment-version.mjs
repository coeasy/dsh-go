#!/usr/bin/env node

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';

export function validateDeploymentSha(value) {
  const sha = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new Error('DEPLOYMENT_SHA must be an exact 40-character commit SHA');
  }
  return sha;
}

export function buildDeploymentVersion(env = process.env, now = new Date()) {
  const gitSha = validateDeploymentSha(env.DEPLOYMENT_SHA || env.GITHUB_SHA);
  const runAttempt = String(env.GITHUB_RUN_ATTEMPT || '').trim();

  return {
    schema_version: 1,
    git_sha: gitSha,
    repository: env.GITHUB_REPOSITORY || '',
    ref: env.GITHUB_REF || '',
    workflow: env.GITHUB_WORKFLOW || '',
    run_id: env.GITHUB_RUN_ID || '',
    run_attempt: /^\d+$/.test(runAttempt) ? Number(runAttempt) : null,
    built_at: now.toISOString(),
  };
}

export async function writeDeploymentVersion(outputPath, { env = process.env, now = new Date() } = {}) {
  if (!outputPath) throw new Error('Deployment version output path is required');
  const metadata = buildDeploymentVersion(env, now);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  console.log(`Deployment metadata written: ${outputPath} sha=${metadata.git_sha}`);
  return metadata;
}

async function main() {
  const outputPath = process.argv[2] || 'site/dist/version.json';
  await writeDeploymentVersion(outputPath);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
