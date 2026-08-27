import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const DIGEST_RE = /^sha256-[0-9a-f]{64}$/i;
const FORMATS = new Set(['tgz', 'tar.gz']);

export function isReleaseArtifact(artifact) {
  return artifact?.kind === 'release-archive';
}

export function validateReleaseArtifact(artifact) {
  const errors = [];
  if (!isReleaseArtifact(artifact)) errors.push('artifact.kind must be release-archive');
  let url = null;
  try { url = new URL(String(artifact?.url || '')); } catch { errors.push('artifact.url must be a valid URL'); }
  if (url && url.protocol !== 'https:') errors.push('artifact.url must use https');
  if (!DIGEST_RE.test(String(artifact?.digest || ''))) errors.push('artifact.digest must be sha256-<64 hex>');
  if (!FORMATS.has(String(artifact?.format || ''))) errors.push('artifact.format must be tgz or tar.gz');
  const strip = Number(artifact?.strip_components ?? 1);
  if (!Number.isInteger(strip) || strip < 0 || strip > 8) errors.push('artifact.strip_components must be an integer between 0 and 8');
  return { ok: errors.length === 0, errors, strip_components: strip };
}

function assertSafeArchiveEntry(entry) {
  const normalized = String(entry || '').replaceAll('\\', '/').replace(/^\.\//, '');
  if (!normalized || normalized === '.') return;
  if (normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) throw new Error(`unsafe absolute archive path: ${entry}`);
  if (normalized.split('/').some((segment) => segment === '..')) throw new Error(`unsafe parent archive path: ${entry}`);
}

async function assertExtractedTreeInside(root) {
  const rootReal = await realpath(root);
  const prefix = rootReal.endsWith(sep) ? rootReal : rootReal + sep;
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const actual = await realpath(path);
      if (actual !== rootReal && !actual.startsWith(prefix)) throw new Error(`archive entry escapes install root: ${entry.name}`);
      if (entry.isDirectory()) await walk(path);
    }
  }
  await walk(rootReal);
}

export async function downloadReleaseArtifact(artifact, file, options = {}) {
  const validation = validateReleaseArtifact(artifact);
  if (!validation.ok) throw new Error(`invalid release artifact: ${validation.errors.join('; ')}`);
  await mkdir(dirname(resolve(file)), { recursive: true });
  const response = await fetch(artifact.url, {
    headers: { Accept: 'application/octet-stream', 'User-Agent': 'dsh-runtime-release-installer' },
    redirect: 'follow',
    signal: AbortSignal.timeout(Number(options.timeout || 60000)),
  });
  if (!response.ok || !response.body) throw new Error(`release artifact download failed: HTTP ${response.status}`);
  const finalUrl = new URL(response.url || artifact.url);
  if (finalUrl.protocol !== 'https:') throw new Error('release artifact redirect downgraded from https');

  const hash = createHash('sha256');
  const digesting = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  try {
    await pipeline(Readable.fromWeb(response.body), digesting, createWriteStream(file, { flags: 'wx' }));
  } catch (error) {
    await rm(file, { force: true });
    throw error;
  }
  const digest = `sha256-${hash.digest('hex')}`;
  if (digest.toLowerCase() !== String(artifact.digest).toLowerCase()) {
    await rm(file, { force: true });
    const error = new Error(`release artifact digest mismatch: expected ${artifact.digest}, got ${digest}`);
    error.code = 'DSH_RELEASE_ARTIFACT_DIGEST_MISMATCH';
    throw error;
  }
  return { file: resolve(file), digest, url: finalUrl.href };
}

export async function extractReleaseArtifact(file, target, artifact) {
  const validation = validateReleaseArtifact(artifact);
  if (!validation.ok) throw new Error(`invalid release artifact: ${validation.errors.join('; ')}`);
  const { stdout } = await exec('tar', ['-tzf', resolve(file)], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  for (const entry of stdout.split(/\r?\n/).filter(Boolean)) assertSafeArchiveEntry(entry);
  await mkdir(target, { recursive: true });
  const args = ['-xzf', resolve(file), '-C', resolve(target)];
  if (validation.strip_components > 0) args.push(`--strip-components=${validation.strip_components}`);
  await exec('tar', args, { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
  await assertExtractedTreeInside(target);
  return { target: resolve(target), entries: stdout.split(/\r?\n/).filter(Boolean).length };
}

export async function installReleaseArtifact(artifact, target, options = {}) {
  const archive = `${resolve(target)}.download.tgz`;
  await rm(archive, { force: true });
  try {
    const downloaded = await downloadReleaseArtifact(artifact, archive, options);
    const extracted = await extractReleaseArtifact(archive, target, artifact);
    return { ...downloaded, ...extracted, verified: true };
  } finally {
    await rm(archive, { force: true });
  }
}
