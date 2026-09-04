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
  return Promise.all(files.map(async (file) => ({
    file,
    path: relative(ROOT, file).replaceAll('\\', '/'),
    text: await readFile(file, 'utf8'),
  })));
}

function fail(path, rule, detail) {
  errors.push(`${path}: ${rule}${detail ? ` (${detail})` : ''}`);
}

function imports(text) {
  return [...text.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]);
}

async function relativeImportExists(entry, spec) {
  if (!spec.startsWith('.')) return true;
  const base = resolve(dirname(entry.file), spec);
  const candidates = [
    base,
    `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.mts`, `${base}.astro`, `${base}.json`, `${base}.css`,
    join(base, 'index.mjs'), join(base, 'index.js'), join(base, 'index.ts'), join(base, 'index.mts'),
  ];
  for (const candidate of candidates) if (await exists(candidate)) return true;
  return false;
}

const sourceFiles = await contents([
  ...await filesUnder('runtime', ['.mjs', '.js', '.ts']),
  ...await filesUnder('packages', ['.mjs', '.js', '.ts', '.mts']),
  ...await filesUnder('functions', ['.ts', '.js', '.mjs']),
  ...await filesUnder('site/src', ['.ts', '.js', '.mjs', '.astro']),
  ...await filesUnder('scripts', ['.mjs', '.js', '.ts']),
]);

for (const entry of sourceFiles) {
  for (const spec of imports(entry.text)) {
    if (!await relativeImportExists(entry, spec)) fail(entry.path, 'relative import target is missing', spec);
  }
  if (/runtime\/(?:package-model|semver|resolver|solver-v2)\.mjs$/.test(entry.path)) fail(entry.path, 'duplicate protocol/resolver implementation is forbidden');
  if (/from\s+['"]\.\/(?:package-model|semver|resolver|solver-v2)\.mjs['"]/.test(entry.text)) fail(entry.path, 'deleted runtime protocol/resolver implementation import');
  if (entry.path.startsWith('site/src/') && imports(entry.text).some((value) => value.includes('/runtime/') || value.startsWith('../../../runtime') || value.startsWith('../../runtime'))) fail(entry.path, 'Site must not import Local Runtime');
  if (entry.path.startsWith('functions/') && imports(entry.text).some((value) => /runtime\/(?:installer|registry|transaction|supervisor|environment-lock|secret-store|trust-store|cas-store)/.test(value))) fail(entry.path, 'Edge functions must not import local mutation/runtime state modules');
  if (entry.path.startsWith('functions/') && /\/api\/v1(?:\/|['"`])/.test(entry.text)) fail(entry.path, 'API V1 reference is forbidden');
  if ((entry.path.startsWith('runtime/') || entry.path.startsWith('site/src/') || entry.path.startsWith('functions/')) && entry.text.includes('dsh://install?plugin=')) fail(entry.path, 'legacy Deep Link is forbidden');
  if (entry.path.startsWith('functions/') && /RegistryV3|registry-v3|registry_version\s*[:=]\s*3/.test(entry.text)) fail(entry.path, 'Registry V3 Edge authority is forbidden');
  if (entry.path.startsWith('runtime/') && /function\s+(?:compareVersions|satisfiesVersion|parsePackageRequest)\b/.test(entry.text)) fail(entry.path, 'Runtime must not reimplement Package Protocol V2');
}

for (const legacy of [
  'functions/api/v1',
  'functions/_package-request.ts',
  'functions/_registry.ts',
  'functions/_marketplace-v4.ts',
  'runtime/package-model.mjs',
  'runtime/semver.mjs',
  'runtime/resolver.mjs',
  'runtime/solver-v2.mjs',
  'runtime/catalog.mjs',
  'runtime/registry-distribution.mjs',
  'runtime/cli.mjs',
  'runtime/control-cli.mjs',
  'runtime/preflight.mjs',
  'runtime/platform.mjs',
  'runtime/registry-manager.mjs',
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

const mutationFrontends = [
  'runtime/dsh.mjs',
  'runtime/client-host.mjs',
  'runtime/environment-cli.mjs',
  'runtime/host-bridge.mjs',
];
for (const path of mutationFrontends) {
  const entry = sourceFiles.find((item) => item.path === path);
  if (!entry) continue;
  const specs = imports(entry.text);
  if (specs.some((value) => value.endsWith('/registry.mjs') || value === './registry.mjs')) fail(path, 'mutation frontend must not write Runtime State directly');
  if (specs.some((value) => value === './package-service.mjs') && /(?:installPackageRequest|updatePackageRequest|removePackageRequest|rollbackPackageRequest|setPackageEnabled)/.test(entry.text)) fail(path, 'mutation frontend bypasses Runtime Supervisor');
}

const runtimePermissions = sourceFiles.find((entry) => entry.path === 'runtime/permissions.mjs');
if (runtimePermissions && !runtimePermissions.text.includes('packages/policy-core/permissions.mjs')) fail(runtimePermissions.path, 'Runtime permission semantics must delegate to Policy Core');

const candidateSource = sourceFiles.find((entry) => entry.path === 'scripts/registry-v4-source.mjs');
if (!candidateSource) fail('scripts/registry-v4-source.mjs', 'Registry V4 discovery ingress is missing');
else {
  for (const required of ["'accepted'", "'quarantined'", "'rejected'", 'candidateReport']) {
    if (!candidateSource.text.includes(required)) fail(candidateSource.path, 'candidate/quarantine pipeline contract missing', required);
  }
}

const packageDirs = (await readdir(resolve(ROOT, 'packages'), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
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
  'packages/policy-core/permissions.mjs',
  'runtime/supervisor.mjs',
  'runtime/transaction.mjs',
  'runtime/activation-manager.mjs',
  'runtime/cas-store.mjs',
  'runtime/trust-store.mjs',
  'runtime/secret-store.mjs',
  'runtime/secret-provider.mjs',
  'runtime/audit-log.mjs',
  'runtime/adapters/index.mjs',
  'scripts/registry-v4-source.mjs',
];
for (const path of expectedAuthorities) if (!await exists(resolve(ROOT, path))) fail(path, 'required canonical authority is missing');

if (errors.length) {
  console.error('Architecture Conformance Gate failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Architecture Conformance Gate passed: ${sourceFiles.length} source files checked; canonical authorities=${expectedAuthorities.length}`);
