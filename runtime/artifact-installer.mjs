import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, open, readdir, realpath, rm } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { assertSafeEvidenceResolution, assertSafeEvidenceUrl } from './supply-chain-verifier.mjs';

const exec = promisify(execFile);
const DIGEST_RE = /^sha256-[0-9a-f]{64}$/i;
const FORMATS = new Set(['tgz', 'tar.gz']);
const DEFAULT_ARTIFACT_TIMEOUT_MS = 60_000;
const DEFAULT_ARTIFACT_MAX_BYTES = 256 * 1024 * 1024;
const MAX_ARTIFACT_REDIRECTS = 3;

function positiveOption(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function isReleaseArtifact(artifact) {
  return artifact?.kind === 'release-archive';
}

export function validateReleaseArtifact(artifact) {
  const errors = [];
  if (!isReleaseArtifact(artifact)) errors.push('artifact.kind must be release-archive');
  try { assertSafeEvidenceUrl(String(artifact?.url || '')); }
  catch (error) { errors.push(`artifact.url is unsafe: ${error instanceof Error ? error.message : String(error)}`); }
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

async function fetchReleaseResponse(url, options, timeoutMs) {
  let current = assertSafeEvidenceUrl(url);
  const fetchImpl = options.fetch || fetch;
  for (let redirect = 0; redirect <= MAX_ARTIFACT_REDIRECTS; redirect += 1) {
    await assertSafeEvidenceResolution(current, { lookup: options.lookup, timeoutMs });
    const response = await fetchImpl(current, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'dsh-runtime-release-installer' },
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      if (redirect === MAX_ARTIFACT_REDIRECTS) throw new Error('release artifact has too many redirects');
      const location = response.headers.get('location');
      if (!location) throw new Error(`release artifact redirect ${response.status} has no location`);
      current = assertSafeEvidenceUrl(new URL(location, current));
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`release artifact download failed: HTTP ${response.status}`);
    return { response, finalUrl: current };
  }
  throw new Error('release artifact has too many redirects');
}

export async function downloadReleaseArtifact(artifact, file, options = {}) {
  const validation = validateReleaseArtifact(artifact);
  if (!validation.ok) throw new Error(`invalid release artifact: ${validation.errors.join('; ')}`);
  const timeoutMs = positiveOption(options.timeout, DEFAULT_ARTIFACT_TIMEOUT_MS);
  const maxBytes = positiveOption(options.maxBytes, DEFAULT_ARTIFACT_MAX_BYTES);
  await mkdir(dirname(resolve(file)), { recursive: true });
  const { response, finalUrl } = await fetchReleaseResponse(artifact.url, options, timeoutMs);
  const contentLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    const error = new Error(`release artifact exceeds ${maxBytes} bytes`);
    error.code = 'DSH_RELEASE_ARTIFACT_TOO_LARGE';
    throw error;
  }

  const hash = createHash('sha256');
  let bytes = 0;
  const digesting = new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.byteLength;
      if (bytes > maxBytes) {
        const error = new Error(`release artifact exceeds ${maxBytes} bytes`);
        error.code = 'DSH_RELEASE_ARTIFACT_TOO_LARGE';
        callback(error);
        return;
      }
      hash.update(chunk);
      callback(null, chunk);
    },
  });
  const handle = await open(file, 'wx', 0o600);
  let pipelineError = null;
  try {
    try {
      await pipeline(Readable.fromWeb(response.body), digesting, createWriteStream(file, { fd: handle.fd, autoClose: false }));
    } catch (error) {
      pipelineError = error;
      throw error;
    }
  } finally {
    await handle.close().catch((closeError) => {
      if (pipelineError) {
        pipelineError.filesystem_close_error = closeError.message;
        pipelineError.recovery_required = true;
      } else {
        throw closeError;
      }
    });
    if (pipelineError) {
      await rm(file, { force: true }).catch((cleanupError) => {
        pipelineError.filesystem_cleanup_error = cleanupError.message;
        pipelineError.recovery_required = true;
      });
    }
  }
  const digest = `sha256-${hash.digest('hex')}`;
  if (digest.toLowerCase() !== String(artifact.digest).toLowerCase()) {
    const error = new Error(`release artifact digest mismatch: expected ${artifact.digest}, got ${digest}`);
    error.code = 'DSH_RELEASE_ARTIFACT_DIGEST_MISMATCH';
    await rm(file, { force: true }).catch((cleanupError) => {
      error.filesystem_cleanup_error = cleanupError.message;
      error.recovery_required = true;
    });
    throw error;
  }
  return { file: resolve(file), digest, url: finalUrl.href };
}

export async function extractReleaseArtifact(file, target, artifact, options = {}) {
  const validation = validateReleaseArtifact(artifact);
  if (!validation.ok) throw new Error(`invalid release artifact: ${validation.errors.join('; ')}`);
  const timeout = positiveOption(options.commandTimeout ?? options.timeout, DEFAULT_ARTIFACT_TIMEOUT_MS);
  const execOptions = { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout, killSignal: 'SIGTERM' };
  const { stdout } = await exec('tar', ['-tzf', resolve(file)], execOptions);
  for (const entry of stdout.split(/\r?\n/).filter(Boolean)) assertSafeArchiveEntry(entry);
  await mkdir(target, { recursive: true });
  const args = ['-xzf', resolve(file), '-C', resolve(target)];
  if (validation.strip_components > 0) args.push(`--strip-components=${validation.strip_components}`);
  await exec('tar', args, execOptions);
  await assertExtractedTreeInside(target);
  return { target: resolve(target), entries: stdout.split(/\r?\n/).filter(Boolean).length };
}

export async function installReleaseArtifact(artifact, target, options = {}) {
  const archive = `${resolve(target)}.download.tgz`;
  await rm(archive, { force: true });
  try {
    const downloaded = await downloadReleaseArtifact(artifact, archive, options);
    const extracted = await extractReleaseArtifact(archive, target, artifact, options);
    return { ...downloaded, ...extracted, verified: true };
  } finally {
    await rm(archive, { force: true }).catch(() => {});
  }
}
