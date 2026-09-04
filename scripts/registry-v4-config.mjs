import { readFile } from 'node:fs/promises';
import { normalizePackageId, normalizePackageType } from '../packages/protocol-core/index.mjs';

const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

export function normalizeRegistryPackagePath(value) {
  const raw = String(value || '').trim().replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '');
  if (!raw || raw === '.') return null;
  if (raw.startsWith('/') || raw.split('/').some((part) => !part || part === '.' || part === '..')) {
    throw new Error('Registry V4 package_path must be a safe repository-relative directory');
  }
  return raw;
}

function normalizeRepository(value) {
  const repository = String(value || '').trim();
  if (!REPO_RE.test(repository)) throw new Error(`invalid Registry V4 repository: ${repository || '<empty>'}`);
  return repository;
}

export function validateRegistryV4SourceConfig(input) {
  if (!input || input.schema_version !== 1 || !Array.isArray(input.sources) || !Array.isArray(input.required_packages)) {
    throw new Error('Registry V4 source config must use schema_version=1 with sources[] and required_packages[]');
  }
  const sources = input.sources.map((source) => ({
    repository: normalizeRepository(source?.repository),
    package_path: normalizeRegistryPackagePath(source?.package_path),
    ref: String(source?.ref || 'HEAD').trim() || 'HEAD',
    enabled: source?.enabled !== false,
  }));
  const required_packages = input.required_packages.map((required) => ({
    repository: normalizeRepository(required?.repository),
    package_path: normalizeRegistryPackagePath(required?.package_path),
    type: normalizePackageType(required?.type),
    id: normalizePackageId(required?.id),
  }));
  const sourceKeys = new Set();
  for (const source of sources) {
    const key = `${source.repository.toLowerCase()}|${source.package_path || ''}`;
    if (sourceKeys.has(key)) throw new Error(`duplicate Registry V4 explicit source: ${key}`);
    sourceKeys.add(key);
  }
  const requiredKeys = new Set();
  for (const required of required_packages) {
    const key = `${required.type}:${required.id}`;
    if (requiredKeys.has(key)) throw new Error(`duplicate Registry V4 required package: ${key}`);
    requiredKeys.add(key);
  }
  return Object.freeze({ schema_version: 1, sources: Object.freeze(sources), required_packages: Object.freeze(required_packages) });
}

export async function loadRegistryV4SourceConfig(file) {
  return validateRegistryV4SourceConfig(JSON.parse(await readFile(file, 'utf8')));
}

export function requiredRegistryPackageFailures(built, requiredPackages) {
  const candidates = Array.isArray(built?.candidates?.candidates) ? built.candidates.candidates : [];
  return (requiredPackages || []).map((required) => {
    const repository = String(required.repository || '').toLowerCase();
    const packagePath = normalizeRegistryPackagePath(required.package_path) || '';
    const type = normalizePackageType(required.type);
    const id = normalizePackageId(required.id);
    const matchesIdentity = (candidate) => String(candidate.repo || '').toLowerCase() === repository
      && String(candidate.package_path || '') === packagePath
      && String(candidate.type || '').toLowerCase() === type
      && String(candidate.id || '').toLowerCase() === id;
    const accepted = candidates.find((candidate) => candidate.status === 'accepted' && matchesIdentity(candidate));
    if (accepted) return null;
    const observed = candidates.find(matchesIdentity);
    return {
      repository,
      package_path: packagePath || null,
      type,
      id,
      status: observed?.status || 'missing',
      reason: observed?.reason || 'required-package-not-observed',
    };
  }).filter(Boolean);
}
