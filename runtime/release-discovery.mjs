import { packageReleaseTag, validatePackageReleaseDescriptor } from '../packages/protocol-core/manifest.mjs';

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
  let raw;
  try { raw = await response.json(); }
  catch (error) {
    const invalid = new Error(`release descriptor is not valid JSON: ${error.message}`);
    invalid.code = 'DSH_RELEASE_DESCRIPTOR_INVALID';
    throw invalid;
  }
  const descriptor = validatePackageReleaseDescriptor(raw, {
    type: pkg.type,
    id: pkg.id,
    version: pkg.version,
    channel: pkg.channel || 'stable',
    repository: pkg.repo,
    commit: pkg.commit,
    tag,
    package_path: pkg?.artifact?.package_path || pkg?.package_path || null,
  });
  return {
    ...descriptor.artifact,
    discovered_from: url,
    release_tag: descriptor.tag,
    package_path: descriptor.package_path,
  };
}
