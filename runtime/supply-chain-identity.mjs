import { execFile } from 'node:child_process';
import { mkdtemp, open, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildExecutionEnv } from './execution-env.mjs';

const exec = promisify(execFile);
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const DEFAULT_COSIGN_TIMEOUT_MS = 60_000;
const IN_TOTO_STATEMENT_V1 = 'https://in-toto.io/Statement/v1';
const SLSA_PROVENANCE_V1 = 'https://slsa.dev/provenance/v1';

function asObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

function clean(value) {
  const text = String(value || '').trim();
  return text || null;
}

function isRequired(value) {
  return value?.required === true;
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
  if (!insidePath(lexicalBase, lexicalPath)) throw new Error('local identity evidence path escapes package root');

  const [base, path] = await Promise.all([realpath(lexicalBase), realpath(lexicalPath)]);
  if (!insidePath(base, path)) throw new Error('local identity evidence path escapes package root through a symlink');
  return path;
}

async function boundedRead(path) {
  const handle = await open(path, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw new Error('identity evidence must be a regular file');
    if (info.size > MAX_EVIDENCE_BYTES) throw new Error(`identity evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    const buffer = await handle.readFile();
    if (buffer.byteLength > MAX_EVIDENCE_BYTES) throw new Error(`identity evidence exceeds ${MAX_EVIDENCE_BYTES} bytes`);
    return buffer;
  } finally {
    await handle.close();
  }
}

function evidenceEntry(report, kind) {
  return report?.evidence?.find((item) => item.kind === kind) || null;
}

function evidenceUri(value, kind) {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || Array.isArray(value)) return null;
  if (kind === 'signature') return value.bundle || value.uri || value.path || null;
  return value.uri || value.path || null;
}

async function verifiedLocalEvidence(root, security, report, kind) {
  const entry = evidenceEntry(report, kind);
  if (!entry?.verified || entry.status !== 'verified-digest') return null;
  const uri = evidenceUri(security?.[kind], kind);
  if (!uri) return null;
  const path = await localEvidencePath(root, uri);
  if (!path) return null;
  return { path, buffer: await boundedRead(path) };
}

function baseResult(kind, declared, required) {
  return {
    kind,
    declared,
    required,
    verified: false,
    valid: true,
    status: declared ? 'declared' : 'missing',
    reason: declared ? null : 'identity policy is not declared',
  };
}

function normalizeRepository(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^git\+/, '')
    .replace(/^https?:\/\/github\.com\//, '')
    .replace(/^git@github\.com:/, '')
    .replace(/\.git$/, '')
    .replace(/^\/+|\/+$/g, '');
}

async function runCosign(args, options = {}) {
  const env = buildExecutionEnv(options.cosignEnv || {}, options.hostEnv || process.env);
  const context = { cwd: options.root || process.cwd(), env };
  if (typeof options.cosignRunner === 'function') return options.cosignRunner(args, context);
  const configuredTimeout = Number(options.cosignTimeoutMs ?? options.timeoutMs);
  const timeout = Number.isFinite(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : DEFAULT_COSIGN_TIMEOUT_MS;
  return exec(options.cosignPath || process.env.DSH_COSIGN || 'cosign', args, {
    ...context,
    windowsHide: true,
    maxBuffer: 2 * 1024 * 1024,
    timeout,
    killSignal: 'SIGTERM',
  });
}

export async function verifySigstoreIdentity(security = {}, evidenceReport = {}, options = {}) {
  const signature = asObject(security.signature);
  const required = isRequired(signature);
  const result = baseResult('sigstore', Boolean(signature), required);
  if (!signature) return result;

  const provider = String(signature.provider || '').trim().toLowerCase();
  const identity = clean(signature.identity);
  const issuer = clean(signature.issuer || signature.oidc_issuer);
  const signed = clean(signature.signed || signature.payload) || 'provenance';
  result.provider = provider || null;
  result.identity = identity;
  result.issuer = issuer;
  result.signed = signed;

  if (provider && !['sigstore', 'cosign'].includes(provider)) {
    result.status = 'unsupported-provider';
    result.reason = `signature provider does not support Sigstore identity verification: ${provider}`;
    result.valid = !required;
    return result;
  }
  if (!identity || !issuer) {
    result.status = 'identity-policy-incomplete';
    result.reason = 'Sigstore identity verification requires both identity and issuer';
    result.valid = !required;
    return result;
  }
  if (!['provenance', 'sbom'].includes(signed)) {
    result.status = 'unsupported-payload';
    result.reason = 'Sigstore signed payload must be provenance or sbom';
    result.valid = false;
    return result;
  }

  let bundle;
  let payload;
  try {
    bundle = await verifiedLocalEvidence(options.root || process.cwd(), security, evidenceReport, 'signature');
    payload = await verifiedLocalEvidence(options.root || process.cwd(), security, evidenceReport, signed);
  } catch (error) {
    result.status = 'verification-error';
    result.reason = error instanceof Error ? error.message : String(error);
    result.valid = false;
    return result;
  }
  if (!bundle || !payload) {
    result.status = 'identity-pending';
    result.reason = `Sigstore identity verification requires local digest-verified signature bundle and ${signed} payload`;
    result.valid = !required;
    return result;
  }

  const temp = await mkdtemp(join(tmpdir(), 'dsh-sigstore-'));
  const payloadPath = join(temp, `signed-${signed}.bin`);
  const bundlePath = join(temp, 'bundle.sigstore.json');
  try {
    await Promise.all([
      writeFile(payloadPath, payload.buffer, { mode: 0o600 }),
      writeFile(bundlePath, bundle.buffer, { mode: 0o600 }),
    ]);
    await runCosign([
      'verify-blob', payloadPath,
      '--bundle', bundlePath,
      '--certificate-identity', identity,
      '--certificate-oidc-issuer', issuer,
    ], options);
    result.status = 'verified';
    result.verified = true;
    result.valid = true;
    result.reason = 'Sigstore artifact signature, certificate identity, issuer, and bundle transparency evidence verified by cosign';
    return result;
  } catch (error) {
    result.status = error?.code === 'ENOENT' ? 'verifier-unavailable' : 'verification-failed';
    result.reason = error?.code === 'ENOENT'
      ? 'cosign is not installed or DSH_COSIGN does not point to an executable verifier'
      : `Sigstore identity verification failed: ${error instanceof Error ? error.message : String(error)}`;
    result.valid = error?.code === 'ENOENT' ? !required : false;
    return result;
  } finally {
    await rm(temp, { recursive: true, force: true }).catch(() => {});
  }
}

export async function verifySlsaProvenance(security = {}, evidenceReport = {}, options = {}) {
  const provenance = asObject(security.provenance);
  const provider = String(provenance?.provider || '').trim().toLowerCase();
  const declared = Boolean(provenance && (
    provider === 'slsa'
    || provenance.predicate_type
    || provenance.builder_id
    || provenance.build_type
    || provenance.source_repository
    || provenance.required === true
  ));
  const required = isRequired(provenance);
  const result = baseResult('slsa', declared, required);
  if (!declared) return result;

  let evidence;
  try {
    evidence = await verifiedLocalEvidence(options.root || process.cwd(), security, evidenceReport, 'provenance');
  } catch (error) {
    result.status = 'verification-error';
    result.reason = error instanceof Error ? error.message : String(error);
    result.valid = false;
    return result;
  }
  if (!evidence) {
    result.status = 'provenance-pending';
    result.reason = 'SLSA policy evaluation requires local digest-verified provenance';
    result.valid = !required;
    return result;
  }

  let statement;
  try {
    statement = JSON.parse(evidence.buffer.toString('utf8'));
  } catch {
    result.status = 'invalid-statement';
    result.reason = 'SLSA provenance is not valid JSON';
    result.valid = false;
    return result;
  }

  const failures = [];
  if (statement?._type !== IN_TOTO_STATEMENT_V1) failures.push(`_type must be ${IN_TOTO_STATEMENT_V1}`);
  if (statement?.predicateType !== SLSA_PROVENANCE_V1) failures.push(`predicateType must be ${SLSA_PROVENANCE_V1}`);

  const builderId = clean(statement?.predicate?.runDetails?.builder?.id);
  const buildType = clean(statement?.predicate?.buildDefinition?.buildType);
  const expectedBuilder = clean(provenance.builder_id);
  const expectedBuildType = clean(provenance.build_type);
  if (expectedBuilder && builderId !== expectedBuilder) failures.push(`builder.id does not match expected builder ${expectedBuilder}`);
  if (expectedBuildType && buildType !== expectedBuildType) failures.push(`buildType does not match expected build type ${expectedBuildType}`);

  const expectedRepo = normalizeRepository(provenance.source_repository);
  if (expectedRepo) {
    const dependencies = Array.isArray(statement?.predicate?.buildDefinition?.resolvedDependencies)
      ? statement.predicate.buildDefinition.resolvedDependencies
      : [];
    const candidates = dependencies.map((item) => normalizeRepository(item?.uri)).filter(Boolean);
    const external = statement?.predicate?.buildDefinition?.externalParameters;
    for (const candidate of [external?.repository, external?.source?.repository, external?.source?.uri]) {
      const normalized = normalizeRepository(candidate);
      if (normalized) candidates.push(normalized);
    }
    if (!candidates.some((candidate) => candidate === expectedRepo || candidate.endsWith(`/${expectedRepo}`))) {
      failures.push(`SLSA provenance does not resolve to expected source repository ${expectedRepo}`);
    }
  }

  result.statement_type = statement?._type || null;
  result.predicate_type = statement?.predicateType || null;
  result.builder_id = builderId;
  result.build_type = buildType;
  result.status = failures.length ? 'policy-mismatch' : 'verified';
  result.verified = failures.length === 0;
  result.valid = failures.length === 0;
  result.reason = failures.length ? failures.join('; ') : 'SLSA provenance v1 statement and declared builder/source policy verified';
  return result;
}

export async function verifySupplyChainIdentity(security = {}, evidenceReport = {}, options = {}) {
  const [sigstore, slsa] = await Promise.all([
    verifySigstoreIdentity(security, evidenceReport, options),
    verifySlsaProvenance(security, evidenceReport, options),
  ]);
  return {
    valid: sigstore.valid !== false && slsa.valid !== false,
    sigstore,
    slsa,
    cryptographic_signature_verified: sigstore.verified === true,
    slsa_provenance_verified: slsa.verified === true,
  };
}
