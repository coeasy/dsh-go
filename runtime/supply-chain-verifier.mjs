import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findPackageManifest } from './package-manifest.mjs';

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const SHA256_RE = /^(?:sha256:)?([a-f0-9]{64})$/i;

function normalizeDigest(value) {
  const match = String(value || '').trim().match(SHA256_RE);
  return match ? match[1].toLowerCase() : null;
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function privateIpv4(host) {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10
    || parts[0] === 127
    || (parts[0] === 169 && parts[1] === 254)
    || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31)
    || (parts[0] === 192 && parts[1] === 168)
    || parts[0] === 0;
}

function privateIpv6(host) {
  const normalized = host.toLowerCase();
  return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe80:');
}

export function assertSafeEvidenceUrl(value) {
  const url = value instanceof URL ? value : new URL(String(value));
  if (url.protocol !== 'https:') throw new Error('remote evidence URL must use HTTPS');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host || host === 'localhost' || host.endsWith('.localhost')) throw new Error('remote evidence URL cannot target localhost');
  const ipVersion = isIP(host);
  if ((ipVersion === 4 && privateIpv4(host)) || (ipVersion === 6 && privateIpv6(host))) throw new Error('remote evidence URL cannot target a private or loopback IP');
  if (url.username || url.password) throw new Error('remote evidence URL cannot contain credentials');
  return url;
}

function localEvidencePath(root, value) {
  const base = resolve(root);
  const raw = String(value || '');
  let path;
  if (raw.startsWith('file:')) path = resolve(fileURLToPath(new URL(raw)));
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(raw)) path = resolve(base, raw);
  else return null;
  if (path !== base && !path.startsWith(`${base}${sep}`)) throw new Error('local evidence path escapes package root');
  return path;
}

async function boundedRead(path) {
  const buffer = await readFile(path);
  if (buffer.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
  return buffer;
}

async function fetchEvidence(url, options = {}) {
  let current = assertSafeEvidenceUrl(url);
  for (let redirect = 0; redirect <= 3; redirect += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Number(options.timeoutMs) || 10_000);
    let response;
    try {
      response = await (options.fetch || fetch)(current, { redirect: 'manual', signal: controller.signal, headers: { accept: 'application/octet-stream, application/json, text/plain;q=0.9' } });
    } finally { clearTimeout(timer); }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) throw new Error(`evidence redirect ${response.status} has no location`);
      current = assertSafeEvidenceUrl(new URL(location, current));
      continue;
    }
    if (!response.ok) throw new Error(`evidence fetch failed: HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length'));
    if (Number.isFinite(length) && length > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    return { buffer, final_url: current.toString() };
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
    const local = localEvidencePath(root, reference.uri);
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

export async function verifyPackageEvidence(root = process.cwd(), options = {}) {
  const found = await findPackageManifest(root);
  if (!found) throw new Error('no DSH package manifest found');
  const security = found.manifest?.security || {};
  const evidence = await Promise.all([
    verifyEvidenceReference('provenance', security.provenance, { ...options, root: dirname(found.path) }),
    verifyEvidenceReference('signature', security.signature, { ...options, root: dirname(found.path) }),
    verifyEvidenceReference('sbom', security.sbom, { ...options, root: dirname(found.path) }),
  ]);
  const declared = evidence.filter((item) => item.declared).length;
  const verified = evidence.filter((item) => item.verified).length;
  const failed = evidence.filter((item) => ['digest-mismatch', 'verification-error'].includes(item.status));
  return {
    manifest: found.file,
    online: options.online === true,
    evidence,
    summary: { declared, verified, failed: failed.length },
    valid: failed.length === 0,
    cryptographic_signature_verified: false,
  };
}
