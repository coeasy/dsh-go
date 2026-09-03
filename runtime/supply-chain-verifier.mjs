import { createHash } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { open, realpath } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findPackageManifest } from './package-manifest.mjs';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const SHA256_RE = /^(?:sha256:)?([a-f0-9]{64})$/i;
const MAX_REDIRECTS = 3;
const MAX_ABORT_TIMEOUT_MS = 2_147_483_647;

function abortTimeout(value, fallback = 10_000) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? Math.min(candidate, MAX_ABORT_TIMEOUT_MS) : fallback;
}

function normalizeDigest(value) {
  const match = String(value || '').trim().match(SHA256_RE);
  return match ? match[1].toLowerCase() : null;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function privateOrSpecialIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b, c] = parts;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 0 && c === 0)
    || (a === 192 && b === 0 && c === 2)
    || (a === 192 && b === 88 && c === 99)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19))
    || (a === 198 && b === 51 && c === 100)
    || (a === 203 && b === 0 && c === 113)
    || a >= 224;
}

function privateOrSpecialIpv6(host) {
  const normalized = host.toLowerCase();
  if (normalized === '::1' || normalized === '::' || normalized.startsWith('::ffff:')) return true;
  if (normalized.startsWith('2001:db8:') || normalized === '2001:db8::' || normalized.startsWith('2002:')) return true;
  const first = Number.parseInt(normalized.split(':', 1)[0] || '0', 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00
    || (first & 0xffc0) === 0xfe80
    || (first & 0xff00) === 0xff00;
}

function unsafeIp(host) {
  const version = isIP(host);
  if (version === 4) return privateOrSpecialIpv4(host);
  if (version === 6) return privateOrSpecialIpv6(host);
  return false;
}

function normalizedHostname(url) {
  return url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
}

export function assertSafeEvidenceUrl(value) {
  const url = value instanceof URL ? new URL(value.toString()) : new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('remote evidence URL must use HTTPS');
  const host = normalizedHostname(url);
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('remote evidence URL cannot target localhost');
  if (unsafeIp(host)) throw new Error('remote evidence URL cannot target a private, loopback, link-local, or reserved IP');
  if (url.username || url.password) throw new Error('remote evidence URL cannot contain credentials');
  if (url.hash) throw new Error('remote evidence URL cannot contain a fragment');
  return url;
}

function timeoutError(message) {
  const error = new Error(message);
  error.code = 'DSH_EVIDENCE_TIMEOUT';
  return error;
}

async function withTimeout(task, timeoutMs, message) {
  let timer;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => { timer = setTimeout(() => reject(timeoutError(message)), timeoutMs); }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function assertSafeEvidenceResolution(value, options = {}) {
  const url = assertSafeEvidenceUrl(value);
  const host = normalizedHostname(url);
  const literalVersion = isIP(host);
  if (literalVersion) return [{ address: host, family: literalVersion }];

  const resolver = options.lookup || lookup;
  const timeoutMs = abortTimeout(options.timeoutMs);
  let answers;
  try {
    answers = await withTimeout(
      Promise.resolve(resolver(host, { all: true, verbatim: true })),
      timeoutMs,
      `evidence DNS resolution timed out: ${host}`,
    );
  } catch (error) {
    if (error?.code === 'DSH_EVIDENCE_TIMEOUT') throw error;
    throw new Error(`remote evidence host cannot be resolved: ${host}`);
  }
  const list = Array.isArray(answers) ? answers : [answers];
  if (!list.length) throw new Error(`remote evidence host has no addresses: ${host}`);
  const normalized = list.map((item) => ({
    address: typeof item === 'string' ? item : item?.address,
    family: typeof item === 'object' ? item?.family : isIP(String(item || '')),
  }));
  if (normalized.some((item) => !item.address || !isIP(item.address))) {
    throw new Error(`remote evidence host returned an invalid address: ${host}`);
  }
  if (normalized.some((item) => unsafeIp(item.address))) {
    throw new Error(`remote evidence host resolves to a private, loopback, link-local, or reserved IP: ${host}`);
  }
  return normalized;
}

function insidePath(base, candidate) {
  const normalize = (value) => process.platform === 'win32' ? value.toLowerCase() : value;
  const root = normalize(base);
  const target = normalize(candidate);
  return target === root || target.startsWith(`${root}${sep}`);
}

async function localEvidencePath(root, value) {
  const lexicalBase = resolve(root);
  const raw = String(value || '');
  let lexicalPath;
  if (raw.startsWith('file:')) lexicalPath = resolve(fileURLToPath(new URL(raw)));
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) lexicalPath = resolve(lexicalBase, raw);
  else return null;
  if (!insidePath(lexicalBase, lexicalPath)) throw new Error('local evidence path escapes package root');

  const [base, path] = await Promise.all([realpath(lexicalBase), realpath(lexicalPath)]);
  if (!insidePath(base, path)) throw new Error('local evidence path escapes package root through a symlink');
  return path;
}

async function boundedRead(path) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('evidence must be a regular file');
    if (info.size > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    return buffer;
  } finally {
    await handle.close();
  }
}

