import { normalizePackageType } from '../packages/protocol-core/index.mjs';
import {
  PACKAGE_MANIFEST_VERSION,
  PACKAGE_RELEASE_DESCRIPTOR_VERSION,
  packageReleaseTag,
  validatePackageManifest,
} from '../packages/protocol-core/manifest.mjs';
import { validateReleaseArtifact } from './artifact-installer.mjs';

export const RELEASE_DESCRIPTOR_NAME = 'dsh-package-release.json';
const DEFAULT_RELEASE_DISCOVERY_TIMEOUT_MS = 8_000;

function positiveTimeout(value, fallback = DEFAULT_RELEASE_DISCOVERY_TIMEOUT_MS) {
  const timeout = Number(value);
  return Number.isFinite(timeout) && timeout > 0 ? timeout : fallback;
}

function defaultReleaseTag(pkg) {
  const declared = pkg?.artifact?.release_tag || pkg?.release_tag;
  if (declared) return String(declared);
  return packageReleaseTag({
    id: pkg?.id,
    version: pkg?.version,
    package_path: pkg?.artifact?.package_path || pkg?.package_path || null,
  });
}

function descriptorUrl(pkg, options = {}) {
  const tag = options.tag || defaultReleaseTag(pkg);
  return { tag, url: `https://github.com/${pkg.repo}/releases/download/${encodeURIComponent(tag)}/${RELEASE_DESCRIPTOR_NAME}` };
}

function descriptorManifestMatches(descriptor, pkg) {
  if (!descriptor?.manifest) return false;
  try {
    const manifest = validatePackageManifest(descriptor.manifest, { type: pkg.type, id: pkg.id, version: pkg.version });
    return manifest.manifest_version === PACKAGE_MANIFEST_VERSION;
  } catch {
    return false;
  }
}

function sameIdentity(descriptor, pkg, expectedTag) {
  return String(descriptor?.repository || '').toLowerCase() === String(pkg.repo || '').toLowerCase()
    && String(descriptor?.commit || '').toLowerCase() === String(pkg.commit || '').toLowerCase()
    && descriptor?.id === pkg.id
    && descriptor?.version === pkg.version
    && descriptor?.type === normalizePackageType(pkg.type)
    && descriptor?.tag === expectedTag
    && descriptorManifestMatches(descriptor, pkg);
}

export async function discoverReleaseArtifact(pkg, options = {}) {
  if (!pkg?.repo || !pkg?.version || !pkg?.commit || !pkg?.id || !pkg?.type) return null;
  const { tag, url } = descriptorUrl(pkg, options);
  let response;
  try {
    response = await (options.fetch || fetch)(url, {
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
  if (descriptor?.release_version !== PACKAGE_RELEASE_DESCRIPTOR_VERSION
    || descriptor?.protocol_version !== 2
    || descriptor?.manifest_version !== PACKAGE_MANIFEST_VERSION) {
    const error = new Error(`release descriptor must use release_version=${PACKAGE_RELEASE_DESCRIPTOR_VERSION}, protocol_version=2 and manifest_version=${PACKAGE_MANIFEST_VERSION}`);
    error.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw error;
  }
  if (!sameIdentity(descriptor, pkg, tag)) return null;
  const validation = validateReleaseArtifact(descriptor.artifact);
  if (!validation.ok) {
    const error = new Error(`release descriptor artifact is invalid: ${validation.errors.join('; ')}`);
    error.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw error;
  }
  return {
    ...descriptor.artifact,
    discovered_from: url,
    release_tag: tag,
    package_path: descriptor.package_path || null,
  };
}
