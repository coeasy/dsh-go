#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  assertProviderAdapter,
  createProviderAdapterRelease,
  normalizeAdapterPath,
  providerAdapterDigest,
  stableStringify,
} from '../runtime/provider-adapter.mjs';

const MAX_FILES = 2048;
const MAX_UNPACKED_BYTES = 50 * 1024 * 1024;

function digest(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function writeString(header, offset, length, value) {
  const data = Buffer.from(String(value || ''), 'utf8');
  if (data.length > length) throw new Error(`tar header value is too long: ${value}`);
  data.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const text = Math.max(0, Number(value) || 0).toString(8).padStart(length - 1, '0');
  if (text.length >= length) throw new Error(`tar numeric field overflow: ${value}`);
  writeString(header, offset, length, `${text}\0`);
}

function splitTarPath(path) {
  if (Buffer.byteLength(path) <= 100) return { name: path, prefix: '' };
  const parts = path.split('/');
  for (let index = parts.length - 1; index > 0; index--) {
    const prefix = parts.slice(0, index).join('/');
    const name = parts.slice(index).join('/');
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`provider adapter archive path exceeds USTAR limits: ${path}`);
}

function tarHeader(entry) {
  const header = Buffer.alloc(512, 0);
  const { name, prefix } = splitTarPath(entry.path);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, entry.mode);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, entry.content.length);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = '0'.charCodeAt(0);
  writeString(header, 257, 6, 'ustar\0');
  writeString(header, 263, 2, '00');
  writeString(header, 345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  const text = checksum.toString(8).padStart(6, '0');
  writeString(header, 148, 8, `${text}\0 `);
  return header;
}

function makeTar(entries) {
  const parts = [];
  for (const entry of entries) {
    parts.push(tarHeader(entry), entry.content);
    const remainder = entry.content.length % 512;
    if (remainder) parts.push(Buffer.alloc(512 - remainder, 0));
  }
  parts.push(Buffer.alloc(1024, 0));
  return Buffer.concat(parts);
}

function withinRoot(rootReal, targetReal) {
  return targetReal === rootReal || targetReal.startsWith(`${rootReal}${sep}`);
}

async function addFile(entries, root, rootReal, sourcePath, archivePath) {
  const safePath = normalizeAdapterPath(archivePath);
  const file = resolve(root, sourcePath);
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`provider adapter files cannot contain symlinks: ${sourcePath}`);
  const actual = await realpath(file);
  if (!withinRoot(rootReal, actual)) throw new Error(`provider adapter file escapes package root: ${sourcePath}`);
  if (!info.isFile()) throw new Error(`provider adapter file is not regular: ${sourcePath}`);
  const content = await readFile(file);
  entries.set(safePath, { path: safePath, mode: info.mode & 0o111 ? 0o755 : 0o644, content, sha256: digest(content) });
}

async function collectDeclaredPath(entries, root, rootReal, declared) {
  const safe = normalizeAdapterPath(declared);
  const file = resolve(root, safe);
  const info = await lstat(file);
  if (info.isSymbolicLink()) throw new Error(`provider adapter files cannot contain symlinks: ${safe}`);
  const actual = await realpath(file);
  if (!withinRoot(rootReal, actual)) throw new Error(`provider adapter path escapes package root: ${safe}`);
  if (info.isFile()) return addFile(entries, root, rootReal, safe, safe);
  if (!info.isDirectory()) throw new Error(`provider adapter path must be a file or directory: ${safe}`);
  const names = (await readdir(file)).sort();
  for (const name of names) {
    const child = `${safe}/${name}`;
    await collectDeclaredPath(entries, root, rootReal, child);
  }
}

export async function collectProviderAdapterFiles(manifestFile = 'provider-adapter.json') {
  const manifestPath = resolve(manifestFile);
  const root = dirname(manifestPath);
  const rootReal = await realpath(root);
  const source = JSON.parse(await readFile(manifestPath, 'utf8'));
  const adapter = assertProviderAdapter(source);
  const entries = new Map();
  const manifestContent = Buffer.from(`${stableStringify(source)}\n`, 'utf8');
  entries.set('provider-adapter.json', {
    path: 'provider-adapter.json',
    mode: 0o644,
    content: manifestContent,
    sha256: digest(manifestContent),
  });
  for (const declared of adapter.files) await collectDeclaredPath(entries, root, rootReal, declared);
  const files = [...entries.values()].sort((a, b) => a.path.localeCompare(b.path));
  const unpackedBytes = files.reduce((sum, file) => sum + file.content.length, 0);
  if (files.length > MAX_FILES) throw new Error(`provider adapter archive exceeds ${MAX_FILES} files`);
  if (unpackedBytes > MAX_UNPACKED_BYTES) throw new Error(`provider adapter archive exceeds ${MAX_UNPACKED_BYTES} unpacked bytes`);
  return { adapter, files, root, unpackedBytes };
}

