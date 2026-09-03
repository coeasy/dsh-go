import { normalizePackageManifest, validatePackageManifest } from './package-manifest.mjs';
import { assertPackageType } from './package-model.mjs';

export const DSH_PACKAGE_MANIFEST_V2 = '2.0.0';
export const SUPPORTED_MANIFEST_VERSIONS = Object.freeze(['1.0.0', DSH_PACKAGE_MANIFEST_V2]);

function githubOwner(repo = '') {
  return String(repo).split('/')[0] || '';
}

export function normalizeManifestV2(input, options = {}) {
  const sourceFile = options.file || 'dsh-package.json';
  const normalized = normalizePackageManifest(input, sourceFile);
  if (!normalized) return null;
  const type = assertPackageType(normalized.type || input?.type || 'plugin');
  const source = {
    provider: input?.source?.provider || 'github',
    repo: input?.source?.repo || input?.repository || input?.repo || '',
    commit: input?.source?.commit || null,
    release_tag: input?.source?.release_tag || input?.release_tag || null,
  };
  const publisher = {
    provider: normalized.publisher?.provider || 'github',
    id: normalized.publisher?.id || githubOwner(source.repo),
    repository_ownership: normalized.publisher?.repository_ownership || 'unverified',
    verified_at: normalized.publisher?.verified_at || null,
    profile_url: normalized.publisher?.profile_url || null,
  };
  return {
    ...normalized,
    manifest_version: DSH_PACKAGE_MANIFEST_V2,
    id: normalized.id || input?.id || normalized.name?.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-') || '',
    type,
    source,
    publisher,
    localization: {
      default_locale: input?.localization?.default_locale || 'en',
      overlay_key: input?.localization?.overlay_key || `${type}:${normalized.id || input?.id || ''}`,
      locales: Array.isArray(input?.localization?.locales) ? [...new Set(input.localization.locales)] : [],
    },
    release: {
      channel: input?.release?.channel || input?.channel || 'stable',
      artifact_digest: input?.release?.artifact_digest || input?.artifact?.digest || null,
      provenance_required: input?.release?.provenance_required ?? Boolean(normalized.security?.provenance),
      signature_required: input?.release?.signature_required ?? Boolean(normalized.security?.signature),
      sbom_required: input?.release?.sbom_required ?? Boolean(normalized.security?.sbom),
    },
  };
}

export function validateManifestV2(input, options = {}) {
  const errors = [];
  const warnings = [];
  const manifest = normalizeManifestV2(input, options);
  if (!manifest) return { valid: false, errors: ['manifest must be a JSON object'], warnings, manifest: null };
  const sourceVersion = String(input?.manifest_version || '1.0.0');
  if (!SUPPORTED_MANIFEST_VERSIONS.includes(sourceVersion)) errors.push(`unsupported manifest_version: ${sourceVersion}`);
  if (!manifest.id) errors.push('id is required for Manifest V2');
  if (!manifest.source.repo || !/^[^/]+\/[^/]+$/.test(manifest.source.repo)) errors.push('source.repo must be owner/repo');
  if (!manifest.publisher.id) errors.push('publisher.id is required');
  if (manifest.publisher.provider === 'github' && manifest.source.repo) {
    const owner = githubOwner(manifest.source.repo).toLowerCase();
    if (manifest.publisher.repository_ownership === 'verified' && manifest.publisher.id.toLowerCase() !== owner) {
      errors.push('verified publisher.id must match the GitHub repository owner');
    }
    if (manifest.publisher.id.toLowerCase() !== owner) warnings.push('publisher.id differs from repository owner and requires explicit ownership verification');
  }
  const v1 = validatePackageManifest({ ...input, manifest_version: '1.0.0' }, { file: options.file || 'dsh-package.json' });
  errors.push(...v1.errors.filter((item) => !item.startsWith('manifest_version must be')));
  warnings.push(...v1.warnings);
  return { valid: errors.length === 0, errors: [...new Set(errors)], warnings: [...new Set(warnings)], manifest };
}

export function publisherOwnership(manifest) {
  const value = manifest?.publisher?.repository_ownership || 'unverified';
  return {
    verified: value === 'verified',
    required: value === 'required',
    status: value,
    publisher_id: manifest?.publisher?.id || null,
    repository: manifest?.source?.repo || null,
  };
}
