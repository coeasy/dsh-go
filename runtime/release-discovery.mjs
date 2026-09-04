import { normalizePackageType } from '../packages/protocol-core/index.mjs';
import { validateReleaseArtifact } from './artifact-installer.mjs';

export const RELEASE_DESCRIPTOR_NAME = 'dsh-package-release.json';
const DEFAULT_RELEASE_DISCOVERY_TIMEOUT_MS = 8_000;

function positiveTimeout(value, fallback = DEFAULT_RELEASE_DISCOVERY_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function defaultReleaseTag(pkg) {
  return pkg?.release_tag || pkg?.artifact?.release_tag || (pkg?.package_path ? `${pkg.id}-v${pkg.version}` : `v${pkg.version}`);
}

function descriptorUrl(pkg, options = {}) {
  const tag = options.tag || defaultReleaseTag(pkg);
  return `https://github.com/${pkg.repo}/releases/download/${encodeURIComponent(tag)}/${RELEASE_DESCRIPTOR_NAME}`;
}

function sameIdentity(descriptor, pkg) {
  return String(descriptor?.repository || '').toLowerCase() === String(pkg.repo || '').toLowerCase()
    && String(descriptor?.commit || '').toLowerCase() === String(pkg.commit || '').toLowerCase()
    && descriptor?.id === pkg.id
    && descriptor?.version === pkg.version
    && descriptor?.type === normalizePackageType(pkg.type);
}

export async function discoverReleaseArtifact(pkg, options = {}) {
  if (!pkg?.repo || !pkg?.version || !pkg?.commit || !pkg?.id || !pkg?.type) return null;
  const url = descriptorUrl(pkg, options);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-runtime-release-discovery' },
      redirect: 'follow',
      signal: AbortSignal.timeout(positiveTimeout(options.timeout)),
    });
  } catch (error) {
    if (options.strict === true) throw error;
    return null;
  }
  if (response.status === 404) return null;
  if (!response.ok) {
    if (options.strict === true) throw new Error(`release descriptor fetch failed: HTTP ${response.status}`);
    return null;
  }
  let descriptor;
  try { descriptor = await response.json(); }
  catch (error) {
    const invalid = new Error(`release descriptor is not valid JSON: ${error.message}`);
    invalid.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw invalid;
  }
  if (descriptor?.release_version !== 1) {
    const error = new Error('release descriptor version must be 1');
    error.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw error;
  }
  if (!sameIdentity(descriptor, pkg)) return null;
  const validation = validateReleaseArtifact(descriptor.artifact);
  if (!validation.ok) {
    const error = new Error(`release descriptor artifact is invalid: ${validation.errors.join('; ')}`);
    error.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw error;
  }
  return {
    ...descriptor.artifact,
    discovered_from: url,
    release_tag: descriptor.tag || defaultReleaseTag(pkg),
  };
}