function createSbom(adapter, files, manifestHash) {
  return {
    spdxVersion: 'SPDX-2.3',
    dataLicense: 'CC0-1.0',
    SPDXID: 'SPDXRef-DOCUMENT',
    name: `${adapter.id}-${adapter.version}`,
    documentNamespace: `https://dsh.dev/provider-adapter/${adapter.id}/${adapter.version}/${manifestHash}`,
    creationInfo: { created: '1970-01-01T00:00:00Z', creators: ['Tool: dsh-go-provider-adapter-pack'] },
    packages: [{
      SPDXID: 'SPDXRef-Package',
      name: adapter.name,
      versionInfo: adapter.version,
      downloadLocation: 'NOASSERTION',
      filesAnalyzed: true,
      licenseConcluded: adapter.security?.license || 'NOASSERTION',
      licenseDeclared: adapter.security?.license || 'NOASSERTION',
    }],
    files: files.map((file, index) => ({
      SPDXID: `SPDXRef-File-${index + 1}`,
      fileName: file.path,
      checksums: [{ algorithm: 'SHA256', checksumValue: file.sha256 }],
      licenseConcluded: 'NOASSERTION',
      copyrightText: 'NOASSERTION',
    })),
    relationships: files.map((_, index) => ({
      spdxElementId: 'SPDXRef-Package',
      relationshipType: 'CONTAINS',
      relatedSpdxElement: `SPDXRef-File-${index + 1}`,
    })),
  };
}

export async function buildProviderAdapterPackage(manifestFile = 'provider-adapter.json', options = {}) {
  const { adapter, files, unpackedBytes } = await collectProviderAdapterFiles(manifestFile);
  const tar = makeTar(files);
  const archive = gzipSync(tar, { level: 9, mtime: 0 });
  const archiveName = `${adapter.id}-${adapter.version}.tgz`;
  const tag = String(options.tag || `v${adapter.version}`);
  const repository = String(options.repository || '').trim();
  const commit = String(options.commit || '').trim();
  const artifactUrl = String(options.artifactUrl || (repository ? `https://github.com/${repository}/releases/download/${encodeURIComponent(tag)}/${archiveName}` : '')).trim();
  const source = repository || commit ? { repository, commit, tag } : null;
  const release = createProviderAdapterRelease(adapter, {
    integrity: `sha256-${digest(archive)}`,
    size: archive.length,
    file_name: archiveName,
    ...(artifactUrl ? { url: artifactUrl } : {}),
  }, source);
  const sbom = createSbom(adapter, files, providerAdapterDigest(adapter));
  return { adapter, release, archive, archiveName, sbom, files, unpackedBytes, tag };
}

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function writeGithubOutput(file, values) {
  if (!file) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value).replace(/\n/g, '%0A')}`).join('\n');
  await writeFile(file, `${lines}\n`, { flag: 'a' });
}

export async function packProviderAdapterCli(args = process.argv.slice(2)) {
  const manifest = args.find((value) => !value.startsWith('--') && !['pack'].includes(value)) || 'provider-adapter.json';
  const outDir = resolve(option(args, '--out-dir', 'dist'));
  const repository = option(args, '--repository', process.env.GITHUB_REPOSITORY || '');
  const commit = option(args, '--commit', process.env.GITHUB_SHA || '');
  const tag = option(args, '--tag');
  const artifactUrl = option(args, '--artifact-url');
  await mkdir(outDir, { recursive: true });
  const result = await buildProviderAdapterPackage(manifest, { repository, commit, tag, artifactUrl });
  const archivePath = join(outDir, result.archiveName);
  const releasePath = join(outDir, 'provider-adapter-release.json');
  const sbomPath = join(outDir, 'provider-adapter-sbom.spdx.json');
  const sumsPath = join(outDir, 'SHA256SUMS');
  await writeFile(archivePath, result.archive);
  const releaseText = `${JSON.stringify(result.release, null, 2)}\n`;
  const sbomText = `${JSON.stringify(result.sbom, null, 2)}\n`;
  await writeFile(releasePath, releaseText, 'utf8');
  await writeFile(sbomPath, sbomText, 'utf8');
  const sums = [
    `${digest(result.archive)}  ${result.archiveName}`,
    `${digest(Buffer.from(releaseText))}  provider-adapter-release.json`,
    `${digest(Buffer.from(sbomText))}  provider-adapter-sbom.spdx.json`,
  ].join('\n');
  await writeFile(sumsPath, `${sums}\n`, 'utf8');
  const githubOutput = option(args, '--github-output', process.env.GITHUB_OUTPUT || '');
  await writeGithubOutput(githubOutput, {
    id: result.adapter.id,
    version: result.adapter.version,
    channel: result.adapter.release.channel,
    tag: result.tag,
    archive: archivePath,
    archive_name: result.archiveName,
    release_json: releasePath,
    sbom: sbomPath,
    checksums: sumsPath,
    release_id: result.release.release_id,
    artifact_integrity: result.release.artifact.integrity,
  });
  return { ...result, archivePath, releasePath, sbomPath, sumsPath };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  packProviderAdapterCli().then((result) => {
    console.log(JSON.stringify({
      id: result.adapter.id,
      version: result.adapter.version,
      channel: result.adapter.release.channel,
      tag: result.tag,
      release_id: result.release.release_id,
      artifact: result.release.artifact,
      files: result.files.length,
      unpacked_bytes: result.unpackedBytes,
    }, null, 2));
  }).catch((error) => {
    console.error(`[provider-pack] ${error.stack || error.message}`);
    process.exit(1);
  });
}
