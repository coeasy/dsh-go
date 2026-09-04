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

function fail(path, rule, detail) { errors.push(`${path}: ${rule}${detail ? ` (${detail})` : ''}`); }
function imports(text) { return [...text.matchAll(/(?:import\s+(?:[^'";]+?\s+from\s+)?|export\s+[^'";]+?\s+from\s+|import\()\s*['"]([^'"]+)['"]/g)].map((match) => match[1]); }

async function relativeImportExists(entry, spec) {
  if (!spec.startsWith('.')) return true;
  const base = resolve(dirname(entry.file), spec);
  const candidates = [base, `${base}.mjs`, `${base}.js`, `${base}.ts`, `${base}.mts`, `${base}.astro`, `${base}.json`, `${base}.css`, join(base, 'index.mjs'), join(base, 'index.js'), join(base, 'index.ts'), join(base, 'index.mts')];
  for (const candidate of candidates) if (await exists(candidate)) return true;
  return false;
}

const sourceFiles = await contents([
  ...await filesUnder('bin', ['.mjs', '.js', '.ts']),
  ...await filesUnder('runtime', ['.mjs', '.js', '.ts']),
  ...await filesUnder('packages', ['.mjs', '.js', '.ts', '.mts']),
  ...await filesUnder('functions', ['.ts', '.js', '.mjs']),
  ...await filesUnder('site/src', ['.ts', '.js', '.mjs', '.astro']),
  ...await filesUnder('scripts', ['.mjs', '.js', '.ts']),
]);

const forbiddenInstallPatterns = [
  ['legacy plugin CLI', /\bdsh\s+plugin\s+install\b/], ['legacy mcp CLI', /\bdsh\s+mcp\s+install\b/],
  ['legacy skill CLI', /\bdsh\s+skill\s+install\b/], ['legacy agent CLI', /\bdsh\s+agent\s+install\b/],
  ['legacy generic Deep Link', /dsh:\/\/install(?:[/?]|$)/], ['legacy plugin Deep Link', /dsh:\/\/plugin\/install(?:[/?]|$)/],
];

for (const entry of sourceFiles) {
  for (const spec of imports(entry.text)) if (!await relativeImportExists(entry, spec)) fail(entry.path, 'relative import target is missing', spec);
  if (/runtime\/(?:package-model|semver|resolver|solver-v2)\.mjs$/.test(entry.path)) fail(entry.path, 'duplicate protocol/resolver implementation is forbidden');
  if (/from\s+['"]\.\/(?:package-model|semver|resolver|solver-v2)\.mjs['"]/.test(entry.text)) fail(entry.path, 'deleted runtime protocol/resolver implementation import');
  if (entry.path.startsWith('site/src/') && imports(entry.text).some((value) => value.includes('/runtime/') || value.startsWith('../../../runtime') || value.startsWith('../../runtime'))) fail(entry.path, 'Site must not import Local Runtime');
  if (entry.path.startsWith('functions/') && imports(entry.text).some((value) => /runtime\/(?:installer|registry|transaction|supervisor|environment-lock|secret-store|trust-store|cas-store)/.test(value))) fail(entry.path, 'Edge functions must not import local mutation/runtime state modules');
  if (entry.path.startsWith('functions/') && /\/api\/v1(?:\/|['"`])/.test(entry.text)) fail(entry.path, 'API V1 reference is forbidden');
  if (entry.path.startsWith('functions/') && /RegistryV3|registry-v3|registry_version\s*[:=]\s*3/.test(entry.text)) fail(entry.path, 'Registry V3 Edge authority is forbidden');
  if (entry.path.startsWith('runtime/') && /function\s+(?:compareVersions|satisfiesVersion|parsePackageRequest)\b/.test(entry.text)) fail(entry.path, 'Runtime must not reimplement Package Protocol V2');
  if (entry.path.startsWith('bin/') || entry.path.startsWith('runtime/') || entry.path.startsWith('site/src/') || entry.path.startsWith('functions/')) for (const [label, pattern] of forbiddenInstallPatterns) if (pattern.test(entry.text)) fail(entry.path, label);
}

for (const legacy of [
  'bin/dsh-core.mjs', 'marketplace', 'mcp/v1', 'profiles/v1', 'skills/v1', 'agents/v1', 'functions/api/v1', 'functions/_package-request.ts', 'functions/_registry.ts', 'functions/_marketplace-v4.ts',
  'functions/api/_api-v2.ts', 'functions/api/_lib.ts', 'functions/api/_registry-v4.ts', 'functions/api/_registry-v4-query.ts', 'functions/packages/protocol-core/index.mjs', 'functions/packages/protocol-core/index.d.mts',
  'runtime/package-model.mjs', 'runtime/semver.mjs', 'runtime/resolver.mjs', 'runtime/solver-v2.mjs', 'runtime/catalog.mjs', 'runtime/registry-distribution.mjs', 'runtime/cli.mjs', 'runtime/control-cli.mjs', 'runtime/preflight.mjs', 'runtime/platform.mjs', 'runtime/registry-manager.mjs',
  'scripts/registry-builder.mjs', 'scripts/registry-distribution.mjs', 'scripts/catalog-distribution.mjs', 'scripts/sync.mjs', 'scripts/sync-v3-final.mjs',
  'schemas/dsh-marketplace-discovery.schema.json', 'schemas/dsh-package.schema.json', 'site/public/schemas/dsh-marketplace-discovery.schema.json',
  'site/src/pages/plugin/[slug].astro', 'site/src/pages/ecosystem/[id].astro', 'docs/architecture/marketplace-platform-v3.md',
]) if (await exists(resolve(ROOT, legacy))) fail(legacy, 'legacy public/core surface still exists');

const resolver = sourceFiles.find((entry) => entry.path === 'packages/resolver/index.mjs');
if (!resolver) fail('packages/resolver/index.mjs', 'canonical Resolver V2 is missing');
else {
  for (const spec of imports(resolver.text)) if (spec.startsWith('node:fs') || spec.startsWith('node:http') || spec.startsWith('node:https') || spec.includes('/runtime/')) fail(resolver.path, 'Resolver must be pure and runtime/filesystem/network independent', spec);
  if (/\bfetch\s*\(/.test(resolver.text)) fail(resolver.path, 'Resolver must not perform network I/O');
}

for (const path of ['runtime/dsh.mjs', 'runtime/client-host.mjs', 'runtime/environment-cli.mjs', 'runtime/host-bridge.mjs']) {
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
  for (const required of ["'accepted'", "'quarantined'", "'rejected'", 'candidateReport', 'release-descriptor-v2-required', 'validatePackageReleaseDescriptor']) {
    if (!candidateSource.text.includes(required)) fail(candidateSource.path, 'candidate/release authority contract missing', required);
  }
  if (/kind:\s*['"]git-source['"]/.test(candidateSource.text)) fail(candidateSource.path, 'Registry V4 installable releases must not be synthesized from mutable git-source');
}

const releaseDiscovery = sourceFiles.find((entry) => entry.path === 'runtime/release-discovery.mjs');
if (!releaseDiscovery) fail('runtime/release-discovery.mjs', 'Release Descriptor V2 runtime consumer is missing');
else {
  if (!releaseDiscovery.text.includes('validatePackageReleaseDescriptor')) fail(releaseDiscovery.path, 'runtime release discovery must delegate to Protocol Core Descriptor V2 validator');
  if (releaseDiscovery.text.includes('validateReleaseArtifact')) fail(releaseDiscovery.path, 'runtime release discovery must not duplicate Descriptor V2 artifact validation');
}

const releasePack = sourceFiles.find((entry) => entry.path === 'scripts/package-release-pack.mjs');
if (!releasePack) fail('scripts/package-release-pack.mjs', 'Release Descriptor V2 producer is missing');
else {
  for (const required of ['validatePackageReleaseDescriptor', 'published_at', 'artifact_digest']) if (!releasePack.text.includes(required)) fail(releasePack.path, 'release producer contract missing', required);
}

const registryConfig = sourceFiles.find((entry) => entry.path === 'scripts/registry-v4-config.mjs');
if (!registryConfig) fail('scripts/registry-v4-config.mjs', 'Registry V4 source/readiness policy is missing');
else for (const required of ['required_packages', 'requiredRegistryPackageFailures']) if (!registryConfig.text.includes(required)) fail(registryConfig.path, 'Registry source policy contract missing', required);

const identitySource = sourceFiles.find((entry) => entry.path === 'scripts/repository-identity.mjs');
if (!identitySource) fail('scripts/repository-identity.mjs', 'canonical discovery identity model is missing');
else {
  if (!identitySource.text.includes("DSH_MANIFEST_FILES = Object.freeze(['dsh-package.json'])")) fail(identitySource.path, 'Manifest V2 must have exactly one authoritative filename');
  for (const oldManifest of ['dsh-plugin.json', 'dsh-mcp.json', 'dsh-skill.json', 'dsh-agent.json']) if (identitySource.text.includes(oldManifest)) fail(identitySource.path, 'legacy manifest authority is forbidden', oldManifest);
  if (!identitySource.text.includes('dsh package install')) fail(identitySource.path, 'catalog install hints must use canonical package CLI');
}

const syncV4 = sourceFiles.find((entry) => entry.path === 'scripts/sync-v4.mjs');
if (!syncV4) fail('scripts/sync-v4.mjs', 'canonical Sync V4 entrypoint is missing');
else {
  if (!syncV4.text.includes('discovery-sync.mjs')) fail(syncV4.path, 'Sync V4 must invoke the discovery collector by its non-authoritative name');
  if (!syncV4.text.includes('requiredRegistryPackageFailures')) fail(syncV4.path, 'Sync V4 must fail closed on required official Descriptor V2 releases');
}

for (const path of ['README.md', 'site/public/openapi.json', 'site/public/.well-known/dsh-marketplace.json']) {
  const file = resolve(ROOT, path);
  if (!await exists(file)) { fail(path, 'required public surface is missing'); continue; }
  const text = await readFile(file, 'utf8');
  for (const [label, pattern] of forbiddenInstallPatterns) if (pattern.test(text)) fail(path, label);
  if (/\/api\/v1(?:\/|["'`]|\b)/.test(text)) fail(path, 'API V1 reference is forbidden');
  if (/Registry V3|Distribution V1|Search Index V2/.test(text)) fail(path, 'legacy public architecture wording is forbidden');
}

const discoveryDoc = resolve(ROOT, 'site/public/.well-known/dsh-marketplace.json');
if (await exists(discoveryDoc)) {
  try {
    const discovery = JSON.parse(await readFile(discoveryDoc, 'utf8'));
    if (discovery.schema !== 'dsh-marketplace-discovery.v2') fail('site/public/.well-known/dsh-marketplace.json', 'discovery contract must be V2');
    if (Number(discovery.registry?.version) !== 4) fail('site/public/.well-known/dsh-marketplace.json', 'Registry authority must be V4');
    if (discovery.api?.version !== 'v2') fail('site/public/.well-known/dsh-marketplace.json', 'API authority must be V2');
  } catch (error) { fail('site/public/.well-known/dsh-marketplace.json', 'invalid JSON', error.message); }
}
if (!await exists(resolve(ROOT, 'site/public/schemas/dsh-marketplace-discovery-v2.schema.json'))) fail('site/public/schemas/dsh-marketplace-discovery-v2.schema.json', 'public discovery V2 schema is missing');

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
const visiting = new Set(); const visited = new Set();
function visit(node, stack = []) {
  if (visiting.has(node)) { fail(`packages/${node}`, 'circular internal package dependency', [...stack, node].join(' -> ')); return; }
  if (visited.has(node)) return;
  visiting.add(node); for (const next of graph.get(node) || []) visit(next, [...stack, node]); visiting.delete(node); visited.add(node);
}
for (const node of graph.keys()) visit(node);

const expectedAuthorities = [
  'packages/protocol-core/index.mjs', 'packages/protocol-core/manifest.mjs', 'packages/registry-core/index.mjs', 'packages/resolver/index.mjs', 'packages/policy-core/index.mjs', 'packages/policy-core/permissions.mjs',
  'runtime/supervisor.mjs', 'runtime/transaction.mjs', 'runtime/activation-manager.mjs', 'runtime/cas-store.mjs', 'runtime/trust-store.mjs', 'runtime/secret-store.mjs', 'runtime/secret-provider.mjs', 'runtime/audit-log.mjs', 'runtime/adapters/index.mjs', 'runtime/release-discovery.mjs',
  'scripts/discovery-sync.mjs', 'scripts/registry-v4-source.mjs', 'scripts/registry-v4-config.mjs', 'scripts/sync-v4.mjs', 'scripts/package-release-pack.mjs',
];
for (const path of expectedAuthorities) if (!await exists(resolve(ROOT, path))) fail(path, 'required canonical authority is missing');

if (errors.length) {
  console.error('Architecture Conformance Gate failed:');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}
console.log(`Architecture Conformance Gate passed: ${sourceFiles.length} source files checked; canonical authorities=${expectedAuthorities.length}`);
