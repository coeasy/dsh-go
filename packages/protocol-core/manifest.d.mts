import type { PackageRequest, PackageType, ReleaseChannel } from './index.mjs';

export interface PackagePublisherV2 {
  id: string;
  name?: string;
  provider?: string;
  identity?: string;
  url?: string;
  [key: string]: unknown;
}

export interface PackageManifestDependencyV2 extends PackageRequest {
  optional: boolean;
}

export interface PackageManifestV2 {
  manifest_version: 2;
  type: PackageType;
  id: string;
  version: string;
  channel: ReleaseChannel;
  name: string;
  description: string;
  runtime: Record<string, unknown> & { type: PackageType };
  entrypoints: Record<string, unknown>;
  capabilities: string[];
  permissions: string[];
  dependencies: PackageManifestDependencyV2[];
  compatibility: Record<string, unknown>;
  publisher: PackagePublisherV2;
  security: Record<string, unknown>;
  metadata: Record<string, unknown>;
  source?: Record<string, unknown> & { provider: string; repo?: string };
  release?: Record<string, unknown>;
  permission_policy?: Record<string, unknown>;
  localization?: Record<string, unknown>;
  conflicts?: string[];
  replaces?: string[];
  provides?: string[];
  plugin?: Record<string, unknown>;
  mcp?: Record<string, unknown>;
  skill?: Record<string, unknown>;
  agent?: Record<string, unknown>;
}

export interface PackageReleaseArtifactV2 {
  kind: 'release-archive';
  url: string;
  digest: string;
  format: 'tgz';
  strip_components: number;
  [key: string]: unknown;
}

export interface PackageReleaseDescriptorV2 {
  release_version: 2;
  protocol_version: 2;
  manifest_version: 2;
  id: string;
  type: PackageType;
  version: string;
  channel: ReleaseChannel;
  repository: string;
  commit: string;
  tag: string;
  published_at: string;
  manifest_file: string;
  package_path: string | null;
  manifest: PackageManifestV2;
  artifact: PackageReleaseArtifactV2;
}

export const PACKAGE_MANIFEST_VERSION: 2;
export const PACKAGE_MANIFEST_FILE: 'dsh-package.json';
export const PACKAGE_RELEASE_DESCRIPTOR_VERSION: 2;

export function safePackageReleaseName(value: unknown): string;
export function packageReleaseTag(input?: { id?: string; version?: string; package_path?: string | null }): string;
export function validatePackageManifest(
  input: unknown,
  options?: { type?: unknown; id?: unknown; version?: unknown },
): PackageManifestV2;
export function validatePackageReleaseDescriptor(
  input: unknown,
  options?: {
    type?: unknown;
    id?: unknown;
    version?: unknown;
    channel?: unknown;
    repository?: unknown;
    commit?: unknown;
    tag?: unknown;
    package_path?: unknown;
  },
): PackageReleaseDescriptorV2;
