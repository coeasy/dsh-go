#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SYNC_OWNED_EXACT = new Set([
  'scripts/sync-v4.mjs',
  'scripts/discovery-sync.mjs',
  'scripts/dispatch-deployments.mjs',
  'scripts/repository-identity.mjs',
  'scripts/github-discovery.mjs',
  'scripts/checksum.mjs',
  'scripts/validate-registry-v4.mjs',
  'scripts/audit-catalog-identity.mjs',
  'config/registry-v4-sources.json',
  'catalog/overrides.json',
  '.github/workflows/sync.yml',
  'dsh-package.json',
]);

const SYNC_OWNED_PREFIXES = Object.freeze([
  'scripts/registry-v4-',
  'packages/protocol-core/',
  'packages/registry-core/',
  'packages/resolver/',
  'packages/policy-core/',
  'packages/dsh-go-marketplace/',
  'packages/dsh-go-marketplace-plugin/',
]);

const GENERATED_REGISTRY_EXACT = new Set([
  'catalog/plugins.json',
  'catalog/feed.xml',
  'catalog/meta.json',
  'catalog/registry-v4.json',
  'catalog/registry-candidates-v1.json',
  'catalog/audit-report.json',
]);

// Only paths that can change a production Pages payload are direct-deploy
// relevant. Runtime, tests, docs and release/control-plane-only changes do not
// rebuild three identical production revisions just to advance the Git SHA.
const DEPLOY_RELEVANT_EXACT = new Set([
  'package.json',
  'package-lock.json',
  'wrangler.toml',
  '_headers',
  '_redirects',
  'catalog/provider-adapters.json',
  'scripts/copy-assets.mjs',
  'scripts/copy-assets-core.mjs',
  'scripts/write-deployment-version.mjs',
]);

const DEPLOY_RELEVANT_PREFIXES = Object.freeze([
  'functions/',
  'site/',
]);

function normalizePath(value) {
  return String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '');
}

function matches(path, exact, prefixes) {
  return exact.has(path) || prefixes.some((prefix) => path.startsWith(prefix));
}

export function classifyDeploymentPaths(values = []) {
  const paths = [...new Set(values.map(normalizePath).filter(Boolean))].sort();
  const syncOwnedPaths = paths.filter((path) => matches(path, SYNC_OWNED_EXACT, SYNC_OWNED_PREFIXES));
  const generatedRegistryPaths = paths.filter((path) => GENERATED_REGISTRY_EXACT.has(path));
  const deployRelevantPaths = paths.filter((path) => matches(path, DEPLOY_RELEVANT_EXACT, DEPLOY_RELEVANT_PREFIXES));
  return {
    paths,
    sync_owned: syncOwnedPaths.length > 0,
    generated_registry: generatedRegistryPaths.length > 0,
    deploy_relevant: deployRelevantPaths.length > 0,
    sync_owned_paths: syncOwnedPaths,
    generated_registry_paths: generatedRegistryPaths,
    deploy_relevant_paths: deployRelevantPaths,
  };
}

export function githubOutputLines(classification) {
  return [
    `sync_owned=${classification.sync_owned}`,
    `generated_registry=${classification.generated_registry}`,
    `deploy_relevant=${classification.deploy_relevant}`,
  ].join('\n');
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath && invokedPath === fileURLToPath(import.meta.url)) {
  const inputPath = process.argv[2];
  if (!inputPath) {
    console.error('usage: node scripts/deployment-paths.mjs <changed-files>');
    process.exit(2);
  }
  const text = await readFile(inputPath, 'utf8');
  const classification = classifyDeploymentPaths(text.split(/\r?\n/));
  process.stdout.write(`${githubOutputLines(classification)}\n`);
}
