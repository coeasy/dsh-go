export const PACKAGE_TYPES = Object.freeze(['plugin', 'mcp', 'skill', 'agent']);
export const RELEASE_CHANNELS = Object.freeze(['stable', 'beta', 'nightly', 'dev']);

export const ERROR_CODES = Object.freeze({
  INVALID_PACKAGE_ID: 'DSH_INVALID_PACKAGE_ID',
  INVALID_PACKAGE_TYPE: 'DSH_INVALID_PACKAGE_TYPE',
  INVALID_VERSION: 'DSH_INVALID_VERSION',
  INVALID_VERSION_RANGE: 'DSH_INVALID_VERSION_RANGE',
  UNSUPPORTED_CHANNEL: 'DSH_UNSUPPORTED_CHANNEL',
  PACKAGE_NOT_FOUND: 'DSH_PACKAGE_NOT_FOUND',
  PACKAGE_AMBIGUOUS: 'DSH_PACKAGE_AMBIGUOUS',
  DEPENDENCY_CONFLICT: 'DSH_DEPENDENCY_CONFLICT',
  PACKAGE_REVOKED: 'DSH_PACKAGE_REVOKED',
  PACKAGE_YANKED: 'DSH_PACKAGE_YANKED',
  SECURITY_ADVISORY_BLOCKED: 'DSH_SECURITY_ADVISORY_BLOCKED',
  INCOMPATIBLE_RUNTIME: 'DSH_INCOMPATIBLE_RUNTIME',
  PERMISSION_DENIED: 'DSH_PERMISSION_DENIED',
  ARTIFACT_DIGEST_MISMATCH: 'DSH_ARTIFACT_DIGEST_MISMATCH',
  SIGNATURE_REQUIRED: 'DSH_SIGNATURE_REQUIRED',
  SIGNATURE_INVALID: 'DSH_SIGNATURE_INVALID',
  TRANSACTION_CONFLICT: 'DSH_TRANSACTION_CONFLICT',
  STATE_SCHEMA_UNSUPPORTED: 'DSH_STATE_SCHEMA_UNSUPPORTED',
  RESTART_REQUIRED: 'DSH_RESTART_REQUIRED',
});

const PACKAGE_TYPE_SET = new Set(PACKAGE_TYPES);
const CHANNEL_SET = new Set(RELEASE_CHANNELS);
const PACKAGE_ID_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/;
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;

export class ProtocolError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProtocolError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

export function normalizePackageType(value) {
  const type = String(value ?? '').trim().toLowerCase();
  if (!PACKAGE_TYPE_SET.has(type)) {
    throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_TYPE, `invalid package type: ${type || '<empty>'}`, {
      supported: [...PACKAGE_TYPES],
    });
  }
  return type;
}

export function normalizePackageId(value) {
  const id = String(value ?? '').trim();
  const parts = id.split('/');
  if (!id || id.length > 200 || !PACKAGE_ID_RE.test(id) || parts.some((part) => part === '.' || part === '..')) {
    throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_ID, `invalid package id: ${id || '<empty>'}`);
  }
  return id.toLowerCase();
}

export function normalizeReleaseChannel(value = 'stable') {
  const channel = String(value ?? 'stable').trim().toLowerCase();
  if (!CHANNEL_SET.has(channel)) {
    throw new ProtocolError(ERROR_CODES.UNSUPPORTED_CHANNEL, `unsupported release channel: ${channel || '<empty>'}`, {
      supported: [...RELEASE_CHANNELS],
    });
  }
  return channel;
}

function comparePrereleaseIdentifier(left, right) {
  const leftNumeric = /^\d+$/.test(left);
  const rightNumeric = /^\d+$/.test(right);
  if (leftNumeric && rightNumeric) {
    const a = Number(left);
    const b = Number(right);
    return a === b ? 0 : a > b ? 1 : -1;
  }
  if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
  return left === right ? 0 : left > right ? 1 : -1;
}

export function parseVersion(value) {
  const raw = String(value ?? '').trim().replace(/^v/, '');
  const match = raw.match(SEMVER_RE);
  if (!match) {
    throw new ProtocolError(ERROR_CODES.INVALID_VERSION, `invalid semantic version: ${value || '<empty>'}`);
  }
  return Object.freeze({
    raw,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
    build: match[5] ? match[5].split('.') : [],
  });
}

export function compareVersion(leftValue, rightValue) {
  const left = parseVersion(leftValue);
  const right = parseVersion(rightValue);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (!left.prerelease.length && !right.prerelease.length) return 0;
  if (!left.prerelease.length) return 1;
  if (!right.prerelease.length) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    const compared = comparePrereleaseIdentifier(a, b);
    if (compared !== 0) return compared;
  }
  return 0;
}

function normalizePartialVersion(raw) {
  const value = String(raw).trim().replace(/^v/, '');
  const parts = value.split('.');
  if (parts.length > 3 || parts.length === 0) return null;
  const normalized = [];
  let wildcard = false;
  for (const part of parts) {
    if (['*', 'x', 'X'].includes(part)) {
      wildcard = true;
      normalized.push(null);
      continue;
    }
    if (wildcard || !/^(0|[1-9]\d*)$/.test(part)) return null;
    normalized.push(Number(part));
  }
  while (normalized.length < 3) normalized.push(null);
  return normalized;
}

