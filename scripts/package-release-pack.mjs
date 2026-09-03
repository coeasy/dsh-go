#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, join, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { findPackageManifest } from '../runtime/package-manifest.mjs';
import { generateSbom } from './generate-sbom.mjs';

const exec = promisify(execFile);
const DEFAULT_GIT_TIMEOUT_MS = 120_000;

function gitTimeout(value) {
  const number = Number(value ?? process.env.DSH_GIT_TIMEOUT_MS);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_GIT_TIMEOUT_MS;
}

function option(name, fallback = undefined) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

async function sha256File(file) {
  return `sha256-${createHash('sha256').update(await readFile(file)).digest('hex')}`;
}

function safeName(value) {
  return String(value || 'package').replace(/[^A-Za-z0-9_.-]+/g, '-');
}

async function git(root, args, options = {}) {
  const { stdout } = await exec('git', args, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: gitTimeout(options.timeoutMs),
    killSignal: 'SIGTERM',
  });
  return stdout.trim();
}

function packageScope(root, rawPath) {
  const raw = String(rawPath || '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw === '.') return { root, path: '', stripComponents: 1 };
  if (raw.startsWith('/') || raw.split('/').some((part) => !part || part === '..')) {
    throw new Error('package-path must be a safe repository-relative directory');
  }
  const packageRoot = resolve(root, raw);
  const relativePath = relative(root, packageRoot).split(sep).join('/');
  if (!relativePath || relativePath.startsWith('../') || relativePath.includes('/../')) {
    throw new Error('package-path must stay inside repository root');
  }
  return { root: packageRoot, path: relativePath, stripComponents: relativePath.split('/').length + 1 };
}

function minimalSbom(manifest) {
  const seed = `${manifest.id}@${manifest.version}:${manifest.type}`;
  const digest = createHash('sha256').update(seed).digest('hex');
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.6',
    version: 1,
    serialNumber: `urn:uuid:${digest.slice(0, 8)}-${digest.slice(8, 12)}-4${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`,
    metadata: { component: { type: 'application', name: manifest.id, version: manifest.version } },
    components: [],
  };
}

async function main() {
  const root = resolve(option('--root', process.cwd()));
  const scope = packageScope(root, option('--package-path', ''));
  const packageRoot = scope.root;
  const outDir = resolve(option('--out-dir', join(root, 'dist')));
  const repository = option('--repository', process.env.GITHUB_REPOSITORY || '');
  const commandOptions = { timeoutMs: option('--timeout') };
  const commit = String(option('--commit', process.env.GITHUB_SHA || await git(root, ['rev-parse', 'HEAD'], commandOptions))).toLowerCase();
  const githubOutput = option('--github-output', process.env.GITHUB_OUTPUT || '');
  const found = await findPackageManifest(packageRoot);
  if (!found) throw new Error('no DSH package manifest found');
  if (!found.valid) throw new Error(`DSH package manifest is invalid: ${found.errors.join('; ')}`);
  if (!repository.includes('/')) throw new Error('repository must be owner/name');
  if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('commit must be an immutable 40-character SHA');

  const manifest = found.manifest;
  if (!manifest.id || !/^[A-Za-z0-9_.-]+$/.test(manifest.id)) throw new Error('package manifest id is required and must be release-safe');
  if (!manifest.type || !['plugin', 'mcp', 'skill', 'agent'].includes(manifest.type)) throw new Error('package manifest type is required');
  if (!manifest.version) throw new Error('package manifest version is required');
  const tag = option('--tag', manifest.release_tag || (scope.path ? `${safeName(manifest.id)}-v${manifest.version}` : `v${manifest.version}`));
  const channel = option('--channel', 'stable');
  if (!['stable', 'beta', 'nightly', 'dev'].includes(channel)) throw new Error(`unsupported release channel: ${channel}`);
  const archiveName = `${safeName(manifest.id)}-${manifest.version}.tgz`;
  const archiveFile = join(outDir, archiveName);
  const descriptorFile = join(outDir, 'dsh-package-release.json');
  const sbomFile = join(outDir, 'dsh-package-sbom.cdx.json');
  const sumsFile = join(outDir, 'SHA256SUMS');
  await mkdir(outDir, { recursive: true });

  const archiveArgs = ['archive', '--format=tar.gz', '--prefix=package/', `--output=${archiveFile}`, commit];
  if (scope.path) archiveArgs.push('--', scope.path);
  await exec('git', archiveArgs, {
    cwd: root,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
    timeout: gitTimeout(commandOptions.timeoutMs),
    killSignal: 'SIGTERM',
  });
  const digest = await sha256File(archiveFile);
  const artifactUrl = `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${archiveName}`;
  const descriptor = {
    release_version: 1,
    id: manifest.id,
    type: manifest.type,
    version: manifest.version,
    channel,
    repository,
    commit,
    tag,
    manifest_file: found.file,
    package_path: scope.path || null,
    manifest,
    artifact: {
      kind: 'release-archive',
      url: artifactUrl,
      digest,
      format: 'tgz',
      strip_components: scope.stripComponents,
    },
  };
  await writeFile(descriptorFile, `${JSON.stringify(descriptor, null, 2)}\n`, 'utf8');

  let sbom;
  try { sbom = await generateSbom(packageRoot); }
  catch { sbom = minimalSbom(manifest); }
  await writeFile(sbomFile, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');

  const files = [archiveFile, descriptorFile, sbomFile];
  const lines = [];
  for (const file of files) lines.push(`${(await sha256File(file)).slice('sha256-'.length)}  ${basename(file)}`);
  await writeFile(sumsFile, `${lines.join('\n')}\n`, 'utf8');

  const output = {
    id: manifest.id,
    type: manifest.type,
    version: manifest.version,
    channel,
    tag,
    commit,
    package_path: scope.path || null,
    archive_name: archiveName,
    archive_file: archiveFile,
    artifact_digest: digest,
    descriptor_file: descriptorFile,
    sbom_file: sbomFile,
    sums_file: sumsFile,
  };
  if (githubOutput) {
    await writeFile(githubOutput, Object.entries(output).map(([key, value]) => `${key}=${value}`).join('\n') + '\n', { flag: 'a' });
  }
  console.log(JSON.stringify(output, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