async function boundedResponseBody(response) {
  const length = Number(response.headers.get('content-length'));
  if (Number.isFinite(length) && length > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  if (!response.body?.getReader) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    return buffer;
  }

  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = Buffer.from(value);
      total += chunk.byteLength;
      if (total > MAX_EVIDENCE_BYTES) {
        await reader.cancel('evidence size limit exceeded').catch(() => {});
        throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

async function fetchEvidence(url, options = {}) {
  let current = assertSafeEvidenceUrl(url);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    await assertSafeEvidenceResolution(current, options);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), abortTimeout(options.timeoutMs));
    let response;
    try {
      response = await (options.fetch || fetch)(current, {
        redirect: 'manual',
        signal: controller.signal,
        headers: { accept: 'application/octet-stream, application/json, text/plain;q=0.9' },
      });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`evidence redirect ${response.status} has no location`);
      current = assertSafeEvidenceUrl(new URL(location, current));
      continue;
    }
    if (!response.ok) throw new Error(`evidence fetch failed: HTTP ${response.status}`);
    return { buffer: await boundedResponseBody(response), final_url: current.toString() };
  }
  throw new Error('too many evidence redirects');
}

function evidenceReference(value) {
  if (!value) return null;
  if (typeof value === 'string') return { uri: value };
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  return {
    uri: value.uri || value.bundle || value.path || null,
    digest: value.digest || value.sha256 || null,
    identity: value.identity || null,
  };
}

function evidenceResult(kind, reference = null, expected = null) {
  return {
    kind,
    status: reference ? 'declared' : 'missing',
    declared: Boolean(reference),
    verified: false,
    uri: reference?.uri || null,
    identity: reference?.identity || null,
    expected_sha256: expected,
    actual_sha256: null,
    source: null,
    reason: reference ? null : 'evidence is not declared',
  };
}

export async function verifyEvidenceReference(kind, value, options = {}) {
  const reference = evidenceReference(value);
  if (!reference) return evidenceResult(kind);
  const expected = normalizeDigest(reference.digest);
  const result = evidenceResult(kind, reference, expected);
  if (!reference.uri) {
    result.reason = kind === 'signature' ? 'signature identity/bundle is declared but no verifiable bundle URI/path was supplied' : 'evidence URI/path is not declared';
    return result;
  }
  if (!expected) {
    result.reason = 'SHA-256 digest is required before evidence can be marked verified';
    return result;
  }

  const root = resolve(options.root || process.cwd());
  try {
    const local = await localEvidencePath(root, reference.uri);
    let buffer;
    let source;
    if (local) {
      buffer = await boundedRead(local);
      source = pathToFileURL(local).toString();
    } else {
      const url = assertSafeEvidenceUrl(reference.uri);
      if (!options.online) {
        result.status = 'declared-remote';
        result.reason = 'remote evidence is declared; rerun with online verification to fetch and verify the digest';
        return result;
      }
      const fetched = await fetchEvidence(url, options);
      buffer = fetched.buffer;
      source = fetched.final_url;
    }
    result.actual_sha256 = sha256(buffer);
    result.source = source;
    if (result.actual_sha256 !== expected) {
      result.status = 'digest-mismatch';
      result.reason = 'evidence SHA-256 digest does not match';
      return result;
    }
    result.status = 'verified-digest';
    result.verified = true;
    result.reason = kind === 'signature'
      ? 'signature bundle bytes match the declared digest; cryptographic signer verification still requires an authorized signature verifier'
      : 'evidence bytes match the declared SHA-256 digest';
    return result;
  } catch (error) {
    result.status = 'verification-error';
    result.reason = error instanceof Error ? error.message : String(error);
    return result;
  }
}

export function hasDeclaredSupplyChainEvidence(security = {}) {
  return Boolean(security?.provenance || security?.signature || security?.sbom);
}

export async function verifySecurityEvidence(security = {}, options = {}) {
  const evidence = await Promise.all([
    verifyEvidenceReference('provenance', security.provenance, options),
    verifyEvidenceReference('signature', security.signature, options),
    verifyEvidenceReference('sbom', security.sbom, options),
  ]);
  const declared = evidence.filter((item) => item.declared).length;
  const verified = evidence.filter((item) => item.verified).length;
  const failed = evidence.filter((item) => ['digest-mismatch', 'verification-error'].includes(item.status));
  return {
    online: options.online === true,
    evidence,
    summary: { declared, verified, failed: failed.length },
    valid: failed.length === 0,
    cryptographic_signature_verified: false,
  };
}

export async function verifyPackageEvidence(root = process.cwd(), options = {}) {
  const found = await findPackageManifest(root);
  if (!found) throw new Error('no DSH package manifest found');
  const result = await verifySecurityEvidence(found.manifest?.security || {}, { ...options, root: dirname(found.path) });
  return { manifest: found.file, ...result };
}
