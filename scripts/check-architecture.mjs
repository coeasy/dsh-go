#!/usr/bin/env node
import { access, readFile, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const errors = [];

async function exists(path) {
  try { await access(path); return true; } catch { return false; }
}

async function filesUnder(directory, extensions = null) {
  const root = resolve(ROOT, directory);
  if (!await exists(root)) return [];
  const output = [];
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.astro') continue;
      const file = join(current, entry.name);
      if (entry.isDirectory()) await walk(file);
      else if (!extensions || extensions.some((ext) => entry.name.endsWith(ext))) output.push(file);
    }
  }
  await walk(root);
  return output;
}

async function contents(files) {
  return Promise.all(files.map(async (file) => ({ file, path: relative(ROOT, file).replaceAll('\\', '/'), text: await readFile(file, 'utf8') })));
}

function fail(path, rule, detail) {
  errors.push(`${path}: ${rule}${detail ? ` (${detail})` : ''}`);
}

function imports(text) {
  return [...text.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

const sourceFiles = await contents([
  ...await filesUnder('runtime', ['.mjs', '.js', '.ts']),
  ...await filesUnder('packages', ['.mjs', '.js', '.ts', '.mts']),
  ...await filesUnder('functions', ['.ts', '.js', '.mjs']),
  ...await filesUnder('site/src', ['.ts', '.js', '.mjs', '.astro']),
]);

for (const entry of sourceFiles) {
  if (/runtime\/(?:package-model|semver)\.mjs$/.test(entry.path)) fail(entry.path, 'duplicate protocol implementation is forbidden');
  if (/from\s+['"]\.\/package-model\.mjs['"]|from\s+['"]\.\/semver\.mjs['"]/.test(entry.text)) fail(entry.path, 'deleted runtime protocol implementation import');
  if (entry.path.startsWith('site/src/') && imports(entry.text).some((value) => value.includes('/runtime/') || value.startsWith('../../../runtime') || value.startsWith('../../runtime'))) fail(entry.path, 'Site must not import Local Runtime');
  if (entry.path.startsWith('functions/') && imports(entry.text).some((value) => /runtime\/(?:installer|registry|transaction|supervisor|environment-lock|secret-store)/.test(value))) fail(entry.path, 'Edge functions must not import local mutation/runtime state modules');
  if (entry.path.startsWith('functions/') && /\/api\/v1(?:\/|['"`])/.test(entry.text)) fail(entry.path, 'API V1 reference is forbidden');
  if ((entry.path.startsWith('runtime/') || entry.path.startsWith('site/src/') || entry.path.startsWith('functions/')) && entry.text.includes('dsh://install?plugin=')) fail(entry.path, 'legacy Deep Link is forbidden');
}

for (const legacy of [
  'functions/api/v1',
  'runtime/package-model.mjs',
  'runtime/semver.mjs',
  'site/src/pages/plugin/[slug].astro',
  'site/src/pages/ecosystem/[id].astro',
]) {
  if (await exists(resolve(ROOT, legacy))) fail(legacy, 'legacy public/core surface still exists');
}

const resolver = sourceFiles.find((entry) => entry.path === 'packages/resolver/index.mjs');
if (!resolver) fail('packages/resolver/index.mjs', 'canonical Resolver V2 is missing');
else {
  for (const spec of imports(resolver.text)) {
    if (spec.startsWith('node:fs') || spec.startsWith('node:http') || spec.startsWith('node:https') || spec.includes('/runtime/')) fail(resolver.path, 'Resolver must be pure and runtime/filesystem/network independent', spec);
  }
  if (/\bfetch\s*\(/.test(resolver.text)) fail(resolver.path, 'Resolver must not perform network I/O');
}

const mutationFrontends = ['runtime/dsh.mjs', 'runtime/client-host.mjs', 'runtime/environment-cli.mjs'];
for (const path of mutationFrontends) {
  const entry = sourceFiles.find((item) => item.path === path);
  if (!entry) continue;
  const specs = imports(entry.text);
  if (specs.some((value) => value.endsWith('/registry.mjs') || value === './registry.mjs')) fail(path, 'mutation frontend must not write Runtime State directly');
  if (path !== 'runtime/client-host.mjs' && specs.some((value) => value === './package-service.mjs') && /(?:installPackageRequest|updatePackageRequest|removePackageRequest|rollbackPackageRequest|setPackageEnabled)/.test(entry.text)) fail(path, 'mutation frontend bypasses Runtime Supervisor');
  if (path === 'runtime/client-host.mjs' && /from ['"]\.\/package-service\.mjs['"]/.test(entry.text) && /\b(?:installPackageRequest|updatePackageRequest|removePackageRequest|rollbackPackageRequest|setPackageEnabled)\b/.test(entry.text)) fail(path, 'Local Host bypasses Runtime Supervisor');
}

const packageDirs = (await readdir(resolve(ROOT, 'packages'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const graph = new Map(packageDirs.map((name) => [name, new Set()]));
for (const entry of sourceFiles.filter((item) => item.path.startsWith('packages/'))) {
  const owner = entry.path.split('/')[1];
  for (const spec of imports(entry.text)) {
    if (!spec.startsWith('.')) continue;
    const normalized = resolve(dirname(resolve(ROOT, entry.path)), spec);
    const rel = relative(resolve(ROOT, 'packages'), normalized).replaceAll('\\', '/');
    const target = rel.split('/')[0];
    if (target && target !== owner && graph.has(target)) graph.get(owner).add(target);
  }
}
const visiting = new Set();
const visited = new Set();
function visit(node, stack = []) {
  if (visiting.has(node)) { fail(`packages/${node}`, 'circular internal package dependency', [...stack, node].join(' -> ')); return; }
  if (visited.has(node)) return;
  visiting.add(node);
  for (const next of graph.get(node) || []) visit(next, [...stack, node]);
  visiting.delete(node);
  visited.add(node);
}
for (const node of graph.keys()) visit(node);

const expectedAuthorities = [
  'packages/protocol-core/index.mjs',
  'packages/registry-core/index.mjs',
  'packages/resolver/index.mjs',
  'packages/policy-core/index.mjs',
  'runtime/supervisor.mjs',
  'runtime/transaction.mjs',
  'runtime/activation-manager.mjs',
  'runtime/cas-store.mjs',
  'runtime/trust-store.mjs',
  'runtime/adapters/index.mjs',
];
for (const path of expectedAuthorities) if (!await exists(resolve(ROOT, path))) fail(path, 'required canonical authority is missing');

if (errors.length) {
  console.error('Architecture Conformance Gate failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Architecture Conformance Gate passed: ${sourceFiles.length} source files checked; canonical authorities=${expectedAuthorities.length}`);