function wildcardBounds(token) {
  const parts = normalizePartialVersion(token);
  if (!parts) return null;
  const firstWildcard = parts.findIndex((part) => part === null);
  if (firstWildcard < 0) return null;
  const lowerParts = parts.map((part) => part ?? 0);
  const lower = `${lowerParts[0]}.${lowerParts[1]}.${lowerParts[2]}`;
  if (firstWildcard === 0) return { lower: '0.0.0', upper: null };
  if (firstWildcard === 1) return { lower, upper: `${lowerParts[0] + 1}.0.0` };
  return { lower, upper: `${lowerParts[0]}.${lowerParts[1] + 1}.0` };
}

function compareWithOperator(version, operator, target) {
  const compared = compareVersion(version, target);
  if (operator === '>') return compared > 0;
  if (operator === '>=') return compared >= 0;
  if (operator === '<') return compared < 0;
  if (operator === '<=') return compared <= 0;
  return compared === 0;
}

function caretUpperBound(base) {
  const parsed = parseVersion(base);
  if (parsed.major > 0) return `${parsed.major + 1}.0.0`;
  if (parsed.minor > 0) return `0.${parsed.minor + 1}.0`;
  return `0.0.${parsed.patch + 1}`;
}

function tildeUpperBound(base) {
  const parsed = parseVersion(base);
  return `${parsed.major}.${parsed.minor + 1}.0`;
}

function tokenSatisfies(version, token) {
  const raw = token.trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'latest') return true;

  if (raw.startsWith('^')) {
    const base = raw.slice(1);
    parseVersion(base);
    return compareVersion(version, base) >= 0 && compareVersion(version, caretUpperBound(base)) < 0;
  }
  if (raw.startsWith('~')) {
    const base = raw.slice(1);
    parseVersion(base);
    return compareVersion(version, base) >= 0 && compareVersion(version, tildeUpperBound(base)) < 0;
  }

  const operatorMatch = raw.match(/^(>=|<=|>|<|=)(.+)$/);
  if (operatorMatch) {
    const target = operatorMatch[2].trim();
    parseVersion(target);
    return compareWithOperator(version, operatorMatch[1], target);
  }

  const wildcard = wildcardBounds(raw);
  if (wildcard) {
    return compareVersion(version, wildcard.lower) >= 0
      && (wildcard.upper === null || compareVersion(version, wildcard.upper) < 0);
  }

  parseVersion(raw);
  return compareVersion(version, raw) === 0;
}

function validateRangeGroup(group) {
  const tokens = group.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) throw new ProtocolError(ERROR_CODES.INVALID_VERSION_RANGE, 'empty version range group');
  for (const token of tokens) tokenSatisfies('0.0.0', token);
}

export function normalizeVersionRange(value = '*') {
  const range = String(value ?? '*').trim() || '*';
  try {
    for (const group of range.split('||')) validateRangeGroup(group);
  } catch (error) {
    if (error instanceof ProtocolError && error.code === ERROR_CODES.INVALID_VERSION_RANGE) throw error;
    throw new ProtocolError(ERROR_CODES.INVALID_VERSION_RANGE, `invalid version range: ${range}`, {
      cause: error instanceof Error ? error.message : String(error),
    });
  }
  return range;
}

export function satisfiesRange(version, range = '*') {
  parseVersion(version);
  const normalized = normalizeVersionRange(range);
  return normalized.split('||').some((group) => group.trim().split(/\s+/).filter(Boolean).every((token) => tokenSatisfies(version, token)));
}

export function selectHighest(versions, range = '*') {
  const normalizedRange = normalizeVersionRange(range);
  const matches = [...versions].filter((version) => satisfiesRange(version, normalizedRange));
  matches.sort(compareVersion);
  return matches.at(-1) ?? null;
}

export function packageKey(type, id) {
  return `${normalizePackageType(type)}:${normalizePackageId(id)}`;
}

export function normalizePackageRequest(input) {
  if (!input || typeof input !== 'object') {
    throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_ID, 'package request must be an object');
  }
  const request = {
    type: normalizePackageType(input.type),
    id: normalizePackageId(input.id),
    range: normalizeVersionRange(input.range ?? '*'),
    channel: normalizeReleaseChannel(input.channel ?? 'stable'),
  };
  if (input.registry !== undefined && input.registry !== null) {
    const registry = String(input.registry).trim();
    if (!registry || registry.length > 2048) {
      throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_ID, 'invalid registry selector');
    }
    request.registry = registry;
  }
  return Object.freeze(request);
}

export function parsePackageCoordinate(value, options = {}) {
  const raw = String(value ?? '').trim();
  if (!raw || raw.length > 512) {
    throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_ID, 'package coordinate is required');
  }
  const colon = raw.indexOf(':');
  if (colon <= 0) {
    throw new ProtocolError(ERROR_CODES.INVALID_PACKAGE_TYPE, 'canonical package coordinate must include an explicit type prefix');
  }
  const type = normalizePackageType(raw.slice(0, colon));
  const body = raw.slice(colon + 1);
  const at = body.lastIndexOf('@');
  const id = at > 0 ? body.slice(0, at) : body;
  const range = at > 0 ? body.slice(at + 1) : '*';
  return normalizePackageRequest({
    type,
    id,
    range,
    channel: options.channel ?? 'stable',
    registry: options.registry,
  });
}

export function formatPackageCoordinate(request) {
  const normalized = normalizePackageRequest(request);
  return `${normalized.type}:${normalized.id}@${normalized.range}`;
}
