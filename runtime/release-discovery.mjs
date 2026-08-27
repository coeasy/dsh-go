import { assertPackageType } from './package-model.mjs';
import { validateReleaseArtifact } from './artifact-installer.mjs';

export const RELEASE_DESCRIPTOR_NAME = 'dsh-package-release.json';

function descriptorUrl(pkg, options = {}) {
  const tag = options.tag || `v${pkg.version}`;
  return `https://github.com/${pkg.repo}/releases/download/${encodeURIComponent(tag)}/${RELEASE_DESCRIPTOR_NAME}`;
}

function sameIdentity(descriptor, pkg) {
  return String(descriptor?.repository || '').toLowerCase() === String(pkg.repo || '').toLowerCase()
    && String(descriptor?.commit || '').toLowerCase() === String(pkg.commit || '').toLowerCase()
    && descriptor?.id === pkg.id
    && descriptor?.version === pkg.version
    && descriptor?.type === assertPackageType(pkg.type || 'plugin');
}

export async function discoverReleaseArtifact(pkg, options = {}) {
  if (!pkg?.repo || !pkg?.version || !pkg?.commit || !pkg?.id) return null;
  const url = descriptorUrl(pkg, options);
  let response;
  try {
    response = await fetch(url, {
      headers: { Accept: 'application/json', 'User-Agent': 'dsh-runtime-release-discovery' },
      redirect: 'follow',
      signal: AbortSignal.timeout(Number(options.timeout || 8000)),
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
    release_tag: descriptor.tag || `v${pkg.version}`,
  };
}
